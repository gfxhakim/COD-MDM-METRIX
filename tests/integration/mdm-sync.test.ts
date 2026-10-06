import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]) }));

import { db } from "@/server/db";
import { createWorkspace } from "@/server/repositories/workspaces";
import { resolveWorkspaceContext } from "@/server/tenancy";
import { createMockAdapter } from "@/server/mdm/mock";
import { processDueJobs, runSyncJob, startSync } from "@/server/mdm/sync";
import { applyStatusDefaults } from "@/server/mdm/statuses";
import { MdmError, type MdmOrder, type MdmParcel } from "@/server/mdm/types";
import { addMember, callerFor, cost, makeTenant, makeUser } from "../helpers";

type Tenant = Awaited<ReturnType<typeof makeTenant>>;
const SECRET = "mdm_live_SUPERSECRET_9876";
const noSleep = async () => {};

const parcel = (trackingId: string, over: Partial<MdmParcel> = {}): MdmParcel => ({
  trackingId, reference: null, sourceOrderId: null, status: "in_transit", statusAt: new Date("2026-09-20T10:00:00Z"), codAmount: 390000, currency: "DZD",
  shippingFee: 60000, returnFee: 25000, wilaya: "Alger", dispatchedAt: new Date("2026-09-19T10:00:00Z"), deliveredAt: null, returnedAt: null,
  events: [{ status: "dispatched", at: new Date("2026-09-19T10:00:00Z") }, { status: "in_transit", at: new Date("2026-09-20T10:00:00Z") }],
  raw: { tracking: trackingId, recipient_phone: "0551234567", status: "in_transit" }, ...over,
});

let t: Tenant;
let orderA: string;
let orderB: string;

async function connect(tenant: Tenant) {
  await tenant.caller.integrations.saveMdmCredential({ credential: SECRET });
  await db.integrationConnection.updateMany({ where: { workspaceId: tenant.ws.id }, data: { status: "CONNECTED" } });
}

async function run(fixtures: MdmParcel[], opts: { failures?: Record<number, MdmError[]>; pageSize?: number } = {}) {
  const { job } = await startSync(t.ctx, { mode: "FULL" });
  const factory = async () => ({ adapter: createMockAdapter({ fixtures, credential: SECRET, failures: opts.failures }), connection: null });
  return runSyncJob(job.id, { adapterFactory: factory, sleep: noSleep, pageSize: opts.pageSize ?? 2 });
}

beforeAll(async () => {
  t = await makeTenant("SyncA");
  const product = await t.caller.products.create({ name: "Lamp", sku: "LMP", cost });
  const mk = (n: string, status: "PENDING" | "CONFIRMED") => t.caller.orders.create({ orderNumber: n, placedAt: new Date("2026-09-18T10:00:00Z"), status, codAmount: 390000, lines: [{ productId: product.id, quantity: 1, unitPrice: 390000 }] });
  orderA = (await mk("ES-1001", "CONFIRMED")).id;
  orderB = (await mk("ES-1002", "PENDING")).id;
  await db.order.update({ where: { id: orderB }, data: { externalOrderId: "shop_555" } });
  await connect(t);
});

