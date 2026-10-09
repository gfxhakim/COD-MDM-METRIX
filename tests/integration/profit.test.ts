import { beforeAll, describe, expect, it } from "vitest";
import { seedFor } from "@/domain/profitTracker";
import { db } from "@/server/db";
import { addMember, cost, makeTenant } from "../helpers";

type Tenant = Awaited<ReturnType<typeof makeTenant>>;
const DAY = 86_400_000;

/**
 * One product (P 3900, C 900, S 600, R 250, K 120, G 50 DZD), five orders placed 5 days ago:
 * delivered, returned, in transit, delivered, and one still pending. Ad spend 3500 DZD on its ad
 * (no campaign, linked to Lamp itself), 200 DZD linked to no product, and 500 DZD in a campaign
 * nobody linked yet. One global expense of 1000 DZD. MDM stock for it in two variants.
 */
async function build(t: Tenant) {
  const w = t.ws.id;
  const product = await t.caller.products.create({ name: "Lamp", sku: "LMP", cost });
  const creative = await db.creative.create({ data: { workspaceId: w, externalCreativeId: "cr_a", normalizedKey: "cr_a", productId: product.id } });
  const placedAt = new Date(Date.now() - 5 * DAY);
  const mk = (n: string, status: "CONFIRMED" | "PENDING") =>
    t.caller.orders.create({ orderNumber: n, placedAt, status, codAmount: 390000, utmContent: "cr_a", lines: [{ productId: product.id, quantity: 1, unitPrice: 390000 }] });
  const orders = [await mk("1", "CONFIRMED"), await mk("2", "CONFIRMED"), await mk("3", "CONFIRMED"), await mk("4", "CONFIRMED"), await mk("5", "PENDING")];
  const statuses = ["DELIVERED", "RETURNED", "SHIPPED", "DELIVERED"] as const;
  for (const [i, status] of statuses.entries()) {
    await db.parcel.create({ data: { workspaceId: w, orderId: orders[i].id, provider: "MDM_EXPRESS", trackingId: `T${i}`, normalizedStatus: status, codAmount: 390000, dispatchedAt: placedAt } });
  }
  await db.adSpend.create({ data: { workspaceId: w, date: placedAt, creativeId: creative.id, spend: 350000, sourceRowHash: "p1" } });
  await db.adSpend.create({ data: { workspaceId: w, date: placedAt, creativeId: null, externalCreativeId: "cr_zzz", spend: 20000, sourceRowHash: "p2" } });
  const campaign = await db.campaign.create({ data: { workspaceId: w, externalId: "c-spring", name: "Spring", adAccountId: "act_1" } });
  await db.adSpend.create({ data: { workspaceId: w, date: placedAt, creativeId: null, externalCreativeId: "cr_c1", campaignId: "c-spring", adAccountId: "act_1", spend: 50000, sourceRowHash: "p3" } });
  await t.caller.expenses.create({ date: placedAt, category: "SOFTWARE", amount: 100000, allocation: "GLOBAL", costType: "FIXED" });
  await db.mdmProductLink.create({ data: { workspaceId: w, mdmProductId: "mdm-lamp", productId: product.id, mdmName: "Lamp" } });
  const stock = (providerId: string, available: number, incoming: number, totalInbound: number) =>
    db.mdmStockItem.create({ data: { workspaceId: w, providerId, mdmProductId: "mdm-lamp", productName: "Lamp", variantName: providerId, available, incoming, totalInbound, inDelivery: 3, sellingPrice: 400000, purchasePrice: 95000, stockAt: new Date() } });
  await stock("v-red", 40, 10, 120);
  await stock("v-blue", 5, 0, 30);
  return { product, campaign };
}

