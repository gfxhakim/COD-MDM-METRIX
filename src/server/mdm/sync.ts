import type { MatchMethod, NormalizedStatus, Prisma, SyncItemResult, SyncJob, SyncTrigger } from "@prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { InputError } from "@/server/errors";
import { rateLimit } from "@/server/rateLimit";
import { assertCan, NotFoundError, type WorkspaceContext } from "@/server/tenancy";
import { describeCustomSync, readCustomFilters, type CustomSyncChoices, type CustomSyncFilters } from "@/domain/customSync";
import { normalizeProviderStatus, SHIPPED_STATES, statusKey } from "@/domain/statusMapping";
import { normalizeReference } from "@/lib/normalize";
import { syncMdmAccount } from "./account";
import { adapterForWorkspace, adapterKind, safeMdmMessage, type AdapterFactory } from "./connection";
import { anyShipped, customOrderPlan, customParcelsSince, matchedOrderIds, PARCEL_BATCH, pickCustomOrders, readStep, resolveCustomSync, writeStep } from "./custom";
import { redactPayload, sha256, stableStringify } from "./redact";
import { loadOrderSyncEnv, ordersNeedingHistory, syncUpsells, upsertMdmOrder } from "./orders";
import { applyStatusDefaults, parcelStatusSelect, reconcileOrderStatuses, setParcelStatus, workspaceStatusOverrides } from "./statuses";
import { hasOrderFilters, MdmError, type MdmAdapter, type MdmOrderQuery, type MdmPage, type MdmParcel, type MdmUtm } from "./types";

const PROVIDER = "MDM_EXPRESS" as const;
export const PAGE_SIZE = 100;
/** Incremental syncs re-read this much before the last success, to catch late status updates. */
export const INCREMENTAL_OVERLAP_MS = 24 * 3_600_000;
export const MAX_REQUEST_RETRIES = 4;
export const MAX_JOB_ATTEMPTS = 3;
export const STALE_AFTER_MS = 10 * 60_000;

export type SyncDeps = {
  adapterFactory: AdapterFactory;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  pageSize: number;
};

const defaultDeps: SyncDeps = {
  adapterFactory: adapterForWorkspace,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => new Date(),
  pageSize: PAGE_SIZE,
};

const lockKey = (workspaceId: string) => `${workspaceId}:${PROVIDER}`;

/** Exponential backoff with jitter, honoring Retry-After when the provider sends one. */
export function backoffMs(attempt: number, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined) return Math.min(Math.max(retryAfterMs, 500), 120_000);
  const base = 1000 * 2 ** attempt;
  return Math.min(base + Math.floor(Math.random() * 250), 60_000);
}

// ─────────────────────────── Enqueue ───────────────────────────

export async function startSync(ctx: WorkspaceContext, input: { mode: "INCREMENTAL" | "FULL"; trigger?: SyncTrigger }) {
  assertCan(ctx, "sync.run");
  await rateLimit(`mdm-sync:${ctx.workspaceId}`, 12, 3600);
  const res = await enqueueSync(ctx.workspaceId, { mode: input.mode, trigger: input.trigger ?? "MANUAL", requestedById: ctx.userId });
  if (!res.alreadyRunning) await audit(ctx, "sync.started", { type: "SyncJob", id: res.job.id }, { mode: res.job.mode, adapter: res.job.adapter });
  return res;
}

/**
 * A one-off sync of only the MDM orders matching the user's choices, and their parcels.
 * It adds and updates, never deletes, and leaves the regular syncs' starting point alone.
 */
export async function startCustomSync(ctx: WorkspaceContext, input: CustomSyncChoices) {
  assertCan(ctx, "sync.run");
  await rateLimit(`mdm-sync:${ctx.workspaceId}`, 12, 3600);
  return queueCustomSync(ctx, await resolveCustomSync(ctx.workspaceId, input), "MANUAL");
}

async function queueCustomSync(ctx: WorkspaceContext, filters: CustomSyncFilters, trigger: SyncTrigger) {
  const res = await enqueueSync(ctx.workspaceId, { mode: "CUSTOM", trigger, requestedById: ctx.userId, filters });
  if (!res.alreadyRunning) await audit(ctx, "sync.started", { type: "SyncJob", id: res.job.id }, { mode: "CUSTOM", adapter: res.job.adapter, choices: describeCustomSync(filters).join(" · ") });
  return res;
}

/**
 * Queue a sync for a workspace, holding the per-workspace lock. No permission check:
 * callers are `startSync` and `startCustomSync` (after checking the user's role) and the scheduler.
 */
