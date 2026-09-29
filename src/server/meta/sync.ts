import type { AdAccount, MetaToken, Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { InputError } from "@/server/errors";
import { rateLimit } from "@/server/rateLimit";
import { assertCan, type WorkspaceContext } from "@/server/tenancy";
import { parseExchangeRates } from "@/domain/settings";
import { convertMinor } from "@/lib/money";
import { normalizeCreativeKey } from "@/lib/normalize";
import { sha256 } from "@/server/mdm/redact";
import { META, metaAdapterForToken, recordAdAccounts, refreshMetaStatus, safeMetaMessage, savedMetaTokens, type MetaAdapterFactory } from "./connection";
import { relinkAttribution } from "@/server/imports/service";
import { ensureCampaigns, recordMetaCampaigns } from "@/server/repositories/campaigns";
import { API_SOURCE, supersedeCsvSpend } from "./supersede";
import { MetaError, type MetaAdAccount, type MetaAdapter, type MetaCampaign, type MetaSpendRow } from "./types";

/**
 * Meta ad spend sync. For every enabled ad account a saved token can see, reads spend per
 * ad per day and stores it as ad spend (source META_API), linked to the creative whose
 * content ID is the ad ID. The first sync reads the last BACKFILL_DAYS days; later ones
 * re-read the days since the last sync plus REFRESH_DAYS, because Meta keeps adjusting
 * recent numbers. CSV rows for the same ad and day are then superseded, never counted twice.
 * Each account's campaigns are then listed for their status (running or not).
 */
export { API_SOURCE, supersedeCsvSpend };
export const BACKFILL_DAYS = 180;
export const REFRESH_DAYS = 3;
const CHUNK_DAYS = 30;
const LEASE_MS = 20 * 60_000;
const MAX_RETRIES = 3;

export type MetaSyncDeps = { adapterFactory: MetaAdapterFactory; sleep: (ms: number) => Promise<void>; now: () => Date };
const defaultDeps: MetaSyncDeps = { adapterFactory: metaAdapterForToken, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: () => new Date() };

// ─────────────────────────── dates (YYYY-MM-DD in the ad account's time zone) ───────────────────────────

export function localDate(at: Date, timeZone: string | null): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const dayDate = (day: string) => new Date(`${day}T00:00:00.000Z`);

/** The days one account's sync reads. */
export function syncWindow(acc: Pick<AdAccount, "timezone" | "lastSyncedAt">, now: Date, full: boolean) {
  const until = localDate(now, acc.timezone);
  const earliest = addDays(until, -(BACKFILL_DAYS - 1));
  if (full || !acc.lastSyncedAt) return { since: earliest, until };
  const since = addDays(localDate(acc.lastSyncedAt, acc.timezone), -REFRESH_DAYS);
  return { since: since < earliest ? earliest : since, until };
}

function chunks(since: string, until: string) {
  const out: { since: string; until: string }[] = [];
  for (let s = since; s <= until; s = addDays(s, CHUNK_DAYS)) {
    const e = addDays(s, CHUNK_DAYS - 1);
    out.push({ since: s, until: e < until ? e : until });
  }
  return out;
}

async function withRetry<T>(fn: () => Promise<T>, deps: MetaSyncDeps): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof MetaError) || !e.retryable || attempt >= MAX_RETRIES) throw e;
      await deps.sleep(e.retryAfterMs ?? Math.min(2000 * 2 ** attempt, 60_000));
    }
  }
}

// ─────────────────────────── creatives ───────────────────────────

type Env = { workspaceId: string; currency: string; rates: Record<string, number | undefined>; creatives: Map<string, string>; unnamed: Set<string>; noCampaign: Set<string>; onlyProduct: string | null };

async function loadEnv(workspaceId: string): Promise<Env> {
  const [ws, creatives, products] = await Promise.all([
    db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { currency: true, exchangeRates: true } }),
    db.creative.findMany({ where: { workspaceId }, select: { id: true, normalizedKey: true, name: true, campaignId: true } }),
    db.product.findMany({ where: { workspaceId, active: true }, select: { id: true } }),
  ]);
  return {
    workspaceId,
    currency: ws.currency,
    rates: parseExchangeRates(ws.exchangeRates) as Record<string, number | undefined>,
    creatives: new Map(creatives.map((c) => [c.normalizedKey, c.id])),
    unnamed: new Set(creatives.filter((c) => !c.name).map((c) => c.normalizedKey)),
    noCampaign: new Set(creatives.filter((c) => !c.campaignId).map((c) => c.normalizedKey)),
    onlyProduct: products.length === 1 ? products[0].id : null,
  };
}

/**
 * The creative for an ad: the one whose content ID is this ad ID, created if new.
 * Creatives first seen through orders (no name yet) get the ad's name and campaign,
 * and any creative without a campaign gets this ad's campaign.
 */
