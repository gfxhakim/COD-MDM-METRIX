import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]) }));

import { db } from "@/server/db";
import { createWorkspace } from "@/server/repositories/workspaces";
import { resolveWorkspaceContext } from "@/server/tenancy";
import { createMockAdapter } from "@/server/mdm/mock";
import { processDueJobs, runSyncJob, startSync } from "@/server/mdm/sync";
import { MdmError, type MdmParcel } from "@/server/mdm/types";
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
      const body = path === "/api/auth/me" ? { trackingId: "ACC-1", role: "seller", firstName: "Owner" } : { statuses: ["delivered", "postponed"], types: [], subTypes: [], paymentMethods: [] };
      return new Response(JSON.stringify(body), { status: 200 });
    }));
    const bad = await other.caller.integrations.testMdm();
    expect(bad).toMatchObject({ ok: false, connection: { status: "ERROR" } });
    await expect(other.caller.sync.start({ mode: "FULL" })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    accept = true;
    const ok = await other.caller.integrations.testMdm();
    expect(ok).toMatchObject({ ok: true, accountLabel: "MDM account ACC-1 (seller)", unmappedStatuses: ["postponed"], connection: { status: "CONNECTED" } });
    expect(ok.message).toContain("1 MDM status is not mapped yet");
    expect(seen.every((c) => c.url.startsWith("https://api.mdm.express/") && c.key === SECRET && !c.url.includes(SECRET))).toBe(true);
    expect(JSON.stringify(ok)).not.toContain(SECRET);
  });

  it("live sync pulls parcels and matches them through MDM's order externalId", async () => {
    const live = await makeTenant("SyncLiveRun");
    const product = await live.caller.products.create({ name: "Lamp", sku: "LMP", cost });
    const order = await live.caller.orders.create({ orderNumber: "ES-2001", placedAt: new Date("2026-09-18T10:00:00Z"), status: "PENDING", codAmount: 390000, lines: [{ productId: product.id, quantity: 1, unitPrice: 390000 }] });
    await connect(live);
    vi.stubGlobal("fetch", vi.fn(async (url: URL) => {
      const path = new URL(String(url)).pathname;
      const body = path === "/api/v2/orders/search"
        ? { pagination: { page: 1, hasMore: false, nextPage: null, total: 1 }, list: [{ trackingId: "MO-1", externalId: "ES-2001" }] }
        : { pagination: { page: 1, hasMore: false, nextPage: null, total: 1 }, list: [{ trackingId: "LP-1", orderId: "MO-1", currency: "DZD", status: "outForDelivery", statusDate: "2026-09-20T10:00:00.000Z", pricing: { totalToPayFromClient: 3900 }, fees: { shipping: 600, return: 250 }, destinationAddress: { stateName: "Oran" }, client: { firstName: "Amina", phone: "0551111111" }, statusHistory: [{ date: "2026-09-20T10:00:00.000Z", status: "outForDelivery", responsible: { firstName: "Courier" } }] }] };
      return new Response(JSON.stringify(body), { status: 200 });
    }));
    const { job } = await startSync(live.ctx, { mode: "FULL" });
    const done = await runSyncJob(job.id, { sleep: noSleep });
    expect(done).toMatchObject({ status: "SUCCEEDED", adapter: "live" });
    const p = await db.parcel.findFirstOrThrow({ where: { workspaceId: live.ws.id, trackingId: "LP-1" } });
    expect(p).toMatchObject({ orderId: order.id, matchMethod: "ORDER_REFERENCE", normalizedStatus: "SHIPPED", codAmount: 390000, wilaya: "Oran" });
    expect(JSON.stringify(await db.parcel.findMany({ where: { workspaceId: live.ws.id } }))).not.toMatch(/Amina|0551111111|Courier/);
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