export async function enqueueSync(workspaceId: string, input: { mode: "INCREMENTAL" | "FULL" | "CUSTOM"; trigger: SyncTrigger; requestedById: string | null; filters?: CustomSyncFilters }) {
  const { adapter, connection } = await adapterForWorkspaceMeta(workspaceId);
  if (!connection?.encryptedCredential) throw new InputError("Save an MDM API key in Settings first");
  if (connection.status !== "CONNECTED") throw new InputError("Run a successful connection test in Settings before syncing");
  const existing = await db.syncJob.findUnique({ where: { activeLock: lockKey(workspaceId) } });
  if (existing) return { job: existing, alreadyRunning: true };
  // Until a sync has read MDM orders, the next one re-reads everything once so parcels
  // synced earlier are linked to their MDM orders.
  const since = connection.ordersSyncedAt ? connection.lastSuccessfulSyncAt : null;
  const updatedSince = input.mode === "INCREMENTAL" && since ? new Date(since.getTime() - INCREMENTAL_OVERLAP_MS) : null;
  const mode = input.mode === "CUSTOM" ? "CUSTOM" : updatedSince ? "INCREMENTAL" : "FULL";
  try {
    const job = await db.syncJob.create({
      data: { workspaceId, provider: PROVIDER, trigger: input.trigger, requestedById: input.requestedById, mode, filters: input.mode === "CUSTOM" ? input.filters : undefined, adapter, updatedSince, phase: "ORDERS", activeLock: lockKey(workspaceId) },
    });
    return { job, alreadyRunning: false };
  } catch (e) {
    // Lost the race for the per-workspace lock: another request just queued a job.
    if ((e as { code?: string }).code === "P2002") {
      const job = await db.syncJob.findUnique({ where: { activeLock: lockKey(workspaceId) } });
      if (job) return { job, alreadyRunning: true };
    }
    throw e;
  }
}

async function adapterForWorkspaceMeta(workspaceId: string) {
  const [ws, connection] = await Promise.all([
    db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { isDemo: true } }),
    db.integrationConnection.findUnique({ where: { workspaceId_provider: { workspaceId, provider: PROVIDER } } }),
  ]);
  return { adapter: adapterKind(ws), connection };
}

export async function cancelSync(ctx: WorkspaceContext, jobId: string) {
  assertCan(ctx, "sync.run");
  const job = await db.syncJob.findFirst({ where: { id: jobId, workspaceId: ctx.workspaceId } });
  if (!job) throw new NotFoundError("Sync job not found");
  if (job.status === "QUEUED") {
    await db.syncJob.update({ where: { id: job.id }, data: { status: "CANCELED", finishedAt: new Date(), activeLock: null, cancelRequested: true } });
  } else if (job.status === "RUNNING") {
    await db.syncJob.update({ where: { id: job.id }, data: { cancelRequested: true } });
  } else throw new InputError("This sync already finished");
  await audit(ctx, "sync.cancel_requested", { type: "SyncJob", id: job.id });
}

/** Re-run only the parcels that failed in a finished job, as a new job. */
export async function retryFailed(ctx: WorkspaceContext, jobId: string) {
  assertCan(ctx, "sync.run");
  const job = await db.syncJob.findFirst({ where: { id: jobId, workspaceId: ctx.workspaceId } });
  if (!job) throw new NotFoundError("Sync job not found");
  if (job.status === "QUEUED" || job.status === "RUNNING") throw new InputError("Wait for this sync to finish first");
  if (job.mode === "CUSTOM") {
    // The same choices again, over the same days.
    const filters = readCustomFilters(job.filters);
    if (!filters) throw new InputError("This custom sync's choices could not be read. Start a new custom sync.");
    await rateLimit(`mdm-sync:${ctx.workspaceId}`, 12, 3600);
    const res = await queueCustomSync(ctx, filters, "RETRY");
    if (!res.alreadyRunning) await db.syncJob.update({ where: { id: res.job.id }, data: { retryOfJobId: job.id } });
    return res;
  }
  // Failed items are re-read by a full sync of the same window: parcel upserts are idempotent.
  const res = await startSync(ctx, { mode: job.mode === "FULL" ? "FULL" : "INCREMENTAL", trigger: "RETRY" });
  if (!res.alreadyRunning) await db.syncJob.update({ where: { id: res.job.id }, data: { retryOfJobId: job.id, updatedSince: job.updatedSince, mode: job.mode } });
  return res;
}

// ─────────────────────────── Worker ───────────────────────────

/** Atomically claim a queued job. Returns null if another worker got it first or it is not due yet. */
async function claim(jobId: string, now: Date): Promise<SyncJob | null> {
  const r = await db.syncJob.updateMany({
    where: { id: jobId, status: "QUEUED", OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }] },
    data: { status: "RUNNING", startedAt: now, heartbeatAt: now, error: null },
  });
  return r.count ? db.syncJob.findUnique({ where: { id: jobId } }) : null;
}

/** Jobs whose worker died (no heartbeat) are re-queued to resume from their saved cursor, or failed after too many attempts. */
export async function recoverStaleJobs(now = new Date()) {
  const stale = await db.syncJob.findMany({ where: { status: "RUNNING", heartbeatAt: { lt: new Date(now.getTime() - STALE_AFTER_MS) } } });
  for (const j of stale) {
    const giveUp = j.attempt + 1 >= MAX_JOB_ATTEMPTS;
    await db.syncJob.update({
      where: { id: j.id },
      data: giveUp
        ? { status: "FAILED", finishedAt: now, activeLock: null, error: "The sync worker stopped responding." }
        : { status: "QUEUED", attempt: { increment: 1 }, nextRunAt: now, error: "Worker stopped responding; resuming from the last saved page." },
    });
  }
  return stale.length;
}

