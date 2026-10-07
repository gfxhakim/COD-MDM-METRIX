import { beforeAll, describe, expect, it } from "vitest";
import { customSyncInput } from "@/domain/customSync";
import { db } from "@/server/db";
import { createMockAdapter } from "@/server/mdm/mock";
import { scheduleDueSyncs } from "@/server/mdm/schedule";
import { retryFailed, runSyncJob, startCustomSync, startSync } from "@/server/mdm/sync";
import { MdmError, type MdmOrder, type MdmParcel } from "@/server/mdm/types";
import { addMember, cost, makeTenant } from "../helpers";

type Tenant = Awaited<ReturnType<typeof makeTenant>>;
const SECRET = "placeholder-mdm-key-for-tests-0002";
const noSleep = async () => {};

const order = (trackingId: string, over: Partial<MdmOrder> = {}): MdmOrder => ({
  trackingId, externalId: null, status: "pending", statusAt: new Date("2026-09-20T10:00:00Z"), confirmed: false, placedAt: new Date("2026-09-20T09:00:00Z"),
  total: 390000, currency: "DZD", phone: "0550000000", wilaya: "Alger", city: "Bab Ezzouar", deliveryType: "HOME", storeName: "Main store",
  utm: { source: "facebook", medium: "paid", campaign: "Spring", content: null },
  products: [{ ref: "LMP", variantOf: null, name: "Lamp", quantity: 1, unitPrice: 390000 }], ...over,
});
const parcel = (trackingId: string, mdmOrderId: string, status: string, at: string): MdmParcel => ({
  trackingId, mdmOrderId, reference: null, sourceOrderId: null, status, statusAt: new Date(at), codAmount: 390000, currency: "DZD",
  shippingFee: 60000, returnFee: 25000, wilaya: "Alger", dispatchedAt: null, deliveredAt: null, returnedAt: null, events: [], raw: { tracking: trackingId, status },
});
const ad = (content: string) => ({ source: "facebook", medium: "paid", campaign: "Spring", content });

// September 2026 in Algiers (UTC+1).
const SEPT = { from: "2026-09-01", to: "2026-09-30" };
const ORDERS = [
  order("MO-1", { status: "delivered", placedAt: new Date("2026-09-10T09:00:00Z"), statusAt: new Date("2026-09-14T09:00:00Z"), wilaya: "Oran", deliveryType: "STOP_DESK", utm: ad("120000000000101") }),
  order("MO-2", { status: "out-for-delivery", externalId: "1002", placedAt: new Date("2026-09-12T09:00:00Z"), statusAt: new Date("2026-09-15T09:00:00Z"), storeName: "Second store" }),
  order("MO-3", { status: "delivered", placedAt: new Date("2026-08-20T09:00:00Z"), statusAt: new Date("2026-08-25T09:00:00Z") }),
  order("MO-4", { status: "pending", placedAt: new Date("2026-09-15T09:00:00Z"), statusAt: new Date("2026-09-15T09:00:00Z") }),
  // Placed 30 Sep at 23:30 in Algiers: still September there, though already October in UTC.
  order("MO-5", { status: "returned", placedAt: new Date("2026-09-30T22:30:00Z"), statusAt: new Date("2026-10-02T09:00:00Z"), wilaya: "Béjaïa", products: [{ ref: null, variantOf: null, name: "Lampe LED", quantity: 1, unitPrice: 390000 }] }),
];
const PARCELS = [
  parcel("LP-1", "MO-1", "delivered", "2026-09-14T09:00:00Z"),
  parcel("LP-2", "MO-2", "out-for-delivery", "2026-09-15T09:00:00Z"),
  parcel("LP-3", "MO-3", "delivered", "2026-08-25T09:00:00Z"),
  parcel("LP-5", "MO-5", "returned", "2026-10-02T09:00:00Z"),
];

async function connected(name: string) {
  const t = await makeTenant(name);
  await t.caller.products.create({ name: "Lamp", sku: "LMP", cost });
  await t.caller.integrations.saveMdmCredential({ credential: SECRET });
  await db.integrationConnection.updateMany({ where: { workspaceId: t.ws.id }, data: { status: "CONNECTED" } });
  return t;
}

