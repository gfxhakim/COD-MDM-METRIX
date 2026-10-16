import { beforeAll, describe, expect, it } from "vitest";
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

  it("gives each product its real profit, what its open orders should still bring, and where each number comes from", async () => {
    const r = await t.caller.profit.tracker({});
    expect(r.currency).toBe("DZD");
    expect(r.products).toHaveLength(1);
    const p = r.products[0];
    expect(p).toMatchObject({ id: ids.product.id, name: "Lamp", adsLinked: true });
    expect(p.cost).toMatchObject({ salePrice: 390000, sourcingCost: 90000 });
    expect(p.stock).toMatchObject({ read: true, available: 45, incoming: 10 });
    // The pending order was placed 5 days ago: still waiting for the call, so not counted as not confirmed.
    expect(p.sample).toEqual({ placed: 5, confirmed: 4, shipped: 4, finished: 3, delivered: 2, returned: 1, lost: 0, inTransit: 1, notConfirmed: 0 });
    expect(p.open).toEqual({ road: 1, preparing: 0, waiting: 1 });
    // Spend nobody linked counts for no product, even the only one, and is listed to link it.
    expect(r.unlinked).toEqual({ total: 70000, campaigns: [{ id: ids.campaign.id, name: "Spring", spend: 50000 }], other: 20000 });
    expect(p.actual).toMatchObject({ deliveredUnits: 2, deliveredRevenue: 780000, cogs: 180000, adSpend: 350000, outboundShipping: 180000, rtoCost: 25000, callCenterCost: 48000, packagingCost: 15000, overhead: 100000 });
    expect(p.actual.trueNetProfit).toBe(780000 - 350000 - 180000 - 180000 - 25000 - 48000 - 15000 - 100000);

    // Too few finished parcels for the default threshold (10): example rates, said to be one.
    expect(p.rates).toEqual({ source: "example", finished: 0, confirmation: 0.75, shipping: 0.95, delivery: 0.6, lost: 0 });
    // On the road: 60% × (3900 − 900) − 600 − 50 − 40% × 250. Waiting: 75% confirmed × (95% shipped × that − its call).
    expect(p.expected.road).toBe(105000);
    // Its call is paid only once confirmed (per confirmed order here), so it comes off what it should bring.
    expect(p.expected.waiting).toBeCloseTo(0.75 * (0.95 * 105000 - 12000), -1);
    expect(p.expected.total).toBe(p.expected.road + p.expected.preparing + p.expected.waiting);

    // Price, delivery and return fees from what MDM really collected and charged; the rest from the product.
    expect(p.inputs).toMatchObject({
      price: { value: 390000, source: "orders" },
      costPerPiece: { value: 90000, source: "product" },
      deliveryFee: { value: 60000, source: "orders" },
      returnFee: { value: 25000, source: "orders" },
      callCenterFee: { value: 12000, source: "product" },
      packagingFee: { value: 5000, source: "product" },
      adCostPerOrder: { value: 70000, source: "campaigns" },
      delivered: 2,
      finished: 3,
    });
    // 5 orders over the 6 days from the first order to today; the expense over 30 days.
    expect(p.pace).toMatchObject({ days: 6, expensesPerMonth: 500000 });
    expect(p.pace.ordersPerDay).toBeCloseTo(5 / 6);
    const day = p.days.find((d) => d.placed > 0)!;
    expect(day).toMatchObject({ placed: 5, delivered: 2, returned: 1, open: 2, revenue: 780000, costs: 448000 });
    expect(day.expected).toBe(p.expected.total);

    // Linking the campaign from here moves its spend into the product.
    await t.caller.campaigns.setProduct({ id: ids.campaign.id, productId: ids.product.id });
    const linked = await t.caller.profit.tracker({});
    expect(linked.unlinked).toEqual({ total: 20000, campaigns: [], other: 20000 });
    expect(linked.products[0].actual.adSpend).toBe(400000);
    expect(linked.products[0].inputs.adCostPerOrder.value).toBe(80000);
    await t.caller.campaigns.setProduct({ id: ids.campaign.id, productId: null });
  });

  it("reads rates from the orders once there are enough finished parcels, leaving out orders still waiting", async () => {
    await db.workspace.update({ where: { id: t.ws.id }, data: { verdictThresholds: { minShippedForRates: 3 } } });
    const r = await t.caller.profit.tracker({});
    const rates = r.products[0].rates;
    // 4 confirmed of the 4 whose call is answered; 2 delivered of 3 finished.
    expect(rates).toMatchObject({ source: "days", finished: 3, confirmation: 1, shipping: 1, lost: 0 });
    expect(rates.delivery).toBeCloseTo(2 / 3);
    await db.workspace.update({ where: { id: t.ws.id }, data: { verdictThresholds: {} } });
  });

  it("only counts orders placed in the days picked, and takes the rates from every order then", async () => {
    await db.workspace.update({ where: { id: t.ws.id }, data: { verdictThresholds: { minShippedForRates: 3 } } });
    const today = new Date().toISOString().slice(0, 10);
    const r = await t.caller.profit.tracker({ from: today, to: today });
    const p = r.products[0];
    expect(p.sample.placed).toBe(0);
    expect(p.actual.adSpend).toBe(0);
    expect(p.stock?.available).toBe(45);
    expect(p.rates.source).toBe("all");
    expect(p.inputs.price).toEqual({ value: 390000, source: "orders" });
    await db.workspace.update({ where: { id: t.ws.id }, data: { verdictThresholds: {} } });
  });

  it("lets analysts look, and keeps operators out", async () => {
    const analyst = await addMember(t.ws.id, "ANALYST");
    const operator = await addMember(t.ws.id, "OPERATOR");
    await expect(analyst.caller.profit.tracker({})).resolves.toMatchObject({ currency: "DZD" });
    await expect(operator.caller.profit.tracker({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("never reaches another business's products", async () => {
    const other = await makeTenant("Profit other");
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

describe("profit tracker: offers and campaigns", () => {
  it("counts an offer's free pieces in the product cost, and adds up the campaigns linked to the product", async () => {
    const t = await makeTenant("Offers");
    const w = t.ws.id;
    const product = await t.caller.products.create({ name: "Lamp", sku: "LMP", cost, piecesPerOrder: 2 });
    const spring = await db.campaign.create({ data: { workspaceId: w, externalId: "c-spring", name: "Spring", adAccountId: "act_1" } });
    const autumn = await db.campaign.create({ data: { workspaceId: w, externalId: "c-autumn", name: "Autumn", adAccountId: "act_1" } });
    await t.caller.campaigns.setProduct({ id: spring.id, productId: product.id });
    await t.caller.campaigns.setProduct({ id: autumn.id, productId: product.id });
    const ad = (key: string, campaignId: string) => db.creative.create({ data: { workspaceId: w, externalCreativeId: key, normalizedKey: key, campaignId } });
    await ad("ad_s", "c-spring");
    await ad("ad_a", "c-autumn");
    // Noon UTC, so the order's day is the same in the workspace's time zone; ad days are stored as
    // midnight UTC of the day.
    const adDay = new Date(Math.floor(Date.now() / DAY) * DAY - 3 * DAY);
    const placedAt = new Date(adDay.getTime() + DAY / 2);
    // Spring: one order listing the paid piece only, one listing both pieces. Autumn: one order of
    // two offers listing 4 pieces. One order without an ad.
    const orders = [
      await t.caller.orders.create({ orderNumber: "1", placedAt, status: "CONFIRMED", codAmount: 390000, utmContent: "ad_s", lines: [{ productId: product.id, quantity: 1, unitPrice: 390000 }] }),
      await t.caller.orders.create({ orderNumber: "2", placedAt, status: "CONFIRMED", codAmount: 390000, utmContent: "ad_s", lines: [{ productId: product.id, quantity: 2, unitPrice: 195000 }] }),
      await t.caller.orders.create({ orderNumber: "3", placedAt, status: "CONFIRMED", codAmount: 780000, utmContent: "ad_a", lines: [{ productId: product.id, quantity: 4, unitPrice: 195000 }] }),
      await t.caller.orders.create({ orderNumber: "4", placedAt, status: "PENDING", codAmount: 390000, lines: [{ productId: product.id, quantity: 1, unitPrice: 390000 }] }),
    ];
    for (const [i, o] of orders.slice(0, 3).entries()) {
      await db.parcel.create({ data: { workspaceId: w, orderId: o.id, provider: "MDM_EXPRESS", trackingId: `T${i}`, normalizedStatus: "DELIVERED", codAmount: o.codAmount, dispatchedAt: placedAt } });
    }
    const spend = (campaignId: string, amount: number, hash: string) => db.adSpend.create({ data: { workspaceId: w, date: adDay, creativeId: null, externalCreativeId: hash, campaignId, adAccountId: "act_1", spend: amount, sourceRowHash: hash } });
    await spend("c-spring", 60000, "s1");
    await spend("c-autumn", 30000, "a1");

    const r = await t.caller.profit.tracker({});
    const p = r.products[0];
    expect(p.piecesPerOrder).toBe(2);
    // 2 + 2 + 4 pieces delivered, 900 DZD each.
    expect(p.actual).toMatchObject({ deliveredUnits: 8, cogs: 8 * 90000, adSpend: 90000 });
    expect(p.funnel).toMatchObject({ spend: 90000, placed: 4, confirmed: 3, delivered: 3, adCostPerOrder: 22500 });
    expect(p.campaigns.map((c) => [c.name, c.spend, c.placed, c.delivered, c.adCostPerOrder])).toEqual([
      ["Spring", 60000, 2, 2, 30000],
      ["Autumn", 30000, 1, 1, 30000],
    ]);
    expect(p.otherOrders).toMatchObject({ placed: 1, spend: 0 });
    const day = p.days.find((d) => d.placed > 0)!;
    expect(day).toMatchObject({ placed: 4, delivered: 3, revenue: 1560000, adSpend: 90000 });
    expect(day.profit).toBe(day.revenue - day.costs - day.adSpend);

    // The dashboard counts the same pieces.
    const dash = await t.caller.reports.dashboard({});
    expect(dash.metrics.cogs).toBe(8 * 90000);
    // The simulator's product cost is for one order: both pieces.
    const sim = await t.caller.simulator.observed({ productId: product.id });
    expect(sim.costs).toMatchObject({ salePrice: cost.salePrice, sourcingCost: 2 * 90000 });

    // Changing the offer changes every order's cost; an analyst can't change it.
    await t.caller.products.update({ id: product.id, piecesPerOrder: 1 });
    const one = await t.caller.profit.tracker({});
    expect(one.products[0].actual.cogs).toBe(7 * 90000);
    const analyst = await addMember(w, "ANALYST");
    await expect(analyst.caller.products.update({ id: product.id, piecesPerOrder: 3 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(t.caller.products.update({ id: product.id, piecesPerOrder: 0 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