/** Process every due queued job once. Used by the background kick and by the standalone worker. */
export async function processDueJobs(deps: Partial<SyncDeps> = {}, limit = 10) {
  const now = (deps.now ?? defaultDeps.now)();
  await recoverStaleJobs(now);
  const due = await db.syncJob.findMany({ where: { status: "QUEUED", OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }] }, orderBy: { createdAt: "asc" }, take: limit, select: { id: true } });
  const results = [];
  for (const j of due) results.push(await runSyncJob(j.id, deps));
  return results;
}

type Counters = { added: number; updated: number; unchanged: number; failed: number; unknown: number; unmatched: number; ordersAdded: number; ordersUpdated: number; ordersWithContent: number; ordersMatched: number; skipped: number };

const NO_ORDER_ACCESS = "This MDM API key can't read orders, so only parcels were synced. Content IDs still come from order CSV imports.";
const NO_HISTORY_ACCESS = "This MDM API key can't read order history, so content IDs only come from the orders' own UTM fields.";
const CUSTOM_NEEDS_ORDERS = "This MDM API key can't read orders, so a custom sync can't pick them. Sync now still reads every parcel.";

export async function runSyncJob(jobId: string, partial: Partial<SyncDeps> = {}) {
  const deps = { ...defaultDeps, ...partial };
  const job = await claim(jobId, deps.now());
  if (!job) return null;
  const ws = job.workspaceId;
  const counters: Counters = { added: 0, updated: 0, unchanged: 0, failed: 0, unknown: 0, unmatched: 0, ordersAdded: 0, ordersUpdated: 0, ordersWithContent: 0, ordersMatched: 0, skipped: 0 };
  let cursor = job.cursor;
  let page = job.page;
  let phase = job.phase;
  let ordersNote = job.ordersNote;
  // A custom sync reads only the orders matching its choices, then their parcels.
  const custom = job.mode === "CUSTOM" ? readCustomFilters(job.filters) : null;
  if (job.mode === "CUSTOM" && !custom) return finish(job, "FAILED", counters, "This custom sync's choices could not be read. Start a new custom sync.");
  let adapter: MdmAdapter;
  try {
    ({ adapter } = await deps.adapterFactory(ws));
  } catch (e) {
    return finish(job, "FAILED", counters, safeMdmMessage(e));
  }
  // New built-in defaults also re-sort parcels MDM won't send again. Never blocks the sync.
  await applyStatusDefaults(ws).catch((e) => console.error(`[mdm] could not apply status defaults for workspace ${ws}`, e instanceof Error ? e.message : e));
  const overrides = await workspaceStatusOverrides(ws);

  const canceled = async () => (await db.syncJob.findUniqueOrThrow({ where: { id: job.id }, select: { cancelRequested: true } })).cancelRequested;
  const saveParcel = async (p: MdmParcel) => {
    try {
      const outcome = await upsertParcel(ws, job.id, p, overrides);
      counters[outcome.counter]++;
      if (outcome.unknown) counters.unknown++;
      if (outcome.unmatched) counters.unmatched++;
    } catch (e) {
      counters.failed++;
      console.error(`[mdm] parcel ${p.trackingId} failed`, e);
      await db.syncItem.create({ data: { workspaceId: ws, jobId: job.id, entityType: "parcel", providerId: p.trackingId.slice(0, 200), result: "FAILED", error: "Could not save this parcel. It will be retried on the next sync." } });
    }
  };

  try {
    // Orders first, so parcels read afterwards find the order MDM says they ship.
    if (phase === "ORDERS") {
      if (custom && !adapter.listOrders) return finish(job, "FAILED", counters, CUSTOM_NEEDS_ORDERS);
      if (adapter.listOrders) {
        const env = await loadOrderSyncEnv(ws, overrides);
        let history = !!adapter.orderUtm && !ordersNote;
        let plan = custom ? customOrderPlan(custom) : null;
        let at = readStep(custom ? cursor : null);
        let plainTotal: number | null = null;
        for (;;) {
          if (await canceled()) return finish(job, "CANCELED", counters, "Canceled by a user");
          const query: MdmOrderQuery = plan ? { cursor: at.page, updatedSince: plan.updatedSince, pageSize: deps.pageSize, filters: plan.passes[at.step] } : { cursor, updatedSince: job.updatedSince, pageSize: deps.pageSize };
          let result;
          try {
            result = await withRetry(() => adapter.listOrders!(query), deps);
          } catch (e) {
            if (custom && !custom.fallbackOrders && hasOrderFilters(query.filters) && e instanceof MdmError && e.kind === "BAD_RESPONSE") {
              // MDM refused the search filters: read the orders changed since the start day instead and pick them here.
              custom.fallbackOrders = true;
              plan = customOrderPlan(custom);
              at = { step: 0, page: null };
              await db.syncJob.update({ where: { id: job.id }, data: { filters: custom, cursor: null } });
              continue;
            }
            if (!(e instanceof MdmError && e.kind === "AUTH")) throw e;
            if (custom) return finish(job, "FAILED", counters, CUSTOM_NEEDS_ORDERS);
            // A key without order access still syncs parcels, as before.
            ordersNote = NO_ORDER_ACCESS;
            break;
          }
          if (!plan) plainTotal = result.total ?? plainTotal;
          for (const id of result.unreadable ?? []) {
            counters.failed++;
            await db.syncItem.create({ data: { workspaceId: ws, jobId: job.id, entityType: "order", providerId: id.slice(0, 200), result: "FAILED", error: "MDM sent this order in an unexpected shape, so it was skipped." } });
          }
          let items = result.items;
          if (custom) {
            // Orders that don't match are left exactly as they are.
            const picked = await pickCustomOrders(ws, job.id, custom, items, overrides, at.step > 0 || !!custom.fallbackOrders);
            counters.skipped += picked.skipped;
            counters.ordersMatched += picked.matched.length;
            items = picked.matched;
          }
          const needHistory = history ? await ordersNeedingHistory(ws, items) : new Set<string>();
          for (const [i, o] of items.entries()) {
            let found: MdmUtm | null = null;
            let checked = false;
            if (history && needHistory.has(o.trackingId)) {
              try {
                found = await withRetry(() => adapter.orderUtm!(o.trackingId), deps);
                checked = true;
              } catch (e) {
                if (e instanceof MdmError && e.kind === "AUTH") {
                  history = false;
                  ordersNote = NO_HISTORY_ACCESS;
                } else if (e instanceof MdmError && e.retryable) throw e;
                // Anything else: this order keeps no content ID for now; the next sync looks again.
              }
            }
            try {
              const r = await upsertMdmOrder(env, job.id, o, found, checked);
              if (r.counter === "added") counters.ordersAdded++;
              else if (r.counter === "updated") counters.ordersUpdated++;
              if (r.hasContent) counters.ordersWithContent++;
              // A custom sync reads the parcels of every order it kept, changed or not.
              if (custom && r.counter === "unchanged") await db.syncItem.create({ data: { workspaceId: ws, jobId: job.id, entityType: "order", providerId: o.trackingId.slice(0, 200), localId: r.orderId, result: "UNCHANGED" } });
            } catch (e) {
              counters.failed++;
              console.error(`[mdm] order ${o.trackingId} failed`, e instanceof Error ? e.message : e);
              await db.syncItem.create({ data: { workspaceId: ws, jobId: job.id, entityType: "order", providerId: o.trackingId.slice(0, 200), result: "FAILED", error: "Could not save this order. It will be retried on the next sync." } });
            }
            if (i % 25 === 24) await db.syncJob.update({ where: { id: job.id }, data: { heartbeatAt: deps.now() } });
          }
          page++;
          if (plan) {
            at = result.nextCursor ? { step: at.step, page: result.nextCursor } : at.step + 1 < plan.passes.length ? { step: at.step + 1, page: null } : { step: -1, page: null };
            cursor = at.step < 0 ? null : writeStep(at.step, at.page);
          } else cursor = result.nextCursor;
          await db.syncJob.update({ where: { id: job.id }, data: { cursor, page, heartbeatAt: deps.now(), totalCount: result.total ?? undefined, ordersNote, ...countersData(job, counters) } });
          if (!cursor) break;
        }
        if (!custom && ordersNote !== NO_ORDER_ACCESS) {
          try {
            await syncUpsells(ws, (c) => withRetry(() => adapter.listOrders!({ cursor: c, updatedSince: job.updatedSince, pageSize: deps.pageSize, filters: { upsell: true } }), deps), { full: job.mode === "FULL", plainTotal });
          } catch (e) {
            // Upsell marks are extra: a refused or failing upsell search leaves them as they were.
            console.warn("[mdm] upsell search skipped", e instanceof Error ? e.message : e);
          }
        }
      }
      phase = "PARCELS";
      cursor = null;
      page = 0;
      await db.syncJob.update({ where: { id: job.id }, data: { phase, cursor, page, totalCount: null, ordersNote, ...countersData(job, counters) } });
    }

    if (custom) {
      if (custom.parcels) {
        // The kept orders' parcels, a batch of orders at a time.
        const ids = await matchedOrderIds(ws, job.id);
        let at = readStep(cursor);
        while (ids.length) {
          if (await canceled()) return finish(job, "CANCELED", counters, "Canceled by a user");
          const batch = custom.fallbackParcels ? null : ids.slice(at.step * PARCEL_BATCH, (at.step + 1) * PARCEL_BATCH);
          const wanted = new Set(batch ?? ids);
          let result: MdmPage | null = null;
          try {
            result = await withRetry(() => adapter.listParcels({ cursor: at.page, updatedSince: batch ? null : customParcelsSince(custom), pageSize: deps.pageSize, ...(batch ? { mdmOrderIds: batch } : {}) }), deps);
          } catch (e) {
            if (!batch || !(e instanceof MdmError && e.kind === "BAD_RESPONSE")) throw e;
          }
          // MDM refused or ignored the order filter: read parcels without it and keep only those of the kept orders.
          if (batch && (!result || result.items.some((p) => p.mdmOrderId && !wanted.has(p.mdmOrderId)))) {
            custom.fallbackParcels = true;
            at = { step: 0, page: null };
            await db.syncJob.update({ where: { id: job.id }, data: { filters: custom, cursor: null } });
            continue;
          }
          for (const p of result!.items) if (p.mdmOrderId && wanted.has(p.mdmOrderId)) await saveParcel(p);
          page++;
          const lastBatch = !batch || (at.step + 1) * PARCEL_BATCH >= ids.length;
          at = result!.nextCursor ? { step: at.step, page: result!.nextCursor } : lastBatch ? { step: -1, page: null } : { step: at.step + 1, page: null };
          cursor = at.step < 0 ? null : writeStep(at.step, at.page);
          await db.syncJob.update({ where: { id: job.id }, data: { cursor, page, heartbeatAt: deps.now(), totalCount: batch ? ids.length : (result!.total ?? undefined), ...countersData(job, counters) } });
          if (cursor) continue;
          // No parcel came back although some of these orders left the warehouse: MDM may not
          // filter parcels by order as asked. Read them without the filter once.
          const seen = countersData(job, counters);
          if (!custom.fallbackParcels && seen.addedCount + seen.updatedCount + seen.unchangedCount === 0 && (await anyShipped(ws, ids, overrides))) {
            custom.fallbackParcels = true;
            at = { step: 0, page: null };
            await db.syncJob.update({ where: { id: job.id }, data: { filters: custom } });
            continue;
          }
          break;
        }
      }
      return finish(job, counters.failed ? "PARTIAL" : "SUCCEEDED", counters, null);
    }

    if (phase !== "ACCOUNT") {
      for (;;) {
        if (await canceled()) return finish(job, "CANCELED", counters, "Canceled by a user");
        const result = await withRetry(() => adapter.listParcels({ cursor, updatedSince: job.updatedSince, pageSize: deps.pageSize }), deps);
        for (const p of result.items) await saveParcel(p);
        page++;
        cursor = result.nextCursor;
        await db.syncJob.update({
          where: { id: job.id },
          data: {
            cursor, page, heartbeatAt: deps.now(), totalCount: result.total ?? undefined,
            ...countersData(job, counters),
          },
        });
        if (!cursor) break;
      }
    }

    // Then the seller's wallet, fees, payouts, prices and stock. Each part is read on its own and
    // a part MDM refuses is noted on the Money & stock page; it never fails the sync.
    if (adapter.account) {
      phase = "ACCOUNT";
      await db.syncJob.update({ where: { id: job.id }, data: { phase, cursor: null, heartbeatAt: deps.now(), ...countersData(job, counters) } });
      const res = await syncMdmAccount(ws, adapter.account, {
        mode: job.mode,
        startedAt: job.startedAt ?? deps.now(),
        pageSize: deps.pageSize,
        now: deps.now,
        retry: (fn) => withRetry(fn, deps),
        canceled,
        heartbeat: async () => void (await db.syncJob.update({ where: { id: job.id }, data: { heartbeatAt: deps.now() } })),
      });
      if (res.canceled) return finish(job, "CANCELED", counters, "Canceled by a user");
    }
  } catch (e) {
    const message = safeMdmMessage(e);
    if (!(e instanceof MdmError)) console.error("[mdm] sync failed", e);
    const retryable = e instanceof MdmError && e.retryable;
    if (ordersNote !== job.ordersNote) await db.syncJob.update({ where: { id: job.id }, data: { ordersNote } });
    if (e instanceof MdmError && (e.kind === "AUTH" || e.kind === "NOT_AVAILABLE" || e.kind === "CONFIG")) {
      await db.integrationConnection.updateMany({ where: { workspaceId: ws, provider: PROVIDER }, data: { status: e.kind === "AUTH" ? "ERROR" : undefined, lastError: message } });
    }
    if (retryable && job.attempt + 1 < MAX_JOB_ATTEMPTS) {
      // Resume later from the saved cursor; the lock stays held so no parallel job starts.
      const delay = Math.max(30_000, backoffMs(job.attempt + 4, (e as MdmError).retryAfterMs));
      await db.syncJob.update({ where: { id: job.id }, data: { status: "QUEUED", attempt: { increment: 1 }, nextRunAt: new Date(deps.now().getTime() + delay), error: `${message} Retrying automatically.`, ...countersData(job, counters) } });
      return db.syncJob.findUnique({ where: { id: job.id } });
    }
    return finish(job, "FAILED", counters, message);
  }
  return finish(job, counters.failed ? "PARTIAL" : "SUCCEEDED", counters, null);
}