async function creativeFor(env: Env, r: MetaSpendRow): Promise<string> {
  const key = normalizeCreativeKey(r.adId);
  const known = env.creatives.get(key);
  if (known) {
    if (env.unnamed.has(key) && r.adName) {
      await db.creative.update({ where: { id: known }, data: { name: r.adName, campaignId: r.campaignId, campaignName: r.campaignName, adsetName: r.adsetName } });
      env.unnamed.delete(key);
      if (r.campaignId) env.noCampaign.delete(key);
    } else if (env.noCampaign.has(key) && r.campaignId) {
      await db.creative.update({ where: { id: known }, data: { campaignId: r.campaignId, campaignName: r.campaignName ?? undefined } });
      env.noCampaign.delete(key);
    }
    return known;
  }
  const c = await db.creative.upsert({
    where: { workspaceId_platform_externalCreativeId: { workspaceId: env.workspaceId, platform: "META", externalCreativeId: r.adId } },
    create: { workspaceId: env.workspaceId, platform: "META", externalCreativeId: r.adId, normalizedKey: key, name: r.adName, campaignId: r.campaignId, campaignName: r.campaignName, adsetName: r.adsetName, productId: env.onlyProduct },
    update: {},
    select: { id: true },
  });
  env.creatives.set(key, c.id);
  return c.id;
}

// ─────────────────────────── writing spend ───────────────────────────

type Counts = { added: number; updated: number; unchanged: number; spend: number };

async function writeRows(env: Env, account: string, rows: MetaSpendRow[], counts: Counts) {
  const kept = rows.filter((r) => r.spend > 0 || (r.impressions ?? 0) > 0);
  if (!kept.length) return;
  const hashOf = (r: MetaSpendRow) => sha256(`meta|${account}|${r.date}|${r.adId}`);
  const existing = new Map(
    (await db.adSpend.findMany({ where: { workspaceId: env.workspaceId, source: API_SOURCE, sourceRowHash: { in: kept.map(hashOf) } }, select: { id: true, sourceRowHash: true, spend: true, originalSpend: true, impressions: true, clicks: true, creativeId: true, adName: true, campaignName: true, adsetName: true } })).map((r) => [r.sourceRowHash, r]),
  );
  const creates: Prisma.AdSpendCreateManyInput[] = [];
  for (const r of kept) {
    let spend = r.spend;
    let original: { originalSpend: number | null; originalCurrency: string | null; fxRate: number | null } = { originalSpend: null, originalCurrency: null, fxRate: null };
    if (r.currency !== env.currency) {
      const rate = env.rates[r.currency];
      if (!rate) throw new MetaError(`This ad account bills in ${r.currency}. Set a ${r.currency} exchange rate in Settings → Economics & currencies, then sync again.`, "CONFIG");
      spend = convertMinor(r.spend, r.currency, env.currency, rate);
      original = { originalSpend: r.spend, originalCurrency: r.currency, fxRate: rate };
    }
    const creativeId = await creativeFor(env, r);
    const data = {
      platform: "META" as const,
      source: API_SOURCE,
      date: dayDate(r.date),
      campaignId: r.campaignId,
      campaignName: r.campaignName,
      adsetId: r.adsetId,
      adsetName: r.adsetName,
      adId: r.adId,
      adName: r.adName,
      externalCreativeId: r.adId,
      creativeId,
      spend,
      currency: env.currency,
      ...original,
      impressions: r.impressions,
      clicks: r.clicks,
      adAccountId: account,
    };
    counts.spend += spend;
    const hash = hashOf(r);
    const had = existing.get(hash);
    if (!had) {
      creates.push({ workspaceId: env.workspaceId, sourceRowHash: hash, ...data });
      existing.set(hash, { id: "", sourceRowHash: hash, spend, originalSpend: original.originalSpend, impressions: r.impressions, clicks: r.clicks, creativeId, adName: r.adName, campaignName: r.campaignName, adsetName: r.adsetName });
      counts.added++;
    } else if (had.id && (had.spend !== spend || had.originalSpend !== original.originalSpend || had.impressions !== r.impressions || had.clicks !== r.clicks || had.creativeId !== creativeId || had.adName !== r.adName || had.campaignName !== r.campaignName || had.adsetName !== r.adsetName)) {
      await db.adSpend.update({ where: { id: had.id }, data });
      counts.updated++;
    } else counts.unchanged++;
  }
  for (let i = 0; i < creates.length; i += 500) await db.adSpend.createMany({ data: creates.slice(i, i + 500) });
}

// ─────────────────────────── the sync ───────────────────────────

export type MetaSyncResult =
  | { ran: false; reason: "not_connected" | "running" }
  | { ran: true; ok: boolean; accounts: number; added: number; updated: number; unchanged: number; superseded: number; failed: { account: string; message: string }[]; error: string | null };