describe("profit tracker", () => {
  let t: Tenant;
  let ids: Awaited<ReturnType<typeof build>>;
  beforeAll(async () => {
    t = await makeTenant("Profit");
    ids = await build(t);
  });

  it("gives each product its MDM stock, real rates, costs and ad spend", async () => {
    const r = await t.caller.profit.tracker({});
    expect(r.currency).toBe("DZD");
    expect(r.products).toHaveLength(1);
    const p = r.products[0];
    expect(p).toMatchObject({ id: ids.product.id, name: "Lamp", plan: null });
    expect(p.cost).toMatchObject({ salePrice: 390000, sourcingCost: 90000 });
    expect(p.stock).toEqual({ read: true, available: 45, incoming: 10, received: 150, sellingPrice: 400000, purchasePrice: 95000 });
    expect(p.stockDetail).toMatchObject({ inDelivery: 6 });
    expect(p.sample).toMatchObject({ placed: 5, confirmed: 4, shipped: 4, finished: 3, delivered: 2, returned: 1, lost: 0, inTransit: 1 });
    // Spend nobody linked counts for no product, even the only one, and is listed to link it.
    expect(r.unlinked).toEqual({ total: 70000, campaigns: [{ id: ids.campaign.id, name: "Spring", spend: 50000 }], other: 20000 });
    expect(p.observed).toMatchObject({ enough: false, confirmationRate: 0.8, shippingRate: 1, lostRate: 0, unitsPerOrder: 1, cpa: 70000, avgShippingFee: 60000, avgReturnFee: 25000 });
    expect(p.observed.deliveryRate).toBeCloseTo(2 / 3);
    expect(p.actual).toMatchObject({ deliveredUnits: 2, deliveredRevenue: 780000, cogs: 180000, adSpend: 350000, outboundShipping: 180000, rtoCost: 25000, callCenterCost: 48000, packagingCost: 15000, overhead: 100000, cashInTransit: 390000 });
    expect(p.actual.trueNetProfit).toBe(780000 - 350000 - 180000 - 180000 - 25000 - 48000 - 15000 - 100000);

    // Linking the campaign from here moves its spend into the product.
    await t.caller.campaigns.setProduct({ id: ids.campaign.id, productId: ids.product.id });
    const linked = await t.caller.profit.tracker({});
    expect(linked.unlinked).toEqual({ total: 20000, campaigns: [], other: 20000 });
    expect(linked.products[0].actual.adSpend).toBe(400000);
    await t.caller.campaigns.setProduct({ id: ids.campaign.id, productId: null });

    // Too few finished parcels for the default threshold (10): rates fall back, fees come from product details.
    const seed = seedFor(p, r.defaults);
    expect(seed).toMatchObject({ stockSource: "MDM_AVAILABLE", units: 45 });
    expect(seed.inputs).toMatchObject({ deliveryRate: 0.6, forwardShippingFee: 60000, rtoFee: 25000, cpa: 70000 });
  });

  it("reads rates from the orders once there are enough finished parcels", async () => {
    await db.workspace.update({ where: { id: t.ws.id }, data: { verdictThresholds: { minShippedForRates: 3 } } });
    const r = await t.caller.profit.tracker({});
    const seed = seedFor(r.products[0], r.defaults);
    expect(seed.inputs.deliveryRate).toBeCloseTo(2 / 3);
    expect(seed.sources.deliveryRate).toBe("orders");
    await db.workspace.update({ where: { id: t.ws.id }, data: { verdictThresholds: {} } });
  });

  it("only counts orders placed in the days picked", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const r = await t.caller.profit.tracker({ from: today, to: today });
    expect(r.products[0].sample.placed).toBe(0);
    expect(r.products[0].actual.adSpend).toBe(0);
    expect(r.products[0].stock.available).toBe(45);
  });

  it("saves an owner's numbers for a product, and goes back to the data", async () => {
    await t.caller.profit.savePlan({ productId: ids.product.id, plan: { stockSource: "TYPED", stockUnits: 300, overrides: { deliveryRate: 0.7, cpa: 60000 } } });
    let r = await t.caller.profit.tracker({});
    expect(r.products[0].plan).toEqual({ stockSource: "TYPED", stockUnits: 300, overrides: { deliveryRate: 0.7, cpa: 60000 } });
    const seed = seedFor(r.products[0], r.defaults);
    expect(seed).toMatchObject({ stockSource: "TYPED", units: 300 });
    expect(seed.inputs).toMatchObject({ deliveryRate: 0.7, cpa: 60000 });
    const log = await db.auditLog.findFirst({ where: { workspaceId: t.ws.id, action: "profitPlan.saved" } });
    expect(log).not.toBeNull();

    await t.caller.profit.savePlan({ productId: ids.product.id, plan: null });
    r = await t.caller.profit.tracker({});
    expect(r.products[0].plan).toBeNull();
  });

  it("refuses values a plan can't hold", async () => {
    await expect(t.caller.profit.savePlan({ productId: ids.product.id, plan: { stockSource: "TYPED", stockUnits: 1, overrides: { deliveryRate: 2 } } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // @ts-expect-error unknown field
    await expect(t.caller.profit.savePlan({ productId: ids.product.id, plan: { stockSource: "TYPED", stockUnits: 1, overrides: { secret: "x" } } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("lets analysts look but not save, and keeps operators out", async () => {
    const analyst = await addMember(t.ws.id, "ANALYST");
    const operator = await addMember(t.ws.id, "OPERATOR");
    await expect(analyst.caller.profit.tracker({})).resolves.toMatchObject({ currency: "DZD" });
    await expect(analyst.caller.profit.savePlan({ productId: ids.product.id, plan: null })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(operator.caller.profit.tracker({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("never reaches another business's products", async () => {
    const other = await makeTenant("Profit other");
    await expect(other.caller.profit.savePlan({ productId: ids.product.id, plan: null })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const r = await other.caller.profit.tracker({});
    expect(r.products).toHaveLength(0);
  });

  it("matches MDM stock by name when the product has no MDM link", async () => {
    const mug = await t.caller.products.create({ name: "Mug", sku: "MUG", cost });
    await db.mdmStockItem.create({ data: { workspaceId: t.ws.id, providerId: "v-mug", mdmProductId: "mdm-mug", productName: " mug ", available: 7, stockAt: new Date() } });
    const r = await t.caller.profit.tracker({});
    const m = r.products.find((p) => p.id === mug.id)!;
    expect(m.stock).toMatchObject({ read: true, available: 7 });
    expect(r.unlinked.total).toBe(70000);
    expect(r.products.find((p) => p.id === ids.product.id)!.actual.adSpend).toBe(350000);
  });
});