function countersData(job: SyncJob, c: Counters) {
  // Jobs resumed after a retry keep the counts from earlier attempts.
  return {
    addedCount: job.addedCount + c.added,
    updatedCount: job.updatedCount + c.updated,
    unchangedCount: job.unchangedCount + c.unchanged,
    failedCount: job.failedCount + c.failed,
    unknownStatusCount: job.unknownStatusCount + c.unknown,
    unmatchedCount: job.unmatchedCount + c.unmatched,
    ordersAddedCount: job.ordersAddedCount + c.ordersAdded,
    ordersUpdatedCount: job.ordersUpdatedCount + c.ordersUpdated,
    ordersWithContentCount: job.ordersWithContentCount + c.ordersWithContent,
    ordersMatchedCount: job.ordersMatchedCount + c.ordersMatched,
    skippedCount: job.skippedCount + c.skipped,
  };
}

async function finish(job: SyncJob, status: "SUCCEEDED" | "PARTIAL" | "FAILED" | "CANCELED", c: Counters, error: string | null) {
  const now = new Date();
  const done = await db.syncJob.update({ where: { id: job.id }, data: { status, finishedAt: now, activeLock: null, error, ...countersData(job, c) } });
  // A custom sync only read part of MDM, so the regular syncs keep their own starting point.
  if (job.mode !== "CUSTOM") {
    if (status === "SUCCEEDED" || status === "PARTIAL") {
      await db.integrationConnection.updateMany({ where: { workspaceId: job.workspaceId, provider: PROVIDER }, data: { lastSuccessfulSyncAt: job.startedAt ?? now, ordersSyncedAt: job.startedAt ?? now, lastError: null } });
    } else if (status === "FAILED" && error) {
      await db.integrationConnection.updateMany({ where: { workspaceId: job.workspaceId, provider: PROVIDER }, data: { lastError: error } });
    }
  }
  await db.auditLog.create({ data: { workspaceId: job.workspaceId, actorUserId: null, action: "sync.finished", entityType: "SyncJob", entityId: job.id, metadata: { status, mode: job.mode, added: done.addedCount, updated: done.updatedCount, failed: done.failedCount, unmatched: done.unmatchedCount, ordersAdded: done.ordersAddedCount, ordersUpdated: done.ordersUpdatedCount, ...(job.mode === "CUSTOM" ? { ordersMatched: done.ordersMatchedCount, skipped: done.skippedCount } : {}) } } });
  return done;
}