async function syncAccount(adapter: MetaAdapter, env: Env, acc: AdAccount, full: boolean, deps: MetaSyncDeps, counts: Counts) {
  const { since, until } = syncWindow(acc, deps.now(), full);
  for (const c of chunks(since, until)) {
    let cursor: string | null = null;
    for (let page = 0; page < 1000; page++) {
      const res = await withRetry(() => adapter.dailyAdSpend({ accountId: acc.externalId, since: c.since, until: c.until, cursor, currency: acc.currency ?? env.currency }), deps);
      await writeRows(env, acc.externalId, res.rows, counts);
      cursor = res.next;
      if (!cursor) break;
    }
  }
  return { since, until };
}

/**
 * One spend sync for a workspace. Holds a lease so two never run at once. Each saved token
 * (Business Manager) lists its ad accounts; an account two tokens can see is read with the
 * older one. One account's problem (a missing exchange rate, a revoked permission) doesn't
 * stop the others, and a rejected token only stops its own accounts: it is marked as
 * needing a new token, and the connection only stops once no token works.
 */
export async function runMetaSync(workspaceId: string, opts: { full?: boolean; trigger?: "MANUAL" | "SCHEDULED"; actorUserId?: string | null } = {}, partial: Partial<MetaSyncDeps> = {}): Promise<MetaSyncResult> {
  const deps = { ...defaultDeps, ...partial };
  const started = deps.now();
  const conn = await db.integrationConnection.findUnique({ where: { workspaceId_provider: { workspaceId, provider: META } } });
  const tokens = (await savedMetaTokens(workspaceId)).filter((t) => t.status === "CONNECTED");
  if (!conn || conn.status !== "CONNECTED" || !tokens.length) return { ran: false, reason: "not_connected" };
  const lease = await db.integrationConnection.updateMany({
    where: { id: conn.id, OR: [{ syncLeaseUntil: null }, { syncLeaseUntil: { lt: started } }] },
    data: { syncLeaseUntil: new Date(started.getTime() + LEASE_MS), lastSyncAttemptAt: started },
  });
  if (!lease.count) return { ran: false, reason: "running" };

  const counts: Counts = { added: 0, updated: 0, unchanged: 0, spend: 0 };
  const failed: { account: string; message: string }[] = [];
  const rejected = new Map<string, string>();
  let fatal: string | null = null;
  let accounts: AdAccount[] = [];
  let superseded = 0;
  let from = null as string | null;
  let until = null as string | null;
  const reject = (t: MetaToken, message: string) => {
    rejected.set(t.id, message);
    failed.push({ account: t.label, message });
  };
  try {
    // 1. What each token can see. The oldest token that lists an account reads it.
    const adapters = new Map<string, MetaAdapter>();
    const owner = new Map<string, string>();
    const listed: MetaAdAccount[] = [];
    for (const t of tokens) {
      try {
        const adapter = await deps.adapterFactory(workspaceId, t);
        const seen = await withRetry(() => adapter.listAdAccounts(), deps);
        adapters.set(t.id, adapter);
        for (const a of seen) {
          if (owner.has(a.id)) continue;
          owner.set(a.id, t.id);
          listed.push(a);
        }
      } catch (e) {
        if (!(e instanceof MetaError)) console.error(`[meta] listing ad accounts failed for token ${t.id}`, e instanceof Error ? e.message : e);
        const message = safeMetaMessage(e);
        if (e instanceof MetaError && e.kind === "AUTH") reject(t, message);
        else failed.push({ account: t.label, message });
      }
    }
    await recordAdAccounts(workspaceId, listed, owner, started, [...adapters.keys()]);

    // 2. Enabled accounts a working token can see right now.
    accounts = await db.adAccount.findMany({ where: { workspaceId, platform: "META", enabled: true, lastSeenAt: { gte: started }, tokenId: { in: [...adapters.keys()] } }, orderBy: { externalId: "asc" } });
    const env = await loadEnv(workspaceId);
    const campaignLists = new Map<string, MetaCampaign[]>();
    for (const acc of accounts) {
      const token = tokens.find((t) => t.id === acc.tokenId)!;
      if (rejected.has(token.id)) continue;
      try {
        const adapter = adapters.get(token.id)!;
        const w = await syncAccount(adapter, env, acc, !!opts.full, deps, counts);
        from = !from || w.since < from ? w.since : from;
        until = !until || w.until > until ? w.until : until;
        await db.adAccount.update({ where: { id: acc.id }, data: { lastSyncedAt: started, lastError: null } });
        // Campaign status only says which campaigns are on; spend is already saved, so a failure here is logged, not fatal.
        try {
          campaignLists.set(acc.externalId, await withRetry(() => adapter.listCampaigns(acc.externalId), deps));
        } catch (e) {
          console.error(`[meta] campaign status for ${acc.externalId} failed:`, safeMetaMessage(e));
        }
      } catch (e) {
        if (!(e instanceof MetaError)) console.error(`[meta] account ${acc.externalId} failed`, e instanceof Error ? e.message : e);
        const message = safeMetaMessage(e);
        await db.adAccount.update({ where: { id: acc.id }, data: { lastError: message } });
        if (e instanceof MetaError && e.kind === "AUTH") reject(token, message);
        else failed.push({ account: acc.name ?? acc.externalId, message });
      }
    }
    if (from && until) superseded = await supersedeCsvSpend(workspaceId, { from: dayDate(addDays(from, -1)), to: dayDate(addDays(until, 1)) }, started);
    // Orders whose content ID arrived before Meta created its creative.
    await relinkAttribution({ workspaceId });
    // Campaigns seen in spend first, so ones Meta no longer lists are marked as such.
    await ensureCampaigns(workspaceId);
    for (const [account, list] of campaignLists) await recordMetaCampaigns(workspaceId, account, list, started);
  } catch (e) {
    if (!(e instanceof MetaError)) console.error("[meta] sync failed", e instanceof Error ? e.message : e);
    fatal = safeMetaMessage(e);
  }

  // A rejected token needs a new one; its accounts wait until then.
  for (const [id, message] of rejected) await db.metaToken.update({ where: { id }, data: { status: "ERROR", lastError: message } });
  if (rejected.size) await refreshMetaStatus(workspaceId);

  const error = fatal ?? (failed.length ? `Not everything could be synced: ${failed.map((f) => `${f.account}: ${f.message}`).join(" ")}`.slice(0, 1000) : null);
  const ok = !error;
  const summary = { from, until, accounts: accounts.length, added: counts.added, updated: counts.updated, unchanged: counts.unchanged, superseded, spend: counts.spend, failed };
  await db.integrationConnection.update({
    where: { id: conn.id },
    data: { syncLeaseUntil: null, lastSyncSummary: summary as Prisma.InputJsonValue, lastError: error, ...(ok ? { lastSuccessfulSyncAt: started } : {}) },
  });
  await db.auditLog.create({ data: { workspaceId, actorUserId: opts.actorUserId ?? null, action: "meta.synced", entityType: "IntegrationConnection", entityId: conn.id, metadata: { trigger: opts.trigger ?? "MANUAL", full: !!opts.full, ok, ...summary, failed: failed.length, tokens: tokens.length, rejectedTokens: rejected.size } } });
  return { ran: true, ok, accounts: accounts.length, added: counts.added, updated: counts.updated, unchanged: counts.unchanged, superseded, failed, error };
}

