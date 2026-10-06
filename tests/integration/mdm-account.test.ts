import { beforeAll, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { customSyncInput } from "@/domain/customSync";
import { readPartStates } from "@/domain/mdmAccount";
import { db } from "@/server/db";
import { createMockAdapter, type MockAccount } from "@/server/mdm/mock";
import { runSyncJob, startCustomSync, startSync } from "@/server/mdm/sync";
import { MdmError, type MdmFeeLine, type MdmOrder, type MdmParcel } from "@/server/mdm/types";
import { addMember, cost, makeTenant } from "../helpers";

type Tenant = Awaited<ReturnType<typeof makeTenant>>;
const SECRET = "placeholder-mdm-key-for-tests-0003";
const noSleep = async () => {};
const at = (s: string) => new Date(s);

const ORDERS: MdmOrder[] = [
  {
    trackingId: "MO-1", externalId: "1001", status: "delivered", statusAt: at("2026-09-14T09:00:00Z"), confirmed: true, placedAt: at("2026-09-10T09:00:00Z"),
    total: 390000, currency: "DZD", phone: "0550000000", wilaya: "Alger", city: "Alger", deliveryType: "HOME", storeName: "Main store",
    utm: { source: null, medium: null, campaign: null, content: null }, products: [{ ref: "LMP", variantOf: null, name: "Lamp", quantity: 1, unitPrice: 390000 }],
  },
];
const PARCELS: MdmParcel[] = [
  { trackingId: "LP-1", mdmOrderId: "MO-1", reference: null, sourceOrderId: null, status: "delivered", statusAt: at("2026-09-14T09:00:00Z"), codAmount: 390000, currency: "DZD", shippingFee: 60000, returnFee: 25000, wilaya: "Alger", dispatchedAt: null, deliveredAt: null, returnedAt: null, events: [], raw: { tracking: "LP-1" } },
];

const fee = (id: string, type: string, amount: number, over: Partial<MdmFeeLine> = {}): MdmFeeLine => ({
  id, sellerId: "SELLER-1", entityId: null, type, subType: null, amount, grossAmount: amount, taxes: 0, currency: "DZD", status: "ready", payoutId: null,
  parcelTrackingId: null, orderTrackingId: null, createdAt: at("2026-09-15T10:00:00Z"), updatedAt: at("2026-09-15T10:00:00Z"), ...over,
});
const zero = { totalInbound: 0, incoming: 0, available: 0, processing: 0, inDelivery: 0, delivered: 0, returning: 0, returned: 0, damaged: 0, discharged: 0, lost: 0 };

function account(): MockAccount {
  return {
    profileId: "SELLER-1",
    wallet: { currency: "DZD", onHold: 120000, ready: 340000, paid: 1500000, details: { gross: { onHold: 390000, ready: 390000, paid: 1950000 } } },
    payouts: [
      { id: "P-1", amount: 1500000, currency: "DZD", status: "confirmed", confirmed: true, sellerId: "SELLER-1", storeNames: ["Main store"], createdAt: at("2026-09-01T10:00:00Z"), updatedAt: at("2026-09-02T10:00:00Z") },
      { id: "P-2", amount: 340000, currency: "DZD", status: "pending", confirmed: false, sellerId: "SELLER-1", storeNames: [], createdAt: at("2026-09-20T10:00:00Z"), updatedAt: at("2026-09-20T10:00:00Z") },
    ],
    breakdowns: {
      "P-1": { currency: "DZD", items: [{ type: "COD", count: 5, total: 1950000, grossTotal: 1950000 }, { type: "DELIVERY_FEE", count: 5, total: -450000, grossTotal: null }], taxes: [] },
      "P-2": { currency: "DZD", items: [{ type: "COD", count: 1, total: 390000, grossTotal: 390000 }], taxes: [] },
    },
    fees: [
      // About the parcel LP-1, then about its order, then a line MDM only ties to the parcel by entity.
      fee("L-1", "COD", 390000, { parcelTrackingId: "LP-1", orderTrackingId: "MO-1", payoutId: "P-2" }),
      fee("L-2", "DELIVERY_FEE", -60000, { entityId: "LP-1" }),
      fee("L-3", "CALL_CENTER", -10000, { subType: "confirmed", entityId: "MO-1", updatedAt: at("2026-09-16T10:00:00Z") }),
      fee("L-4", "RETURN_FEE", -25000, { entityId: "LP-OTHER", createdAt: at("2026-08-20T10:00:00Z"), updatedAt: at("2026-08-20T10:00:00Z") }),
      // Another seller's line never lands in this workspace.
      fee("L-9", "COD", 999900, { sellerId: "SELLER-2" }),
    ],
    prices: { currency: "DZD", callCenter: { type: "standard", perLead: 0, perConfirmed: 10000, perDelivered: 0, upsellExtra: null }, fulfilment: null, delivery: [{ wilaya: "Alger", code: "16", home: 40000, stopDesk: 25000, return: 20000, exchange: null }], usdRate: null, euroRate: null },
    variants: [
      { id: "V-1", productId: "PR-1", productName: "Lamp", variantName: "Black", sku: "LMP-B", sellingPrice: 390000, purchasePrice: 90000, currency: "DZD", archived: false },
      { id: "V-2", productId: "PR-1", productName: "Lamp", variantName: "White", sku: "LMP-W", sellingPrice: 390000, purchasePrice: 90000, currency: "DZD", archived: false },
    ],
    stock: { "V-1": { ...zero, totalInbound: 100, available: 60, inDelivery: 10, delivered: 25, returned: 3, lost: 2 }, "V-2": { ...zero, totalInbound: 50, available: 50 } },
    capital: { currency: "DZD", buckets: { totalInbound: { units: 150, value: 13500000 }, available: { units: 110, value: 9900000 }, processing: { units: 0, value: 0 }, inDelivery: { units: 10, value: 900000 }, returning: { units: 0, value: 0 }, lost: { units: 2, value: 180000 } } },
    arrivals: [{ id: "A-1", status: "completed", operation: "inbound", products: [{ name: "Lamp Black", sku: "LMP-B", expected: 100 }, { name: "Lamp White", sku: "LMP-W", expected: 50 }], expectedUnits: 150, receivedUnits: 149, damagedUnits: 1, createdAt: at("2026-08-01T09:00:00Z"), updatedAt: at("2026-08-02T09:00:00Z") }],
  };
}

async function connected(name: string) {
  const t = await makeTenant(name);
  await t.caller.products.create({ name: "Lamp", sku: "LMP", cost });
  await t.caller.integrations.saveMdmCredential({ credential: SECRET });
  await db.integrationConnection.updateMany({ where: { workspaceId: t.ws.id }, data: { status: "CONNECTED" } });
  return t;
}

async function sync(t: Tenant, acc: MockAccount, opts: Partial<Parameters<typeof createMockAdapter>[0]> & { mode?: "INCREMENTAL" | "FULL" } = {}) {
  const { mode = "INCREMENTAL", ...rest } = opts;
  const adapter = createMockAdapter({ fixtures: PARCELS, credential: SECRET, orders: ORDERS, account: acc, ...rest });
  const { job } = await startSync(t.ctx, { mode });
  const done = await runSyncJob(job.id, { adapterFactory: async () => ({ adapter, connection: null }), sleep: noSleep, pageSize: 2 });
  return { done: done!, adapter };
}

const fees = (t: Tenant) => db.mdmFee.findMany({ where: { workspaceId: t.ws.id }, orderBy: { providerId: "asc" }, select: { providerId: true, type: true, amount: true, payoutId: true, parcel: { select: { trackingId: true } }, order: { select: { mdmOrderId: true } } } });

describe("MDM money and stock", () => {
  let t: Tenant;
  const acc = account();
  let firstStart: Date;

  beforeAll(async () => {
    t = await connected("MoneyA");
  });

  it("are copied after orders and parcels: wallet, fees per parcel, payouts, prices, stock and arrivals", async () => {
    const { done, adapter } = await sync(t, acc);
    firstStart = done.startedAt!;
    expect(done).toMatchObject({ status: "SUCCEEDED", phase: "ACCOUNT", addedCount: 1 });
    // The first sync reads everything.
    expect(adapter.accountCalls).toEqual(expect.arrayContaining(["wallet", "fees:all", "payouts:all", "payoutBreakdown:P-1", "payoutBreakdown:P-2", "prices:SELLER-1", "variants", "stock:V-1", "stock:V-2", "capital", "arrivals"]));
    const a = await db.mdmAccount.findUniqueOrThrow({ where: { workspaceId: t.ws.id } });
    expect(a.sellerId).toBe("SELLER-1");
    expect(a.wallet).toEqual(acc.wallet);
    expect(a.prices).toMatchObject({ callCenter: { perConfirmed: 10000 }, delivery: [{ wilaya: "Alger", home: 40000 }] });
    expect(a.capital).toMatchObject({ buckets: { available: { units: 110, value: 9900000 } } });
    expect(a.feesSyncedAt).toEqual(firstStart);
    const parts = readPartStates(a.parts);
    expect(Object.values(parts).every((p) => p?.ok)).toBe(true);
    expect(parts.fees).toMatchObject({ count: 4 });

    // Lines are tied to the app's parcel and order, through any ID MDM gives.
    expect(await fees(t)).toEqual([
      { providerId: "L-1", type: "COD", amount: 390000, payoutId: "P-2", parcel: { trackingId: "LP-1" }, order: { mdmOrderId: "MO-1" } },
      { providerId: "L-2", type: "DELIVERY_FEE", amount: -60000, payoutId: null, parcel: { trackingId: "LP-1" }, order: { mdmOrderId: "MO-1" } },
      { providerId: "L-3", type: "CALL_CENTER", amount: -10000, payoutId: null, parcel: null, order: { mdmOrderId: "MO-1" } },
      { providerId: "L-4", type: "RETURN_FEE", amount: -25000, payoutId: null, parcel: null, order: null },
    ]);
    expect(await db.mdmPayout.findMany({ where: { workspaceId: t.ws.id }, orderBy: { providerId: "asc" }, select: { providerId: true, amount: true, status: true, confirmed: true, storeNames: true, breakdown: true } })).toEqual([
      { providerId: "P-1", amount: 1500000, status: "confirmed", confirmed: true, storeNames: "Main store", breakdown: acc.breakdowns["P-1"] },
      { providerId: "P-2", amount: 340000, status: "pending", confirmed: false, storeNames: null, breakdown: acc.breakdowns["P-2"] },
    ]);
    expect(await db.mdmStockItem.findMany({ where: { workspaceId: t.ws.id }, orderBy: { providerId: "asc" }, select: { providerId: true, productName: true, variantName: true, available: true, inDelivery: true, lost: true, purchasePrice: true } })).toEqual([
      { providerId: "V-1", productName: "Lamp", variantName: "Black", available: 60, inDelivery: 10, lost: 2, purchasePrice: 90000 },
      { providerId: "V-2", productName: "Lamp", variantName: "White", available: 50, inDelivery: 0, lost: 0, purchasePrice: 90000 },
    ]);
    expect(await db.mdmStockArrival.findMany({ where: { workspaceId: t.ws.id }, select: { providerId: true, expectedUnits: true, receivedUnits: true, damagedUnits: true, products: true } })).toEqual([
      { providerId: "A-1", expectedUnits: 150, receivedUnits: 149, damagedUnits: 1, products: [{ name: "Lamp Black", sku: "LMP-B", expected: 100 }, { name: "Lamp White", sku: "LMP-W", expected: 50 }] },
    ]);
  });

  it("then read only what changed, and a part MDM refuses or fails never stops the others", async () => {
    acc.wallet = { ...acc.wallet, ready: 0, paid: 1840000 };
    acc.payouts[1] = { ...acc.payouts[1], status: "confirmed", confirmed: true, updatedAt: at("2026-09-21T10:00:00Z") };
    const server = () => new MdmError("MDM server error (502)", "SERVER");
    const { done, adapter } = await sync(t, acc, { accountFailures: { payouts: [new MdmError("MDM refused access", "AUTH")], stock: [server(), server(), server(), server(), server()] } });
    expect(done.status).toBe("SUCCEEDED");
    // Fees changed since a day before the last sync started; the price list isn't due again yet.
    expect(adapter.accountCalls).toContain(`fees:${new Date(firstStart.getTime() - 24 * 3_600_000).toISOString()}`);
    expect(adapter.accountCalls.some((c) => c.startsWith("prices"))).toBe(false);
    const a = await db.mdmAccount.findUniqueOrThrow({ where: { workspaceId: t.ws.id } });
    expect(a.wallet).toMatchObject({ ready: 0, paid: 1840000 });
    const parts = readPartStates(a.parts);
    expect(parts.payouts).toMatchObject({ ok: false, denied: true, message: "Your MDM API key isn't allowed to read the payouts." });
    expect(parts.stock).toMatchObject({ ok: false, message: "MDM server error (502)" });
    // The last good read is remembered, and what was copied before stays.
    expect(parts.stock?.okAt).toBeTruthy();
    expect(parts.arrivals?.ok).toBe(true);
    expect(await db.mdmStockItem.count({ where: { workspaceId: t.ws.id } })).toBe(2);
    expect(await db.mdmPayout.findFirstOrThrow({ where: { workspaceId: t.ws.id, providerId: "P-2" }, select: { status: true } })).toEqual({ status: "pending" });
  });

  it("a payout MDM changed gets its breakdown read again, and a full sync re-reads everything", async () => {
    acc.breakdowns["P-2"] = { currency: "DZD", items: [{ type: "COD", count: 1, total: 390000, grossTotal: 390000 }, { type: "DELIVERY_FEE", count: 1, total: -50000, grossTotal: null }], taxes: [] };
    const { adapter } = await sync(t, acc, { mode: "FULL" });
    expect(adapter.accountCalls).toEqual(expect.arrayContaining(["fees:all", "payouts:all", "payoutBreakdown:P-2", "prices:SELLER-1"]));
    expect(adapter.accountCalls).not.toContain("payoutBreakdown:P-1");
    expect(await db.mdmPayout.findFirstOrThrow({ where: { workspaceId: t.ws.id, providerId: "P-2" }, select: { status: true, confirmed: true, breakdown: true } })).toEqual({ status: "confirmed", confirmed: true, breakdown: acc.breakdowns["P-2"] });
    expect(readPartStates((await db.mdmAccount.findUniqueOrThrow({ where: { workspaceId: t.ws.id } })).parts).payouts?.ok).toBe(true);
  });

  it("variants MDM no longer lists stay, marked archived", async () => {
    const { done } = await sync(t, { ...acc, variants: acc.variants.slice(0, 1) });
    expect(done.status).toBe("SUCCEEDED");
    expect(await db.mdmStockItem.findMany({ where: { workspaceId: t.ws.id }, orderBy: { providerId: "asc" }, select: { providerId: true, archived: true } })).toEqual([
      { providerId: "V-1", archived: false },
      { providerId: "V-2", archived: true },
    ]);
  });

  it("are shown to owners, admins and analysts, grouped by MDM's line type for chosen days", async () => {
    const o = await t.caller.money.overview();
    expect(o).toMatchObject({ currency: "DZD", connected: true, feeLines: 4, wallet: { paid: 1840000 } });
    expect(o.payouts.map((p) => p.providerId)).toEqual(["P-2", "P-1"]);
    expect(o.stock.map((s) => [s.variantName, s.archived])).toEqual([["Black", false], ["White", true]]);
    expect(o.arrivals).toHaveLength(1);

    const sept = await t.caller.money.fees({ from: "2026-09-01", to: "2026-09-30" });
    expect(sept).toMatchObject({ lines: 3, linkedToOrders: 3 });
    expect(sept.rows).toEqual([
      { type: "COD", subType: null, currency: "DZD", lines: 1, amount: 390000, gross: 390000, taxes: 0, paidOut: 390000, waiting: 0, waitingLines: 0 },
      { type: "DELIVERY_FEE", subType: null, currency: "DZD", lines: 1, amount: -60000, gross: -60000, taxes: 0, paidOut: 0, waiting: -60000, waitingLines: 1 },
      { type: "CALL_CENTER", subType: "confirmed", currency: "DZD", lines: 1, amount: -10000, gross: -10000, taxes: 0, paidOut: 0, waiting: -10000, waitingLines: 1 },
    ]);
    expect((await t.caller.money.fees({})).lines).toBe(4);
    await expect(t.caller.money.fees({ from: "2026-09-30", to: "2026-09-01" })).rejects.toThrow();

    const analyst = await addMember(t.ws.id, "ANALYST");
    expect((await analyst.caller.money.overview()).feeLines).toBe(4);
    const operator = await addMember(t.ws.id, "OPERATOR");
    await expect(operator.caller.money.overview()).rejects.toThrow(TRPCError);
    await expect(operator.caller.money.fees({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("are left alone by custom syncs, and never cross into another workspace", async () => {
    const adapter = createMockAdapter({ fixtures: PARCELS, credential: SECRET, orders: ORDERS, account: acc });
    const { job } = await startCustomSync(t.ctx, customSyncInput.parse({ orderIds: ["MO-1"] }));
    const done = await runSyncJob(job.id, { adapterFactory: async () => ({ adapter, connection: null }), sleep: noSleep });
    expect(done!.status).toBe("SUCCEEDED");
    expect(adapter.accountCalls).toEqual([]);

    const other = await connected("MoneyB");
    const o = await other.caller.money.overview();
    expect(o).toMatchObject({ wallet: null, feeLines: 0, payouts: [], stock: [], arrivals: [], parts: {} });
  });

  it("keep only the key's own seller when MDM sends several", async () => {
    const t2 = await connected("MoneyC");
    // No seller learned yet and two sellers on a page: the profile decides.
    const mixed = { ...account(), fees: [fee("X-1", "COD", 100000, { sellerId: "SELLER-2" }), fee("X-2", "COD", 200000)] };
    await sync(t2, mixed);
    expect((await db.mdmFee.findMany({ where: { workspaceId: t2.ws.id }, select: { providerId: true } })).map((f) => f.providerId)).toEqual(["X-2"]);
    // A profile that matches neither keeps none of them, and says why.
    const t3 = await connected("MoneyD");
    await sync(t3, { ...mixed, profileId: "SELLER-3", fees: [fee("Y-1", "COD", 1, { sellerId: "SELLER-2" }), fee("Y-2", "COD", 2, { sellerId: "SELLER-4" })] });
    expect(await db.mdmFee.count({ where: { workspaceId: t3.ws.id } })).toBe(0);
    expect(readPartStates((await db.mdmAccount.findUniqueOrThrow({ where: { workspaceId: t3.ws.id } })).parts).fees).toMatchObject({ ok: false, message: expect.stringContaining("several sellers") });
  });
});