/** One provider read, retried with backoff on rate limits, outages and network errors. */
async function withRetry<T>(fn: () => Promise<T>, deps: SyncDeps): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof MdmError) || !e.retryable || attempt >= MAX_REQUEST_RETRIES) throw e;
      await deps.sleep(backoffMs(attempt, e.retryAfterMs));
    }
  }
}

// ─────────────────────────── Matching & upsert ───────────────────────────

type Match = { orderId: string; method: MatchMethod; confidence: number } | { orderId: null; reason: string };

/** MDM's own order link → order reference → existing tracking-ID link → source order ID → unmatched. Ambiguous matches are never guessed. */
export async function matchParcel(tx: Prisma.TransactionClient, workspaceId: string, p: MdmParcel, existing: { orderId: string | null; matchMethod: MatchMethod; matchConfidence: number } | null): Promise<Match> {
  if (existing?.matchMethod === "MANUAL" && existing.orderId) return { orderId: existing.orderId, method: "MANUAL", confidence: existing.matchConfidence };
  const reasons: string[] = [];
  if (p.mdmOrderId) {
    const hit = await tx.order.findUnique({ where: { workspaceId_mdmOrderId: { workspaceId, mdmOrderId: p.mdmOrderId } }, select: { id: true } });
    if (hit) return { orderId: hit.id, method: "MDM_ORDER", confidence: 1 };
    reasons.push(`MDM order ${p.mdmOrderId} not synced yet`);
  }
  const ref = normalizeReference(p.reference);
  if (ref) {
    const hits = await tx.order.findMany({ where: { workspaceId, normalizedOrderNumber: ref }, select: { id: true }, take: 2 });
    if (hits.length === 1) return { orderId: hits[0].id, method: "ORDER_REFERENCE", confidence: 1 };
    reasons.push(hits.length > 1 ? `reference ${p.reference} matches several orders` : `no order with reference ${p.reference}`);
  } else reasons.push("no order reference");
  // Tracking ID seen before and already linked: keep that link (and how it was made).
  if (existing?.orderId) return { orderId: existing.orderId, method: existing.matchMethod === "NONE" ? "TRACKING_ID" : existing.matchMethod, confidence: existing.matchMethod === "NONE" ? 0.95 : existing.matchConfidence };
  reasons.push("tracking ID not linked before");
  if (p.sourceOrderId) {
    const hits = await tx.order.findMany({ where: { workspaceId, externalOrderId: p.sourceOrderId }, select: { id: true }, take: 2 });
    if (hits.length === 1) return { orderId: hits[0].id, method: "SOURCE_ORDER_ID", confidence: 0.9 };
    reasons.push(hits.length > 1 ? `source order ID ${p.sourceOrderId} matches several orders` : `no order with source ID ${p.sourceOrderId}`);
  } else reasons.push("no source order ID");
  return { orderId: null, reason: reasons.join("; ") };
}

