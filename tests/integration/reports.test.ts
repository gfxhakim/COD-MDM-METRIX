import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { callerFor, cost, makeTenant } from "../helpers";

type Tenant = Awaited<ReturnType<typeof makeTenant>>;
const DAY = 86_400_000;

/**
 * A small hand-computable workspace:
 * product: P 3900, C 900, S 600, R 250, K 120, G 50 (DZD)
 * creative cr_a: 3 orders → delivered, returned, in transit; spend 3000 DZD
 * creative cr_b: 1 order → delivered (remitted); spend 500 DZD
 * unattributed: 1 pending order
 * unmatched spend: 200 DZD
 * expenses: 1000 DZD global
 */
async function build(t: Tenant) {
  const w = t.ws.id;
  const product = await t.caller.products.create({ name: "Lamp", sku: "LMP", cost });
  const [ca, cb] = await Promise.all(
    ["cr_a", "cr_b"].map((ext) => db.creative.create({ data: { workspaceId: w, externalCreativeId: ext, normalizedKey: ext, productId: product.id, campaignName: "=cmd|' /C calc'!A0" } })),
  );
  const placedAt = new Date(Date.now() - 5 * DAY);
  const mk = async (n: string, creative: string | undefined, status: "CONFIRMED" | "PENDING") =>
    t.caller.orders.create({ orderNumber: n, placedAt, status, codAmount: 390000, utmContent: creative, lines: [{ productId: product.id, quantity: 1, unitPrice: 390000 }] });
  const o1 = await mk("1", "cr_a", "CONFIRMED");
  const o2 = await mk("2", "cr_a", "CONFIRMED");
  const o3 = await mk("3", "cr_a", "CONFIRMED");
  const o4 = await mk("4", "cr_b", "CONFIRMED");
  await mk("5", undefined, "PENDING");
  const parcel = (orderId: string, trk: string, status: "DELIVERED" | "RETURNED" | "SHIPPED") =>
    db.parcel.create({ data: { workspaceId: w, orderId, provider: "MDM_EXPRESS", trackingId: trk, normalizedStatus: status, codAmount: 390000, dispatchedAt: placedAt } });
  await parcel(o1.id, "T1", "DELIVERED");
  await parcel(o2.id, "T2", "RETURNED");
  await parcel(o3.id, "T3", "SHIPPED");
  const p4 = await parcel(o4.id, "T4", "DELIVERED");
  await db.cashEvent.create({ data: { workspaceId: w, type: "REMITTED", parcelId: p4.id, orderId: o4.id, amount: 390000, occurredAt: new Date() } });
  const spend = (creativeId: string | null, amount: number, h: string) =>
    db.adSpend.create({ data: { workspaceId: w, date: placedAt, creativeId, externalCreativeId: creativeId ? undefined : "cr_zzz", spend: amount, sourceRowHash: h } });
  await spend(ca.id, 300000, "h1");
  await spend(cb.id, 50000, "h2");
  await spend(null, 20000, "h3");
  await t.caller.expenses.create({ date: placedAt, category: "SOFTWARE", amount: 100000, allocation: "GLOBAL", costType: "FIXED" });
  return { product, ca, cb };
}