/** Start a sync from the app. Runs in the background; the Settings card shows progress. */
export async function startMetaSync(ctx: WorkspaceContext, input: { full: boolean }) {
  assertCan(ctx, "sync.run");
  await rateLimit(`meta-sync:${ctx.workspaceId}`, 12, 3600);
  const conn = await db.integrationConnection.findUnique({ where: { workspaceId_provider: { workspaceId: ctx.workspaceId, provider: META } } });
  if (!conn || conn.status === "NOT_CONFIGURED") throw new InputError("Save a Meta access token in Settings first");
  if (conn.status !== "CONNECTED") throw new InputError("Run a successful connection test before syncing");
  if (conn.syncLeaseUntil && conn.syncLeaseUntil > new Date()) return { alreadyRunning: true };
  const run = () => runMetaSync(ctx.workspaceId, { full: input.full, trigger: "MANUAL", actorUserId: ctx.userId }).catch((e) => console.error("[meta] background sync crashed", e));
  if (process.env.SYNC_BACKGROUND === "off") await run();
  else setImmediate(() => void run());
  return { alreadyRunning: false };
}

/** Scheduler: run the spend sync for every connected workspace whose interval has passed. */
export async function runDueMetaSyncs(now = new Date(), partial: Partial<MetaSyncDeps> = {}) {
  const conns = await db.integrationConnection.findMany({
    where: { provider: META, status: "CONNECTED", syncIntervalMinutes: { gt: 0 } },
    select: { workspaceId: true, syncIntervalMinutes: true, lastSyncAttemptAt: true },
    orderBy: { lastSyncAttemptAt: { sort: "asc", nulls: "first" } },
    take: 50,
  });
  let ran = 0;
  for (const c of conns) {
    if (c.lastSyncAttemptAt && now.getTime() - c.lastSyncAttemptAt.getTime() < c.syncIntervalMinutes * 60_000) continue;
    try {
      const r = await runMetaSync(c.workspaceId, { trigger: "SCHEDULED" }, partial);
      if (r.ran) ran++;
    } catch (e) {
      console.error(`[meta] scheduled sync failed for workspace ${c.workspaceId}`, e instanceof Error ? e.message : e);
    }
  }
  return ran;
}