async function upsertParcel(workspaceId: string, jobId: string, p: MdmParcel, overrides: Record<string, NormalizedStatus>) {
  if (!p.trackingId) throw new Error("Parcel without tracking ID");
  const redacted = redactPayload(p.raw);
  const payloadHash = sha256(stableStringify(redacted));
  const normalized = normalizeProviderStatus(p.status, overrides);

  return db.$transaction(async (tx) => {
    const rawKey = { workspaceId, provider: PROVIDER, entityType: "parcel", externalId: p.trackingId, payloadHash };
    const seenRaw = await tx.rawExternalRecord.findUnique({ where: { workspaceId_provider_entityType_externalId_payloadHash: rawKey }, select: { id: true } });
    if (!seenRaw && p.raw != null) await tx.rawExternalRecord.create({ data: { ...rawKey, payload: redacted as Prisma.InputJsonValue } });

    const existing = await tx.parcel.findUnique({ where: { workspaceId_provider_trackingId: { workspaceId, provider: PROVIDER, trackingId: p.trackingId } } });
    const match = await matchParcel(tx, workspaceId, p, existing);
    const fields = {
      providerReference: p.reference,
      sourceOrderId: p.sourceOrderId,
      mdmOrderId: p.mdmOrderId ?? existing?.mdmOrderId ?? null,
      providerStatus: p.status,
      normalizedStatus: normalized,
      codAmount: p.codAmount ?? existing?.codAmount ?? 0,
      currency: p.currency,
      shippingFee: p.shippingFee,
      returnFee: p.returnFee,
      wilaya: p.wilaya,
      dispatchedAt: p.dispatchedAt ?? (SHIPPED_STATES.includes(normalized) ? existing?.dispatchedAt ?? p.statusAt : null),
      deliveredAt: normalized === "DELIVERED" ? p.deliveredAt ?? p.statusAt : null,
      returnedAt: normalized === "RETURNED" ? p.returnedAt ?? p.statusAt : null,
      lastProviderUpdateAt: p.statusAt,
      orderId: match.orderId,
      matchMethod: match.orderId ? match.method : ("NONE" as const),
      matchConfidence: match.orderId ? match.confidence : 0,
    };

    let parcelId: string;
    let counter: "added" | "updated" | "unchanged";
    if (!existing) {
      const created = await tx.parcel.create({ data: { workspaceId, provider: PROVIDER, trackingId: p.trackingId, isDemoFixture: p.raw != null && (p.raw as { demo?: boolean }).demo === true, ...fields } });
      parcelId = created.id;
      counter = "added";
    } else {
      parcelId = existing.id;
      const changed = (Object.keys(fields) as (keyof typeof fields)[]).some((k) => {
        const a = existing[k] as unknown;
        const b = fields[k] as unknown;
        return a instanceof Date || b instanceof Date ? (a as Date | null)?.getTime() !== (b as Date | null)?.getTime() : a !== b;
      });
      if (changed) await tx.parcel.update({ where: { id: existing.id }, data: fields });
      counter = changed ? "updated" : "unchanged";
    }

    // Append-only status history, deduplicated by (parcel, status, time).
    const have = new Set((await tx.parcelStatusEvent.findMany({ where: { parcelId }, select: { eventHash: true } })).map((e) => e.eventHash));
    const events = p.events.length ? p.events : p.status && p.statusAt ? [{ status: p.status, at: p.statusAt }] : [];
    let newEvents = 0;
    for (const ev of events) {
      const eventHash = sha256(`${p.trackingId}|${ev.status}|${ev.at.toISOString()}`);
      if (have.has(eventHash)) continue;
      have.add(eventHash);
      await tx.parcelStatusEvent.create({ data: { workspaceId, parcelId, providerStatus: ev.status, normalizedStatus: normalizeProviderStatus(ev.status, overrides), occurredAt: ev.at, source: PROVIDER, eventHash } });
      newEvents++;
    }
    if (counter === "unchanged" && newEvents) counter = "updated";

    // Orders follow their parcels: confirmed once prepared or shipped, canceled when every parcel is.
    if (match.orderId) await reconcileOrderStatuses(tx, workspaceId, [match.orderId]);

    const unmatchedKey = { workspaceId_provider_entityType_externalId: { workspaceId, provider: PROVIDER, entityType: "parcel", externalId: p.trackingId } };
    if ("reason" in match) {
      await tx.unmatchedRecord.upsert({
        where: unmatchedKey,
        create: { workspaceId, provider: PROVIDER, entityType: "parcel", externalId: p.trackingId, reference: p.reference, reason: match.reason, parcelId },
        update: { reference: p.reference, reason: match.reason, parcelId },
      });
    } else {
      await tx.unmatchedRecord.updateMany({ where: { workspaceId, provider: PROVIDER, entityType: "parcel", externalId: p.trackingId, status: "OPEN" }, data: { status: "RESOLVED", resolvedAt: new Date() } });
    }

    const result: SyncItemResult | null = !match.orderId ? "UNMATCHED" : counter === "added" ? "ADDED" : counter === "updated" ? "UPDATED" : null;
    if (result) await tx.syncItem.create({ data: { workspaceId, jobId, entityType: "parcel", providerId: p.trackingId, localId: parcelId, result } });
    return { counter, unknown: normalized === "UNKNOWN", unmatched: !match.orderId };
  });
}