describe("economics reports", () => {
  let t: Tenant;
  let ids: Awaited<ReturnType<typeof build>>;
  beforeAll(async () => {
    t = await makeTenant("Reports");
    ids = await build(t);
  });

  it("dashboard computes metrics from stored facts", async () => {
    const r = await t.caller.reports.dashboard({ revenueView: "DELIVERED" });
    const m = r.metrics;
    expect(m).toMatchObject({ placed: 5, confirmed: 4, shipped: 4, finished: 3, delivered: 2, returned: 1, inTransit: 1 });
    expect(m.deliveredRevenue).toBe(780000);
    expect(m.remittedCash).toBe(390000);
    expect(m.cashInTransit).toBe(390000);
    expect(m.adSpend).toBe(370000);
    expect(m.cogs).toBe(180000);
    expect(m.outboundShipping).toBe(180000); // the parcel still in transit counts once it finishes
    expect(m.rtoCost).toBe(25000);
    expect(m.callCenterCost).toBe(48000); // CONFIRMED_ORDER basis × 4
    expect(m.packagingCost).toBe(15000);
    expect(m.allocatedOverhead).toBe(100000);
    expect(m.trueNetProfit).toBe(780000 - 370000 - 180000 - 180000 - 25000 - 48000 - 15000 - 100000);
    expect(m.deliveryRate).toBeCloseTo(2 / 3);
    expect(m.returnRate).toBeCloseTo(1 / 3);
    expect(r.wilayas.length).toBeGreaterThan(0);
  });

  it("filters the dashboard by creative and product", async () => {
    const byCreative = await t.caller.reports.dashboard({ creativeId: ids.cb.id, revenueView: "DELIVERED" });
    expect(byCreative.metrics).toMatchObject({ placed: 1, delivered: 1, adSpend: 50000 });
    const byProduct = await t.caller.reports.dashboard({ productId: ids.product.id, revenueView: "DELIVERED" });
    expect(byProduct.metrics.adSpend).toBe(350000); // unmatched spend has no product
    expect(byProduct.metrics.placed).toBe(5);
  });

  it("date range filtering excludes out-of-range facts", async () => {
    const r = await t.caller.reports.dashboard({ from: new Date(Date.now() - DAY), revenueView: "DELIVERED" });
    expect(r.metrics.placed).toBe(0);
    expect(r.metrics.adSpend).toBe(0);
    expect(r.metrics.deliveryRate).toBeNull();
  });

  it("creative matrix has attributed rows plus unattributed and unmatched-spend buckets", async () => {
    const r = await t.caller.creatives.matrix({ revenueView: "DELIVERED" });
    const a = r.rows.find((x) => x.creativeId === ids.ca.id)!;
    const b = r.rows.find((x) => x.creativeId === ids.cb.id)!;
    const unattributed = r.rows.find((x) => x.kind === "UNATTRIBUTED")!;
    const unmatched = r.rows.find((x) => x.kind === "UNMATCHED_SPEND")!;
    expect(a.metrics).toMatchObject({ placed: 3, shipped: 3, delivered: 1, returned: 1, adSpend: 300000, placedCpa: 100000, cpdo: 300000 });
    expect(b.metrics).toMatchObject({ placed: 1, delivered: 1, adSpend: 50000 });
    expect(unattributed.metrics).toMatchObject({ placed: 1, adSpend: 0 });
    expect(unmatched.metrics).toMatchObject({ placed: 0, adSpend: 20000 });
    expect(a.verdict).toBe("INSUFFICIENT_DATA");
    // Global overhead split by delivered orders: cr_a 1, cr_b 1.
    expect(a.metrics.allocatedOverhead + b.metrics.allocatedOverhead).toBe(100000);
    // Rows sum back to business totals.
    expect(r.rows.reduce((s, x) => s + x.metrics.adSpend, 0)).toBe(370000);
    expect(r.rows.reduce((s, x) => s + x.metrics.placed, 0)).toBe(5);
  });

  it("CSV export sanitises formula injection from imported names", async () => {
    const { content } = await t.caller.creatives.exportCsv({ columns: ["creative", "campaign", "adSpend", "truePoas"] });
    expect(content.split("\r\n")[0]).toBe("Creative ID,Campaign,Spend,True POAS");
    expect(content).toContain("'=cmd");
    expect(content).not.toMatch(/(^|,)=cmd/m);
  });

  it("simulator returns observed rates for a product and saves scenarios", async () => {
    const o = await t.caller.simulator.observed({ productId: ids.product.id });
    expect(o.rates.deliveryRate).toBeCloseTo(2 / 3);
    expect(o.costs.salePrice).toBe(390000);
    const calc = await t.caller.simulator.calculate({ salePrice: 390000, sourcingCost: 90000, outboundShipping: 60000, rtoFee: 25000, callCenterCost: 12000, deliveryProbability: 0.5, returnProbability: 0.5 });
    expect(calc.breakevenCpa).toBe(240000 * 0.5 - 25000 * 0.5 - 12000);
    await t.caller.simulator.saveScenario({ name: "Base", productId: ids.product.id, inputs: { salePrice: 1, sourcingCost: 0, outboundShipping: 0, rtoFee: 0, callCenterCost: 0, deliveryProbability: 0.5, returnProbability: 0.5 } });
    expect(await t.caller.simulator.listScenarios()).toHaveLength(1);
  });

  it("reports and scenarios never cross workspaces", async () => {
    const other = await makeTenant("Other reports");
    const r = await other.caller.reports.dashboard({});
    expect(r.metrics.placed).toBe(0);
    expect(r.metrics.adSpend).toBe(0);
    expect((await other.caller.creatives.matrix({})).rows).toHaveLength(0);
    expect(await other.caller.simulator.listScenarios()).toHaveLength(0);
    await expect(other.caller.simulator.observed({ productId: ids.product.id })).resolves.toMatchObject({ sample: { placed: 0 }, costs: { salePrice: null } });
    await expect(other.caller.reports.dashboard({ creativeId: ids.ca.id })).resolves.toMatchObject({ metrics: { placed: 0, adSpend: 0 } });
    const [scenario] = await t.caller.simulator.listScenarios();
    await expect(other.caller.simulator.deleteScenario({ id: scenario.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(other.caller.simulator.saveScenario({ name: "x", productId: ids.product.id, inputs: { salePrice: 1, sourcingCost: 0, outboundShipping: 0, rtoFee: 0, callCenterCost: 0, deliveryProbability: 0.5, returnProbability: 0.5 } })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const spoofed = callerFor(other.user, t.ws.id);
    await expect(spoofed.reports.dashboard({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(spoofed.creatives.exportCsv({ columns: ["creative"] })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