describe("credentials", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("encrypts at rest and only ever returns a mask", async () => {
    const view = await t.caller.integrations.mdm();
    expect(view).toMatchObject({ hasCredential: true, maskedLabel: "••••9876", adapter: "live", liveAdapterReady: true });
    expect(JSON.stringify(view)).not.toContain("SUPERSECRET");
    const row = await db.integrationConnection.findFirstOrThrow({ where: { workspaceId: t.ws.id } });
    expect(row.encryptedCredential).toMatch(/^v1:/);
    expect(row.encryptedCredential).not.toContain("SUPERSECRET");
    const logs = await db.auditLog.findMany({ where: { workspaceId: t.ws.id } });
    expect(JSON.stringify(logs)).not.toContain("SUPERSECRET");
  });

  it("live connection test sends the decrypted key only to MDM and gates sync on success", async () => {
    const other = await makeTenant("SyncLive");
    await other.caller.integrations.saveMdmCredential({ credential: SECRET });
    const seen: { url: string; key: string | null }[] = [];
    let accept = false;
    vi.stubGlobal("fetch", vi.fn(async (url: URL, init: RequestInit) => {
      seen.push({ url: String(url), key: (init.headers as Headers).get("x-api-key") });
      if (!accept) return new Response("", { status: 401 });
      const path = new URL(String(url)).pathname;
      const body = path === "/api/auth/me" ? { trackingId: "ACC-1", role: "seller", firstName: "Owner" } : { statuses: ["delivered", "delivered-partially"], types: [], subTypes: [], paymentMethods: [] };
      return new Response(JSON.stringify(body), { status: 200 });
    }));
    const bad = await other.caller.integrations.testMdm();
    expect(bad).toMatchObject({ ok: false, connection: { status: "ERROR" } });
    await expect(other.caller.sync.start({ mode: "FULL" })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    accept = true;
    const ok = await other.caller.integrations.testMdm();
    expect(ok).toMatchObject({ ok: true, accountLabel: "MDM account ACC-1 (seller)", unmappedStatuses: ["delivered-partially"], connection: { status: "CONNECTED" } });
    expect(ok.message).toContain("1 MDM status is not mapped yet");
    expect(seen.every((c) => c.url.startsWith("https://api.mdm.express/") && c.key === SECRET && !c.url.includes(SECRET))).toBe(true);
    expect(JSON.stringify(ok)).not.toContain(SECRET);
  });

  it("live sync pulls parcels and matches them through MDM's order externalId", async () => {
    const live = await makeTenant("SyncLiveRun");
    const product = await live.caller.products.create({ name: "Lamp", sku: "LMP", cost });
    const order = await live.caller.orders.create({ orderNumber: "ES-2001", placedAt: new Date("2026-09-18T10:00:00Z"), status: "PENDING", codAmount: 390000, lines: [{ productId: product.id, quantity: 1, unitPrice: 390000 }] });
    await connect(live);
    const mdmOrder = { trackingId: "MO-1", externalId: "ES-2001", ip: "203.0.113.7", status: "outForDelivery", confirmed: true, createdAt: "2026-09-18T10:00:00.000Z", totalPrice: 3900, currency: "DZD", client: { firstName: "Amina", lastName: "Placeholder", phone: "0551111111" }, destination: { stateName: "Oran", streetAddress: "12 rue X" }, utm: { source: "facebook", content: "120000000000021" }, products: [] };
    vi.stubGlobal("fetch", vi.fn(async (url: URL, init: RequestInit) => {
      const path = new URL(String(url)).pathname;
      const req = JSON.parse(String(init.body ?? "{}"));
      const body = path === "/api/v2/orders/search"
        ? { pagination: { page: 1, hasMore: false, nextPage: null, total: 2 }, list: req.filters?.trackingId ? [{ trackingId: "MO-1", externalId: "ES-2001" }] : [mdmOrder, { trackingId: "MO-BROKEN" }] }
        : { pagination: { page: 1, hasMore: false, nextPage: null, total: 1 }, list: [{ trackingId: "LP-1", orderId: "MO-1", currency: "DZD", status: "outForDelivery", statusDate: "2026-09-20T10:00:00.000Z", pricing: { totalToPayFromClient: 3900 }, fees: { shipping: 600, return: 250 }, destinationAddress: { stateName: "Oran" }, client: { firstName: "Amina", phone: "0551111111" }, statusHistory: [{ date: "2026-09-20T10:00:00.000Z", status: "outForDelivery", responsible: { firstName: "Courier" } }] }] };
      return new Response(JSON.stringify(body), { status: 200 });
    }));
    const { job } = await startSync(live.ctx, { mode: "FULL" });
    const done = await runSyncJob(job.id, { sleep: noSleep });
    // The order MDM can't be read is skipped and reported; everything else syncs.
    expect(done).toMatchObject({ status: "PARTIAL", adapter: "live", ordersUpdatedCount: 1, failedCount: 1 });
    expect(await db.syncItem.findFirstOrThrow({ where: { jobId: job.id, result: "FAILED" } })).toMatchObject({ entityType: "order", providerId: "MO-BROKEN" });
    expect(await db.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ mdmOrderId: "MO-1", status: "CONFIRMED", utmContent: "120000000000021" });
    const p = await db.parcel.findFirstOrThrow({ where: { workspaceId: live.ws.id, trackingId: "LP-1" } });
    expect(p).toMatchObject({ orderId: order.id, matchMethod: "MDM_ORDER", normalizedStatus: "SHIPPED", codAmount: 390000, wilaya: "Oran" });
    const stored = JSON.stringify([await db.parcel.findMany({ where: { workspaceId: live.ws.id } }), await db.order.findMany({ where: { workspaceId: live.ws.id } }), await db.rawExternalRecord.findMany({ where: { workspaceId: live.ws.id } })]);
    expect(stored).not.toMatch(/Amina|Placeholder|0551111111|551111111|Courier|203\.0\.113\.7|12 rue X/);
    // The customer is kept only encrypted, and shown to the owner through the app.
    expect((await live.caller.orders.getDetails({ id: order.id })).customer).toEqual({ name: "Amina Placeholder", phone: "0551111111", phone2: null, address: "12 rue X" });
  });

  it("demo workspaces use the labelled mock adapter and can reject bad keys", async () => {
    const user = await makeUser("Demo");
    const ws = await createWorkspace(user.id, { name: "Demo test", isDemo: true });
    const caller = callerFor(user, ws.id);
    await caller.integrations.saveMdmCredential({ credential: "invalid-demo-key" });
    expect((await caller.integrations.testMdm()).connection.status).toBe("ERROR");
    await caller.integrations.saveMdmCredential({ credential: "demo-key-123456" });
    const ok = await caller.integrations.testMdm();
    expect(ok).toMatchObject({ ok: true, connection: { status: "CONNECTED", adapter: "mock" } });
    expect(ok.message).toContain("demo fixtures");
    const { jobId } = await caller.sync.start({ mode: "FULL" });
    const job = await runSyncJob(jobId, { sleep: noSleep });
    expect(job?.status).toBe("SUCCEEDED");
    expect(job?.adapter).toBe("mock");
    expect(await db.parcel.count({ where: { workspaceId: ws.id, isDemoFixture: true } })).toBeGreaterThan(0);
  });

  it("enforces roles and tenant isolation", async () => {
    const analyst = await addMember(t.ws.id, "ANALYST");
    await expect(analyst.caller.integrations.saveMdmCredential({ credential: "x".repeat(20) })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(analyst.caller.sync.start({ mode: "FULL" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await analyst.caller.integrations.mdm()).maskedLabel).toBe("••••9876");
    await expect(t.caller.integrations.saveMdmCredential({ credential: SECRET, baseUrl: "https://169.254.169.254" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("sync engine", () => {
  const fixtures = () => [
    parcel("MDM-1", { reference: "es 1001" }),
    parcel("MDM-2", { reference: "WEB-9", sourceOrderId: "shop_555" }),
    parcel("MDM-3", { reference: "NOPE-1", status: "held_at_hub", events: [{ status: "held_at_hub", at: new Date("2026-09-20T10:00:00Z") }] }),
  ];

  it("imports parcels, matches by reference then source ID, and queues the rest for review", async () => {
    const job = await run(fixtures());
    expect(job).toMatchObject({ status: "SUCCEEDED", addedCount: 3, unmatchedCount: 1, unknownStatusCount: 1, page: 2, activeLock: null });
    const p1 = await db.parcel.findFirstOrThrow({ where: { workspaceId: t.ws.id, trackingId: "MDM-1" }, include: { events: true } });
    expect(p1).toMatchObject({ orderId: orderA, matchMethod: "ORDER_REFERENCE", normalizedStatus: "SHIPPED" });
    expect(p1.events).toHaveLength(2);
    const p2 = await db.parcel.findFirstOrThrow({ where: { workspaceId: t.ws.id, trackingId: "MDM-2" } });
    expect(p2).toMatchObject({ orderId: orderB, matchMethod: "SOURCE_ORDER_ID" });
    expect((await db.order.findUniqueOrThrow({ where: { id: orderB } })).status).toBe("CONFIRMED");
    const un = await t.caller.sync.unmatched({ status: "OPEN" });
    expect(un.map((u) => u.externalId)).toEqual(["MDM-3"]);
    expect(un[0].reason).toContain("no order with reference NOPE-1");
    const raw = await db.rawExternalRecord.findMany({ where: { workspaceId: t.ws.id } });
    expect(raw).toHaveLength(3);
    expect(JSON.stringify(raw)).not.toContain("0551234567");
  });

  it("is idempotent: the same data again changes nothing", async () => {
    const job = await run(fixtures());
    expect(job).toMatchObject({ status: "SUCCEEDED", addedCount: 0, updatedCount: 0, unchangedCount: 3 });
    expect(await db.parcel.count({ where: { workspaceId: t.ws.id } })).toBe(3);
    expect(await db.parcelStatusEvent.count({ where: { workspaceId: t.ws.id } })).toBe(5);
    expect(await db.rawExternalRecord.count({ where: { workspaceId: t.ws.id } })).toBe(3);
  });

  it("applies status updates, keeps manual matches, and resolves unmatched parcels once their order appears", async () => {
    await db.parcel.updateMany({ where: { workspaceId: t.ws.id, trackingId: "MDM-2" }, data: { orderId: orderA, matchMethod: "MANUAL" } });
    await t.caller.orders.create({ orderNumber: "NOPE-1", placedAt: new Date("2026-09-18T10:00:00Z"), status: "CONFIRMED", codAmount: 1, lines: [{ productId: (await db.product.findFirstOrThrow({ where: { workspaceId: t.ws.id } })).id, quantity: 1, unitPrice: 1 }] });
    const delivered = new Date("2026-09-21T09:00:00Z");
    const f = fixtures();
    f[0] = { ...f[0], status: "delivered", statusAt: delivered, events: [...f[0].events, { status: "delivered", at: delivered }], raw: { tracking: "MDM-1", status: "delivered" } };
    const job = await run(f);
    expect(job).toMatchObject({ updatedCount: 2, unmatchedCount: 0 });
    expect(await db.parcel.findFirstOrThrow({ where: { workspaceId: t.ws.id, trackingId: "MDM-1" } })).toMatchObject({ normalizedStatus: "DELIVERED", deliveredAt: delivered });
    expect(await db.parcel.findFirstOrThrow({ where: { workspaceId: t.ws.id, trackingId: "MDM-2" } })).toMatchObject({ orderId: orderA, matchMethod: "MANUAL" });
    expect(await t.caller.sync.unmatched({ status: "OPEN" })).toEqual([]);
  });

  it("maps unknown statuses and re-normalizes existing parcels", async () => {
    expect(await t.caller.sync.unknownStatuses()).toEqual([{ providerStatus: "held_at_hub", parcels: 1 }]);
    expect(await t.caller.sync.mapStatus({ providerStatus: "Held at hub", normalizedStatus: "SHIPPED" })).toEqual({ parcels: 1 });
    expect(await t.caller.sync.unknownStatuses()).toEqual([]);
  });

  it("retries rate limits with backoff within a page", async () => {
    const sleeps: number[] = [];
    const { job } = await startSync(t.ctx, { mode: "FULL" });
    const factory = async () => ({ adapter: createMockAdapter({ fixtures: fixtures(), credential: SECRET, failures: { 1: [new MdmError("busy", "RATE_LIMIT", 3000), new MdmError("oops", "SERVER")] } }), connection: null });
    const done = await runSyncJob(job.id, { adapterFactory: factory, sleep: async (ms) => void sleeps.push(ms), pageSize: 2 });
    expect(done?.status).toBe("SUCCEEDED");
    expect(sleeps[0]).toBe(3000);
    expect(sleeps).toHaveLength(2);
  });

  it("re-queues the job to resume from its cursor after repeated provider failures", async () => {
    const busy = () => Array.from({ length: 6 }, () => new MdmError("down", "SERVER"));
    // Other test files share this database and may leave jobs queued; a worker pass would run those too.
    await db.syncJob.updateMany({ where: { status: "QUEUED", workspaceId: { not: t.ws.id } }, data: { status: "CANCELED", activeLock: null } });
    const { job } = await startSync(t.ctx, { mode: "FULL" });
    const failing = async () => ({ adapter: createMockAdapter({ fixtures: fixtures(), credential: SECRET, failures: { 1: busy() } }), connection: null });
    const first = await runSyncJob(job.id, { adapterFactory: failing, sleep: noSleep, pageSize: 2 });
    expect(first).toMatchObject({ status: "QUEUED", attempt: 1, cursor: "1", page: 1 });
    expect(first?.nextRunAt?.getTime()).toBeGreaterThan(Date.now());
    // Not due yet → a worker pass skips it; the lock still blocks a parallel sync.
    expect(await processDueJobs({ adapterFactory: failing, sleep: noSleep })).toEqual([]);
    expect((await startSync(t.ctx, { mode: "FULL" })).alreadyRunning).toBe(true);
    const later = () => new Date(Date.now() + 3_600_000);
    const healthy = async () => ({ adapter: createMockAdapter({ fixtures: fixtures(), credential: SECRET }), connection: null });
    const [resumed] = await processDueJobs({ adapterFactory: healthy, sleep: noSleep, now: later, pageSize: 2 });
    expect(resumed).toMatchObject({ status: "SUCCEEDED", page: 2, unchangedCount: 3, activeLock: null });
  });

  it("fails cleanly on an auth error and marks the connection", async () => {
    const { job } = await startSync(t.ctx, { mode: "FULL" });
    const factory = async () => ({ adapter: createMockAdapter({ fixtures: fixtures(), credential: "invalid-now" }), connection: null });
    const done = await runSyncJob(job.id, { adapterFactory: factory, sleep: noSleep });
    expect(done).toMatchObject({ status: "FAILED", activeLock: null });
    const c = await t.caller.integrations.mdm();
    expect(c).toMatchObject({ status: "ERROR", lastError: "MDM rejected the credential (demo)" });
    await db.integrationConnection.updateMany({ where: { workspaceId: t.ws.id }, data: { status: "CONNECTED" } });
  });

  it("allows one active sync per workspace and supports cancel", async () => {
    const a = await t.caller.sync.start({ mode: "FULL" });
    const b = await t.caller.sync.start({ mode: "FULL" });
    expect(b).toEqual({ jobId: a.jobId, alreadyRunning: true });
    await t.caller.sync.cancel({ id: a.jobId });
    expect((await t.caller.sync.get({ id: a.jobId })).job.status).toBe("CANCELED");
    expect((await t.caller.sync.start({ mode: "FULL" })).alreadyRunning).toBe(false);
    const running = await db.syncJob.findFirstOrThrow({ where: { workspaceId: t.ws.id, status: "QUEUED" } });
    await db.syncJob.update({ where: { id: running.id }, data: { cancelRequested: true } });
    const done = await runSyncJob(running.id, { adapterFactory: async () => ({ adapter: createMockAdapter({ fixtures: fixtures(), credential: SECRET }), connection: null }), sleep: noSleep });
    expect(done?.status).toBe("CANCELED");
  });

  it("keeps sync data isolated between workspaces", async () => {
    const other = await makeTenant("SyncB");
    const mine = await t.caller.sync.list({ limit: 5 });
    await expect(other.caller.sync.get({ id: mine[0].id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(other.caller.sync.cancel({ id: mine[0].id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await other.caller.sync.unmatched({ status: "RESOLVED" })).toEqual([]);
    expect(JSON.stringify(mine)).not.toContain("activeLock");
    const ctxB = (await resolveWorkspaceContext(other.user.id, other.ws.id))!;
    await expect(startSync(ctxB, { mode: "FULL" })).rejects.toThrow(/Save an MDM API key/);
  });
});

describe("built-in status defaults", () => {
  const NEW_DEFAULTS = ["return_ready", "delivery_failed", "delivery_attempt_failed", "postponed", "received", "out_of_stock"];
  const at = new Date("2026-09-22T08:00:00Z");

  it("re-sorts parcels stuck as unknown, keeps the workspace's own choices, and adds the missing Settings rows", async () => {
    const d = await makeTenant("SyncDefaults");
    // A workspace created before these defaults existed, whose owner already mapped "received" themselves.
    await db.statusMapping.deleteMany({ where: { workspaceId: d.ws.id, providerStatus: { in: NEW_DEFAULTS } } });
    await db.statusMapping.create({ data: { workspaceId: d.ws.id, provider: "MDM_EXPRESS", providerStatus: "received", normalizedStatus: "CONFIRMED" } });
    const product = await d.caller.products.create({ name: "Lamp", sku: "LMP", cost });
    const order = await d.caller.orders.create({ orderNumber: "ES-7", placedAt: new Date("2026-09-18T10:00:00Z"), status: "PENDING", codAmount: 390000, lines: [{ productId: product.id, quantity: 1, unitPrice: 390000 }] });
    const mk = (trackingId: string, providerStatus: string, orderId: string | null = null) =>
      db.parcel.create({ data: { workspaceId: d.ws.id, provider: "MDM_EXPRESS", trackingId, providerStatus, normalizedStatus: "UNKNOWN", lastProviderUpdateAt: at, orderId,
        events: { create: { workspaceId: d.ws.id, providerStatus, normalizedStatus: "UNKNOWN", occurredAt: at, source: "MDM_EXPRESS", eventHash: `h-${trackingId}` } } } });
    await mk("P-RR", "return-ready");
    await mk("P-DF", "delivery-failed");
    await mk("P-DAF", "delivery-attempt-failed", order.id);
    await mk("P-REC", "received");
    await mk("P-OOS", "out-of-stock");
    await mk("P-ODD", "held_at_hub");

    const res = await applyStatusDefaults(d.ws.id);
    expect(res.added.sort()).toEqual(NEW_DEFAULTS.filter((k) => k !== "received").sort());
    expect(res.parcels).toBe(5);
    const byId = Object.fromEntries((await db.parcel.findMany({ where: { workspaceId: d.ws.id }, include: { events: true } })).map((p) => [p.trackingId, p]));
    expect(byId["P-RR"]).toMatchObject({ normalizedStatus: "RETURNED", returnedAt: at, dispatchedAt: at });
    expect(byId["P-DF"]).toMatchObject({ normalizedStatus: "RETURNED", returnedAt: at });
    expect(byId["P-DAF"]).toMatchObject({ normalizedStatus: "SHIPPED", dispatchedAt: at, returnedAt: null });
    expect(byId["P-REC"]).toMatchObject({ normalizedStatus: "CONFIRMED", dispatchedAt: null });
    expect(byId["P-OOS"]).toMatchObject({ normalizedStatus: "PENDING", dispatchedAt: null });
    expect(byId["P-ODD"].normalizedStatus).toBe("UNKNOWN");
    expect(byId["P-RR"].events[0].normalizedStatus).toBe("RETURNED");
    expect(byId["P-ODD"].events[0].normalizedStatus).toBe("UNKNOWN");
    // The shipped parcel confirms its pending order, as a sync would.
    expect(await db.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ status: "CONFIRMED", confirmedAt: at });
    expect(await d.caller.sync.unknownStatuses()).toEqual([{ providerStatus: "held_at_hub", parcels: 1 }]);
    const rows = await d.caller.sync.statusMappings();
    expect(rows.find((r) => r.providerStatus === "received")?.normalizedStatus).toBe("CONFIRMED");
    expect(rows.find((r) => r.providerStatus === "return_ready")?.normalizedStatus).toBe("RETURNED");
    expect(await db.auditLog.count({ where: { workspaceId: d.ws.id, action: "status_mapping.defaults_applied" } })).toBe(1);

    // Running again changes nothing and logs nothing.
    expect(await applyStatusDefaults(d.ws.id)).toEqual({ added: [], parcels: 0, orders: { confirmed: 0, canceled: 0 } });
    expect(await db.auditLog.count({ where: { workspaceId: d.ws.id, action: "status_mapping.defaults_applied" } })).toBe(1);
  });

  it("makes orders follow their parcels: confirmed once prepared, canceled when the client cancels, untouched while calling", async () => {
    const d = await makeTenant("SyncOrders");
    await connect(d);
    const product = await d.caller.products.create({ name: "Lamp", sku: "LMP", cost });
    const mk = (n: string, status: "PENDING" | "CONFIRMED") => d.caller.orders.create({ orderNumber: n, placedAt: new Date("2026-09-18T10:00:00Z"), status, codAmount: 390000, lines: [{ productId: product.id, quantity: 1, unitPrice: 390000 }] });
    const packaged = await mk("ES-21", "PENDING");
    const calling = await mk("ES-22", "PENDING");
    const canceledLate = await mk("ES-23", "CONFIRMED");
    const f = (trackingId: string, reference: string, status: string) =>
      parcel(trackingId, { reference, status, dispatchedAt: null, events: [{ status, at: new Date("2026-09-20T10:00:00Z") }] });
    const { job } = await startSync(d.ctx, { mode: "FULL" });
    const fixtures = [f("M-21", "ES-21", "packaged"), f("M-22", "ES-22", "not-answered"), f("M-23", "ES-23", "canceled-after-confirmation")];
    const factory = async () => ({ adapter: createMockAdapter({ fixtures, credential: SECRET }), connection: null });
    expect(await runSyncJob(job.id, { adapterFactory: factory, sleep: noSleep })).toMatchObject({ status: "SUCCEEDED", unknownStatusCount: 0 });

    const get = (id: string) => db.order.findUniqueOrThrow({ where: { id } });
    expect(await get(packaged.id)).toMatchObject({ status: "CONFIRMED" });
    expect((await get(packaged.id)).confirmedAt).not.toBeNull();
    expect(await get(calling.id)).toMatchObject({ status: "PENDING", confirmedAt: null });
    // Counted as canceled, not confirmed, even though it was confirmed before.
    expect(await get(canceledLate.id)).toMatchObject({ status: "CANCELED", confirmedAt: null });
    const report = await d.caller.reports.dashboard({ from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-09-30T23:59:59Z") });
    expect(report.metrics).toMatchObject({ placed: 3, confirmed: 1, shipped: 0 });
  });

  it("runs at the start of every sync, even for parcels MDM doesn't send again", async () => {
    const d = await makeTenant("SyncDefaults2");
    await connect(d);
    await db.parcel.create({ data: { workspaceId: d.ws.id, provider: "MDM_EXPRESS", trackingId: "P-PP", providerStatus: "postponed", normalizedStatus: "UNKNOWN", lastProviderUpdateAt: at } });
    const { job } = await startSync(d.ctx, { mode: "INCREMENTAL" });
    const factory = async () => ({ adapter: createMockAdapter({ fixtures: [], credential: SECRET }), connection: null });
    expect(await runSyncJob(job.id, { adapterFactory: factory, sleep: noSleep })).toMatchObject({ status: "SUCCEEDED" });
    expect((await db.parcel.findFirstOrThrow({ where: { workspaceId: d.ws.id, trackingId: "P-PP" } })).normalizedStatus).toBe("SHIPPED");
  });
});

describe("MDM orders", () => {
  const AT = new Date("2026-09-20T10:00:00Z");
  const mdmOrder = (trackingId: string, over: Partial<MdmOrder> = {}): MdmOrder => ({
    trackingId, externalId: null, status: "pending", statusAt: AT, confirmed: false, placedAt: new Date("2026-09-20T09:00:00Z"),
    total: 390000, currency: "DZD", phone: "0551234567", wilaya: "Alger", city: "Bab Ezzouar",
    utm: { source: "facebook", medium: "paid", campaign: "Spring", content: null },
    products: [{ ref: "LMP", variantOf: null, name: "Lamp", quantity: 1, unitPrice: 390000 }], ...over,
  });
  const withContent = (content: string) => ({ source: "facebook", medium: "paid", campaign: "Spring", content });

  async function sync(d: Tenant, opts: Parameters<typeof createMockAdapter>[0], mode: "FULL" | "INCREMENTAL" = "FULL") {
    const adapter = createMockAdapter(opts);
    const { job } = await startSync(d.ctx, { mode });
    const done = await runSyncJob(job.id, { adapterFactory: async () => ({ adapter, connection: null }), sleep: noSleep, pageSize: 2 });
    return { job, done: done!, adapter };
  }

  it("brings in orders with their content ID and counts them the way the business does", async () => {
    const d = await makeTenant("OrdersA");
    const product = await d.caller.products.create({ name: "Lamp", sku: "LMP", cost });
    await connect(d);
    const orders = [
      mdmOrder("ORD-A1", { status: "packaged", confirmed: true, utm: withContent("120000000000009") }),
      mdmOrder("ORD-A2", { status: "not_answered" }),
      mdmOrder("ORD-A3", { status: "canceled_after_confirmation", confirmed: true, utm: withContent("120000000000009") }),
      mdmOrder("ORD-A4", { status: "delivered", confirmed: true }),
    ];
    const fixtures = [parcel("P-A1", { mdmOrderId: "ORD-A1", status: "dispatched", events: [{ status: "dispatched", at: AT }] })];
    const { done, adapter } = await sync(d, { fixtures, credential: SECRET, orders, orderHistory: { "ORD-A2": withContent("120000000000010") } });
    expect(done).toMatchObject({ status: "SUCCEEDED", mode: "FULL", ordersAddedCount: 4, ordersUpdatedCount: 0, ordersWithContentCount: 3, ordersNote: null, addedCount: 1, unmatchedCount: 0 });
    // Only orders without a content ID of their own are looked up in their status history.
    expect(adapter.historyCalls).toEqual(["ORD-A2", "ORD-A4"]);

    const get = (mdmOrderId: string) => db.order.findFirstOrThrow({ where: { workspaceId: d.ws.id, mdmOrderId }, include: { lines: true, attribution: { include: { creative: true } } } });
    const a1 = await get("ORD-A1");
    expect(a1).toMatchObject({ source: "MDM_EXPRESS", externalOrderId: "ORD-A1", status: "CONFIRMED", codAmount: 390000, wilaya: "Alger", utmContent: "120000000000009", phoneMasked: null });
    expect(a1.phoneHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a1.lines).toMatchObject([{ productId: product.id, quantity: 1, unitPrice: 390000 }]);
    expect(a1.attribution).toMatchObject({ method: "UTM_CONTENT", creative: { externalCreativeId: "120000000000009", platform: "META", productId: product.id } });
    expect(await get("ORD-A2")).toMatchObject({ status: "PENDING", confirmedAt: null, utmContent: "120000000000010", attribution: { method: "UTM_CONTENT" } });
    // Canceled after confirming counts as canceled, not confirmed.
    expect(await get("ORD-A3")).toMatchObject({ status: "CANCELED", confirmedAt: null, attribution: { creativeId: a1.attribution!.creativeId } });
    expect(await get("ORD-A4")).toMatchObject({ status: "CONFIRMED", utmContent: null, attribution: { method: "NONE", creativeId: null } });
    expect((await get("ORD-A4")).mdmHistoryCheckedAt).not.toBeNull();

    // MDM's own parcel → order link.
    expect(await db.parcel.findFirstOrThrow({ where: { workspaceId: d.ws.id, trackingId: "P-A1" } })).toMatchObject({ orderId: a1.id, matchMethod: "MDM_ORDER", matchConfidence: 1, mdmOrderId: "ORD-A1" });

    const report = await d.caller.reports.dashboard({ from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-09-30T23:59:59Z") });
    expect(report.metrics).toMatchObject({ placed: 4, confirmed: 2, shipped: 1 });

    // Neither the phone number nor any part of it is stored.
    const stored = JSON.stringify(await db.order.findMany({ where: { workspaceId: d.ws.id } }));
    expect(stored).not.toMatch(/0551234567|551234567|1234567/);

    // The next sync is incremental, re-reads nothing it already looked up, and changes nothing.
    const again = await sync(d, { fixtures, credential: SECRET, orders, orderHistory: {} }, "INCREMENTAL");
    expect(again.done).toMatchObject({ status: "SUCCEEDED", mode: "INCREMENTAL", ordersAddedCount: 0, ordersUpdatedCount: 0, ordersWithContentCount: 3 });
    expect(again.adapter.historyCalls).toEqual([]);
    expect(await get("ORD-A2")).toMatchObject({ utmContent: "120000000000010" });

    // MDM moves an order on: the app follows.
    const moved = orders.map((o) => (o.trackingId === "ORD-A2" ? { ...o, status: "cancelled" } : o));
    const third = await sync(d, { fixtures, credential: SECRET, orders: moved }, "INCREMENTAL");
    expect(third.done).toMatchObject({ ordersUpdatedCount: 1 });
    expect(await get("ORD-A2")).toMatchObject({ status: "CANCELED", utmContent: "120000000000010" });
  });

  it("links every line to the workspace's only product, whatever MDM calls it", async () => {
    const d = await makeTenant("OrdersF");
    const product = await d.caller.products.create({ name: "Lamp", sku: "LMP", cost });
    await connect(d);
    const orders = [mdmOrder("ORD-F1", { status: "delivered", utm: withContent("120000000000031"), products: [{ ref: "PRD-XYZ", variantOf: null, name: "Lampe LED pro", quantity: 2, unitPrice: null }] })];
    await sync(d, { fixtures: [], credential: SECRET, orders });
    const o = await db.order.findFirstOrThrow({ where: { workspaceId: d.ws.id, mdmOrderId: "ORD-F1" }, include: { lines: true, attribution: { include: { creative: true } } } });
    // The price falls back to the product's sale price when MDM sends none.
    expect(o.lines).toMatchObject([{ productId: product.id, productName: "Lampe LED pro", quantity: 2, unitPrice: cost.salePrice }]);
    expect(o.attribution?.creative?.productId).toBe(product.id);

    // With a second active product, an unknown name is left unlinked rather than guessed.
    await d.caller.products.create({ name: "Fan", sku: "FAN", cost });
    await sync(d, { fixtures: [], credential: SECRET, orders: [mdmOrder("ORD-F2", { products: [{ ref: "PRD-XYZ", variantOf: null, name: "Lampe LED pro", quantity: 1, unitPrice: 390000 }] })] });
    const o2 = await db.order.findFirstOrThrow({ where: { workspaceId: d.ws.id, mdmOrderId: "ORD-F2" }, include: { lines: true } });
    expect(o2.lines).toMatchObject([{ productId: null, productName: "Lampe LED pro" }]);
  });

  it("links orders already imported from the store and keeps their own data", async () => {
    const d = await makeTenant("OrdersB");
    const product = await d.caller.products.create({ name: "Lamp", sku: "LMP", cost });
    await connect(d);
    const mk = (orderNumber: string, utmContent?: string) =>
      d.caller.orders.create({ orderNumber, placedAt: new Date("2026-09-18T10:00:00Z"), status: "PENDING", codAmount: 500000, utmContent, lines: [{ productId: product.id, quantity: 2, unitPrice: 250000 }] });
    const plain = await mk("#1001");
    const tagged = await mk("#1002", "cr_csv_02");
    // A parcel synced before its order came in, waiting in the unmatched queue.
    const loose = await db.parcel.create({ data: { workspaceId: d.ws.id, provider: "MDM_EXPRESS", trackingId: "P-B1", mdmOrderId: "ORD-B1", providerStatus: "dispatched", normalizedStatus: "SHIPPED", lastProviderUpdateAt: AT, dispatchedAt: AT } });
    await db.unmatchedRecord.create({ data: { workspaceId: d.ws.id, provider: "MDM_EXPRESS", entityType: "parcel", externalId: "P-B1", reason: "no order reference", parcelId: loose.id } });

    const orders = [
      mdmOrder("ORD-B1", { externalId: "#1001", status: "packaged", total: 999900, utm: withContent("120000000000011") }),
      mdmOrder("ORD-B2", { externalId: "1002", status: "cancelled", utm: withContent("120000000000012") }),
    ];
    const { done } = await sync(d, { fixtures: [], credential: SECRET, orders });
    expect(done).toMatchObject({ status: "SUCCEEDED", ordersAddedCount: 0, ordersUpdatedCount: 2 });
    expect(await db.order.count({ where: { workspaceId: d.ws.id, source: "MDM_EXPRESS" } })).toBe(0);

    const p = await db.order.findUniqueOrThrow({ where: { id: plain.id }, include: { lines: true, attribution: { include: { creative: true } } } });
    // Store amounts and lines stay; MDM adds its status and the content ID the store order lacked.
    expect(p).toMatchObject({ source: "MANUAL", mdmOrderId: "ORD-B1", status: "CONFIRMED", codAmount: 500000, utmContent: "120000000000011", attribution: { method: "UTM_CONTENT", creative: { externalCreativeId: "120000000000011" } } });
    expect(p.lines).toMatchObject([{ quantity: 2, unitPrice: 250000 }]);
    const t2 = await db.order.findUniqueOrThrow({ where: { id: tagged.id } });
    expect(t2).toMatchObject({ mdmOrderId: "ORD-B2", status: "CANCELED", utmContent: "cr_csv_02" });
    expect(await db.creative.count({ where: { workspaceId: d.ws.id, externalCreativeId: "120000000000012" } })).toBe(0);

    expect(await db.parcel.findUniqueOrThrow({ where: { id: loose.id } })).toMatchObject({ orderId: plain.id, matchMethod: "MDM_ORDER" });
    expect(await db.unmatchedRecord.findFirstOrThrow({ where: { workspaceId: d.ws.id, externalId: "P-B1" } })).toMatchObject({ status: "RESOLVED" });
  });

  it("never imports an order twice when a CSV repeats one MDM already brought in", async () => {
    const d = await makeTenant("OrdersC");
    await d.caller.products.create({ name: "Lamp", sku: "LMP", cost });
    await connect(d);
    await sync(d, { fixtures: [], credential: SECRET, orders: [mdmOrder("ORD-C1", { externalId: "#2001", status: "packaged" })] });
    const csvText = "Name,Id,Created at,Lineitem sku,Lineitem quantity,Lineitem price,Total,Status,utm_content\n#2001,5001,2026-09-20 09:00,LMP,1,3900,3900,pending,cr_hook_02\n#2002,5002,2026-09-20 10:00,LMP,1,3900,3900,pending,cr_hook_03";
    const mapping = { orderNumber: "Name", externalOrderId: "Id", placedAt: "Created at", sku: "Lineitem sku", quantity: "Lineitem quantity", unitPrice: "Lineitem price", total: "Total", status: "Status", utmContent: "utm_content" };
    const req = { kind: "ORDERS" as const, fileName: "orders.csv", csvText, fileSize: csvText.length, mapping, options: { dateFormat: "AUTO" as const, source: "SHOPIFY" as const } };
    expect((await d.caller.imports.preview(req)).counts).toMatchObject({ new: 1, duplicate: 1 });
    expect(await d.caller.imports.commit(req)).toMatchObject({ importedRows: 1, duplicateRows: 1, updatedRows: 1 });
    expect(await db.order.count({ where: { workspaceId: d.ws.id } })).toBe(2);
    // The file's content ID fills in the synced order, which had none.
    expect(await db.order.findFirstOrThrow({ where: { workspaceId: d.ws.id, mdmOrderId: "ORD-C1" }, include: { attribution: true } })).toMatchObject({ status: "CONFIRMED", utmContent: "cr_hook_02", attribution: { rawUtmContent: "cr_hook_02" } });
  });

  it("re-reads everything once after the update, then goes back to incremental syncs", async () => {
    const d = await makeTenant("OrdersD");
    await connect(d);
    await db.integrationConnection.updateMany({ where: { workspaceId: d.ws.id }, data: { lastSuccessfulSyncAt: AT } });
    const first = await sync(d, { fixtures: [], credential: SECRET, orders: [] }, "INCREMENTAL");
    expect(first.done).toMatchObject({ status: "SUCCEEDED", mode: "FULL", updatedSince: null });
    expect((await db.integrationConnection.findFirstOrThrow({ where: { workspaceId: d.ws.id } })).ordersSyncedAt).not.toBeNull();
    const next = await sync(d, { fixtures: [], credential: SECRET, orders: [] }, "INCREMENTAL");
    expect(next.done).toMatchObject({ mode: "INCREMENTAL" });
  });

  it("still syncs parcels when the key can't read orders or their history, and retries rate limits", async () => {
    const d = await makeTenant("OrdersE");
    await connect(d);
    const noOrders = await sync(d, { fixtures: [parcel("P-E1")], credential: SECRET, orders: [mdmOrder("ORD-E1")], orderFailures: { 0: [new MdmError("forbidden", "AUTH")] } });
    expect(noOrders.done).toMatchObject({ status: "SUCCEEDED", addedCount: 1, ordersAddedCount: 0 });
    expect(noOrders.done.ordersNote).toContain("can't read orders");
    expect((await db.integrationConnection.findFirstOrThrow({ where: { workspaceId: d.ws.id } })).status).toBe("CONNECTED");

    const orders = [mdmOrder("ORD-E2"), mdmOrder("ORD-E3"), mdmOrder("ORD-E4")];
    const limited = await sync(d, { fixtures: [], credential: SECRET, orders, orderHistory: { "ORD-E2": withContent("120000000000013") }, historyFailures: { "ORD-E2": [new MdmError("slow down", "RATE_LIMIT", 10)], "ORD-E3": [new MdmError("forbidden", "AUTH")] } });
    expect(limited.done).toMatchObject({ status: "SUCCEEDED", ordersAddedCount: 3, ordersWithContentCount: 1 });
    expect(limited.done.ordersNote).toContain("can't read order history");
    // After the history refusal, no more history reads in this sync.
    expect(limited.adapter.historyCalls).toEqual(["ORD-E2", "ORD-E2", "ORD-E3"]);
  });
});