// ─────────────────────────── Reads ───────────────────────────

export async function listJobs(ctx: WorkspaceContext, limit: number) {
  return db.syncJob.findMany({ where: { workspaceId: ctx.workspaceId }, orderBy: { createdAt: "desc" }, take: limit, omit: { activeLock: true, cursor: true } });
}

export async function getJob(ctx: WorkspaceContext, id: string) {
  const job = await db.syncJob.findFirst({ where: { id, workspaceId: ctx.workspaceId }, omit: { activeLock: true, cursor: true } });
  if (!job) throw new NotFoundError("Sync job not found");
  const items = await db.syncItem.findMany({ where: { jobId: job.id, workspaceId: ctx.workspaceId, result: { in: ["FAILED", "UNMATCHED", "ADDED", "UPDATED"] } }, orderBy: [{ result: "asc" }, { createdAt: "asc" }], take: 300 });
  return { job, items };
}

export async function unknownStatuses(ctx: WorkspaceContext) {
  const rows = await db.parcel.groupBy({ by: ["providerStatus"], where: { workspaceId: ctx.workspaceId, normalizedStatus: "UNKNOWN" }, _count: true });
  return rows.map((r) => ({ providerStatus: r.providerStatus, parcels: r._count }));
}

/** Map an unknown provider status and re-normalize the parcels that carry it. */
export async function mapStatus(ctx: WorkspaceContext, input: { providerStatus: string; normalizedStatus: NormalizedStatus }) {
  assertCan(ctx, "settings.economics");
  const key = statusKey(input.providerStatus);
  if (!key) throw new InputError("Enter a status");
  return db.$transaction(async (tx) => {
    await tx.statusMapping.upsert({
      where: { workspaceId_provider_providerStatus: { workspaceId: ctx.workspaceId, provider: PROVIDER, providerStatus: key } },
      create: { workspaceId: ctx.workspaceId, provider: PROVIDER, providerStatus: key, normalizedStatus: input.normalizedStatus },
      update: { normalizedStatus: input.normalizedStatus },
    });
    const parcels = await tx.parcel.findMany({ where: { workspaceId: ctx.workspaceId, provider: PROVIDER, providerStatus: { not: null } }, select: parcelStatusSelect });
    let n = 0;
    for (const p of parcels.filter((x) => statusKey(x.providerStatus!) === key)) {
      await setParcelStatus(tx, ctx.workspaceId, p, input.normalizedStatus);
      n++;
    }
    const evs = await tx.parcelStatusEvent.findMany({ where: { workspaceId: ctx.workspaceId }, select: { id: true, providerStatus: true } });
    const ids = evs.filter((e) => statusKey(e.providerStatus) === key).map((e) => e.id);
    if (ids.length) await tx.parcelStatusEvent.updateMany({ where: { id: { in: ids } }, data: { normalizedStatus: input.normalizedStatus } });
    await audit(ctx, "status_mapping.saved", { type: "StatusMapping" }, { providerStatus: key, normalizedStatus: input.normalizedStatus, parcels: n }, tx);
    return { parcels: n };
  });
}

export async function listUnmatched(ctx: WorkspaceContext, input: { status: "OPEN" | "RESOLVED" | "IGNORED"; limit: number }) {
  return db.unmatchedRecord.findMany({
    where: { workspaceId: ctx.workspaceId, status: input.status },
    orderBy: { createdAt: "desc" },
    take: input.limit,
    include: { parcel: { select: { id: true, trackingId: true, providerStatus: true, normalizedStatus: true, codAmount: true, currency: true, wilaya: true, lastProviderUpdateAt: true, sourceOrderId: true, isDemoFixture: true } } },
  });
}

export async function ignoreUnmatched(ctx: WorkspaceContext, id: string, ignore: boolean) {
  assertCan(ctx, "orders.match");
  const rec = await db.unmatchedRecord.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!rec) throw new NotFoundError("Record not found");
  await db.unmatchedRecord.update({ where: { id: rec.id }, data: ignore ? { status: "IGNORED", resolvedAt: new Date(), resolvedById: ctx.userId } : { status: "OPEN", resolvedAt: null, resolvedById: null } });
  await audit(ctx, ignore ? "unmatched.ignored" : "unmatched.reopened", { type: "UnmatchedRecord", id: rec.id }, { externalId: rec.externalId });
}