async function custom(t: Tenant, choices: Record<string, unknown>, opts: Partial<Parameters<typeof createMockAdapter>[0]> = {}) {
  const adapter = createMockAdapter({ fixtures: PARCELS, credential: SECRET, orders: ORDERS, ...opts });
  const { job } = await startCustomSync(t.ctx, customSyncInput.parse(choices));
  const done = await runSyncJob(job.id, { adapterFactory: async () => ({ adapter, connection: null }), sleep: noSleep, pageSize: 2 });
  return { done: done!, adapter };
}

const mdmIds = async (t: Tenant) => (await db.order.findMany({ where: { workspaceId: t.ws.id }, select: { mdmOrderId: true }, orderBy: { mdmOrderId: "asc" } })).map((o) => o.mdmOrderId);
const parcelIds = async (t: Tenant) => (await db.parcel.findMany({ where: { workspaceId: t.ws.id }, select: { trackingId: true }, orderBy: { trackingId: "asc" } })).map((p) => p.trackingId);

describe("custom MDM sync", () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await connected("CustomA");
  });

  it("reads only the orders matching the days and statuses, then only their parcels", async () => {
    const { done, adapter } = await custom(t, { ...SEPT, groups: ["delivered", "returns"], statuses: ["out-for-delivery"] });
    expect(done).toMatchObject({ status: "SUCCEEDED", mode: "CUSTOM", ordersAddedCount: 3, ordersMatchedCount: 3, skippedCount: 1, addedCount: 3 });
    // MDM was asked for September in Algiers, so MO-3 (August) never came back; MO-4 is still pending.
    expect(adapter.orderQueries[0].filters).toEqual({ createdAt: { start: new Date("2026-08-31T23:00:00.000Z"), end: new Date("2026-09-30T22:59:59.999Z") } });
    expect(await mdmIds(t)).toEqual(["MO-1", "MO-2", "MO-5"]);
    expect(await parcelIds(t)).toEqual(["LP-1", "LP-2", "LP-5"]);
    // Parcels were asked for by order, in one batch.
    expect(adapter.parcelQueries.map((q) => q.mdmOrderIds)).toEqual([["MO-1", "MO-2", "MO-5"], ["MO-1", "MO-2", "MO-5"]]);
    expect(await db.parcel.findFirstOrThrow({ where: { workspaceId: t.ws.id, trackingId: "LP-2" }, select: { order: { select: { mdmOrderId: true } } } })).toEqual({ order: { mdmOrderId: "MO-2" } });
    // The regular syncs keep their own starting point.
    expect(await db.integrationConnection.findFirstOrThrow({ where: { workspaceId: t.ws.id }, select: { lastSuccessfulSyncAt: true, ordersSyncedAt: true } })).toEqual({ lastSuccessfulSyncAt: null, ordersSyncedAt: null });
    expect(await db.auditLog.findFirstOrThrow({ where: { workspaceId: t.ws.id, action: "sync.started" }, select: { metadata: true } })).toMatchObject({ metadata: { mode: "CUSTOM", choices: "Placed 1 Sep 2026 to 30 Sep 2026 · Delivered, Returns, Out for delivery" } });
  });

  it("refreshes orders the app shows in a status, even after MDM moved them on, and never deletes", async () => {
    // MDM delivered MO-2 since the last sync.
    const moved = ORDERS.map((o) => (o.trackingId === "MO-2" ? { ...o, status: "delivered", statusAt: new Date("2026-09-17T09:00:00Z") } : o));
    const fixtures = PARCELS.map((p) => (p.trackingId === "LP-2" ? { ...p, status: "delivered", statusAt: new Date("2026-09-17T09:00:00Z") } : p));
    const { done, adapter } = await custom(t, { groups: ["carrier"] }, { orders: moved, fixtures });
    // Every date: MDM is asked for every order, and only the one the app showed with the carrier is kept.
    expect(adapter.orderQueries[0].filters).toEqual({});
    expect(done).toMatchObject({ status: "SUCCEEDED", ordersMatchedCount: 1, ordersUpdatedCount: 1, skippedCount: 4, updatedCount: 1 });
    expect(await db.parcel.findFirstOrThrow({ where: { workspaceId: t.ws.id, trackingId: "LP-2" }, select: { normalizedStatus: true } })).toEqual({ normalizedStatus: "DELIVERED" });
    expect(await mdmIds(t)).toEqual(["MO-1", "MO-2", "MO-5"]);
  });

  it("picks by wilaya, delivery, store, product, ad ID and status date", async () => {
    const d = await connected("CustomB");
    const run = async (choices: Record<string, unknown>) => (await custom(d, { ...choices, parcels: false })).done;
    expect(await run({ wilayas: ["bejaia"], products: ["lampe led"] })).toMatchObject({ ordersMatchedCount: 1, skippedCount: 4 });
    expect(await mdmIds(d)).toEqual(["MO-5"]);
    expect(await run({ deliveryType: "STOP_DESK", ad: "with" })).toMatchObject({ ordersMatchedCount: 1 });
    expect(await run({ stores: ["second STORE"], ad: "without" })).toMatchObject({ ordersMatchedCount: 1 });
    // MO-5 changed status on 2 Oct, the rest in September or before.
    expect(await run({ from: "2026-10-01", to: "2026-10-31", dateField: "status" })).toMatchObject({ ordersMatchedCount: 1, ordersAddedCount: 0 });
    expect(await mdmIds(d)).toEqual(["MO-1", "MO-2", "MO-5"]);
    // Orders only: no parcel was read.
    expect(await parcelIds(d)).toEqual([]);
  });

  it("looks orders up by MDM order ID, store order number or an order the app holds", async () => {
    const d = await connected("CustomC");
    const { done, adapter } = await custom(d, { orderIds: ["MO-4", "#1002"] });
    expect(adapter.orderQueries.map((q) => q.filters)).toEqual([{ trackingIds: ["MO-4", "#1002", "1002"] }, { externalIds: ["MO-4", "#1002", "1002"] }]);
    expect(done).toMatchObject({ status: "SUCCEEDED", ordersMatchedCount: 2, skippedCount: 0, addedCount: 1 });
    expect(await mdmIds(d)).toEqual(["MO-2", "MO-4"]);
    // The app knows MO-2 by its store number now, so typing it finds MDM's ID directly.
    const again = await custom(d, { orderIds: ["1002"] });
    expect(again.adapter.orderQueries[0].filters).toEqual({ trackingIds: ["MO-2", "1002"] });
    expect(again.done).toMatchObject({ ordersMatchedCount: 1, ordersUpdatedCount: 0 });
  });

  it("gives the same result when MDM refuses or ignores the filters", async () => {
    const d = await connected("CustomD");
    const { done, adapter } = await custom(d, { ...SEPT, groups: ["delivered", "returns"], statuses: ["out_for_delivery"] }, { filters: { orders: "reject", parcels: "ignore" } });
    expect(done).toMatchObject({ status: "SUCCEEDED", ordersMatchedCount: 3, skippedCount: 2 });
    // Refused: orders changed since 1 Sep are read instead and picked by the app.
    expect(adapter.orderQueries.map((q) => [!!q.filters && Object.keys(q.filters).length > 0, q.updatedSince])).toEqual([[true, null], [false, new Date("2026-08-31T23:00:00.000Z")], [false, new Date("2026-08-31T23:00:00.000Z")], [false, new Date("2026-08-31T23:00:00.000Z")]]);
    // Ignored: MDM sent a parcel of another order, so parcels are read without the filter and only the kept orders' are saved.
    expect(adapter.parcelQueries[2].mdmOrderIds).toBeUndefined();
    expect(adapter.parcelQueries[2].updatedSince).toEqual(new Date("2026-08-31T23:00:00.000Z"));
    expect(await mdmIds(d)).toEqual(["MO-1", "MO-2", "MO-5"]);
    expect(await parcelIds(d)).toEqual(["LP-1", "LP-2", "LP-5"]);
    expect((await db.syncJob.findUniqueOrThrow({ where: { id: done.id }, select: { filters: true } })).filters).toMatchObject({ fallbackOrders: true, fallbackParcels: true });
  });

  it("re-reads parcels without the filter when MDM sends none for orders that already shipped", async () => {
    const d = await connected("CustomE");
    // MDM answers the order filter with nothing at all.
    const { done, adapter } = await custom(d, { ...SEPT, groups: ["delivered"] }, { fixtures: PARCELS.map((p) => ({ ...p, mdmOrderId: `${p.mdmOrderId}-x` })) });
    expect(adapter.parcelQueries.length).toBeGreaterThan(1);
    expect(adapter.parcelQueries.at(-1)!.mdmOrderIds).toBeUndefined();
    expect(done).toMatchObject({ status: "SUCCEEDED", ordersMatchedCount: 1, addedCount: 0 });
  });

  it("fails clearly when the key can't read orders, and retries with the same choices", async () => {
    const d = await connected("CustomF");
    const { done } = await custom(d, SEPT, { orderFailures: { 0: [new MdmError("forbidden", "AUTH")] } });
    expect(done).toMatchObject({ status: "FAILED", mode: "CUSTOM" });
    expect(done.error).toContain("can't read orders");
    expect(await db.integrationConnection.findFirstOrThrow({ where: { workspaceId: d.ws.id }, select: { status: true, lastError: true } })).toEqual({ status: "CONNECTED", lastError: null });

    const retry = await retryFailed(d.ctx, done.id);
    expect(retry.job).toMatchObject({ mode: "CUSTOM", trigger: "RETRY", filters: done.filters });
    expect((await db.syncJob.findUniqueOrThrow({ where: { id: retry.job.id } })).retryOfJobId).toBe(done.id);
  });

  it("is for roles that can sync, takes the sync lock, and doesn't delay scheduled syncs", async () => {
    const d = await connected("CustomG");
    const analyst = await addMember(d.ws.id, "ANALYST");
    await expect(analyst.caller.sync.startCustom({ from: "2026-09-01" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(analyst.caller.sync.customOptions()).rejects.toMatchObject({ code: "FORBIDDEN" });
    const operator = await addMember(d.ws.id, "OPERATOR");
    await expect(operator.caller.sync.startCustom({ from: "2026-09-30", to: "2026-09-01" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const { jobId } = await operator.caller.sync.startCustom({ from: "2026-09-01" });
    expect(await d.caller.sync.startCustom({})).toMatchObject({ jobId, alreadyRunning: true });
    expect(await d.caller.sync.start({ mode: "INCREMENTAL" })).toMatchObject({ jobId, alreadyRunning: true });

    // Finished custom syncs don't count as the workspace's last sync.
    await db.syncJob.update({ where: { id: jobId }, data: { status: "SUCCEEDED", activeLock: null, finishedAt: new Date() } });
    await db.integrationConnection.updateMany({ where: { workspaceId: d.ws.id }, data: { syncIntervalMinutes: 60 } });
    await scheduleDueSyncs(new Date());
    expect(await db.syncJob.count({ where: { workspaceId: d.ws.id, mode: { not: "CUSTOM" } } })).toBe(1);
  });

  it("offers the statuses, wilayas, stores and products MDM uses", async () => {
    const options = await t.caller.sync.customOptions();
    const carrier = options.groups.find((g) => g.key === "carrier")!;
    expect(carrier.statuses.map((s) => s.key)).toEqual(expect.arrayContaining(["dispatched", "out_for_delivery"]));
    expect(carrier.statuses.findIndex((s) => s.key === "dispatched")).toBeLessThan(carrier.statuses.findIndex((s) => s.key === "out_for_delivery"));
    expect(options.wilayas).toEqual(["Alger", "Béjaïa", "Oran"]);
    expect(options.stores).toEqual(["Main store", "Second store"]);
    expect(options.products).toEqual(["Lamp", "Lampe LED"]);
  });

  it("leaves the regular sync working as before", async () => {
    const d = await connected("CustomH");
    const adapter = createMockAdapter({ fixtures: PARCELS, credential: SECRET, orders: ORDERS });
    const { job } = await startSync(d.ctx, { mode: "FULL" });
    const done = await runSyncJob(job.id, { adapterFactory: async () => ({ adapter, connection: null }), sleep: noSleep, pageSize: 2 });
    expect(done).toMatchObject({ status: "SUCCEEDED", mode: "FULL", ordersAddedCount: 5, addedCount: 4, ordersMatchedCount: 0, skippedCount: 0, filters: null });
    // Only the search for upsold orders carries a filter.
    expect(adapter.orderQueries.filter((q) => q.filters !== undefined).map((q) => q.filters)).toEqual([{ upsell: true }]);
    expect(adapter.parcelQueries.every((q) => q.mdmOrderIds === undefined)).toBe(true);
  });
});
