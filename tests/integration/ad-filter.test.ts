import { beforeAll, describe, expect, it } from "vitest";
import { adFilterSchema } from "@/domain/adFilter";
import { db } from "@/server/db";
import { cost, makeTenant } from "../helpers";

type Tenant = Awaited<ReturnType<typeof makeTenant>>;
const DAY = 86_400_000;

/**
 * Two Business Managers: "BM A" reads act_1 (campaigns 701 and 702), "BM B" reads act_2 (campaign 703).
 * Campaign 709 is only known from imported spend, under act_9. One ad per campaign, one delivered
 * order per ad of 701, 703 and 709, plus one delivered order without an ad. Spend: 701 1000, 702 500,
 * 703 2000, 709 300 DZD. One expense for the whole business of 800 DZD, shared by delivered orders.
 */
async function build(t: Tenant) {
  const w = t.ws.id;
  const product = await t.caller.products.create({ name: "Lamp", sku: "LMP", cost });
  const token = (label: string) => db.metaToken.create({ data: { workspaceId: w, label, encryptedCredential: "x", keyVersion: 1, maskedLabel: "••••0000" } });
  const [a, b] = [await token("BM A"), await token("BM B")];
  await db.adAccount.create({ data: { workspaceId: w, externalId: "act_1", name: "Account one", tokenId: a.id } });
  await db.adAccount.create({ data: { workspaceId: w, externalId: "act_2", name: "Account two", tokenId: b.id } });
  const campaigns = [["701", "act_1", "ACTIVE"], ["702", "act_1", "PAUSED"], ["703", "act_2", "ACTIVE"], ["709", "act_9", null]] as const;
  const placedAt = new Date(Date.now() - 3 * DAY);
  for (const [externalId, adAccountId, status] of campaigns) {
    await db.campaign.create({ data: { workspaceId: w, externalId, name: `Campaign ${externalId}`, adAccountId, status } });
    const creative = await db.creative.create({ data: { workspaceId: w, externalCreativeId: `ad_${externalId}`, normalizedKey: `ad_${externalId}`, campaignId: externalId, productId: product.id } });
    const spend = { "701": 100000, "702": 50000, "703": 200000, "709": 30000 }[externalId];
    // Spend read from Meta carries its ad account; imported spend (709) does not.
    await db.adSpend.create({ data: { workspaceId: w, date: placedAt, creativeId: creative.id, campaignId: externalId, adAccountId: externalId === "709" ? null : adAccountId, spend, sourceRowHash: `s${externalId}` } });
  }
  const order = async (n: string, utmContent?: string) => {
    const o = await t.caller.orders.create({ orderNumber: n, placedAt, status: "CONFIRMED", codAmount: 390000, utmContent, lines: [{ productId: product.id, quantity: 1, unitPrice: 390000 }] });
    await db.parcel.create({ data: { workspaceId: w, orderId: o.id, provider: "MDM_EXPRESS", trackingId: `T${n}`, normalizedStatus: "DELIVERED", codAmount: 390000, dispatchedAt: placedAt } });
  };
  await order("1", "ad_701");
  await order("2", "ad_703");
  await order("3", "ad_709");
  await order("4");
  await t.caller.expenses.create({ date: placedAt, category: "SOFTWARE", amount: 80000, allocation: "GLOBAL", costType: "FIXED" });
  return { product, a, b };
}

describe("Meta ads filter", () => {
  let t: Tenant;
  let ids: Awaited<ReturnType<typeof build>>;
  beforeAll(async () => {
    t = await makeTenant("Ad filter");
    ids = await build(t);
  });

  const dash = (ads?: Parameters<Tenant["caller"]["reports"]["dashboard"]>[0]["ads"]) => t.caller.reports.dashboard({ ads }).then((r) => r.metrics);

  it("counts every ad and every order with nothing picked", async () => {
    const m = await dash();
    expect(m).toMatchObject({ placed: 4, adSpend: 380000, allocatedOverhead: 80000 });
    expect(await dash({ campaignIds: [], adAccountIds: [], tokenIds: [] })).toMatchObject({ placed: 4, adSpend: 380000 });
  });

  it("counts only picked campaigns, from any ad accounts, with their share of the expenses", async () => {
    const m = await dash({ campaignIds: ["702", "703"] });
    expect(m).toMatchObject({ placed: 1, delivered: 1, adSpend: 250000, allocatedOverhead: 20000 });
  });

  it("counts picked ad accounts, through spend from Meta and campaigns known from imports", async () => {
    expect(await dash({ adAccountIds: ["act_1"] })).toMatchObject({ placed: 1, adSpend: 150000 });
    expect(await dash({ adAccountIds: ["act_1", "act_9"] })).toMatchObject({ placed: 2, adSpend: 180000, allocatedOverhead: 40000 });
  });

  it("counts a Business Manager's ad accounts, and campaigns win over ad accounts", async () => {
    expect(await dash({ tokenIds: [ids.b.id] })).toMatchObject({ placed: 1, adSpend: 200000 });
    expect(await dash({ tokenIds: [ids.a.id], adAccountIds: ["act_2"] })).toMatchObject({ adSpend: 200000 });
    expect(await dash({ adAccountIds: ["act_2"], campaignIds: ["701"] })).toMatchObject({ adSpend: 100000 });
  });

  it("filters the creatives, campaigns, Profit tracker and orders the same way", async () => {
    const ads = { adAccountIds: ["act_1"] };
    const matrix = await t.caller.creatives.matrix({ ads });
    expect(matrix.rows.map((r) => r.externalCreativeId).sort()).toEqual(["ad_701", "ad_702"]);
    const campaigns = await t.caller.campaigns.report({ ads });
    expect(campaigns.rows.map((r) => r.externalId).sort()).toEqual(["701", "702"]);
    const profit = await t.caller.profit.tracker({ ads });
    expect(profit.adScoped).toBe(true);
    expect(profit.products[0].actual).toMatchObject({ deliveredUnits: 1, adSpend: 150000 });
    const orders = await t.caller.orders.list({ ads: { campaignIds: ["703", "709"] } });
    expect(orders.items.map((o) => o.orderNumber).sort()).toEqual(["2", "3"]);
    expect((await t.caller.orders.list({ ads: { tokenIds: [ids.a.id] } })).items.map((o) => o.orderNumber)).toEqual(["1"]);
    expect((await t.caller.orders.list({})).total).toBe(4);
  });

  it("lists Business Managers, ad accounts and campaigns to pick from", async () => {
    const o = await t.caller.campaigns.filterOptions();
    expect(o.tokens.map((x) => x.label)).toEqual(["BM A", "BM B"]);
    expect(o.accounts.map((x) => [x.externalId, x.tokenId])).toEqual([["act_1", ids.a.id], ["act_2", ids.b.id], ["act_9", null]]);
    expect(o.campaigns.find((c) => c.externalId === "701")).toMatchObject({ adAccountId: "act_1", running: true });
    expect(o.campaigns.find((c) => c.externalId === "702")).toMatchObject({ running: false });
  });

  it("refuses values a filter can't hold and stays in its own business", async () => {
    expect(adFilterSchema.safeParse({ adAccountIds: ["123"] }).success).toBe(false);
    expect(adFilterSchema.safeParse({ secret: ["x"] }).success).toBe(false);
    const other = await makeTenant("Ad filter other");
    expect((await other.caller.reports.dashboard({ ads: { tokenIds: [ids.a.id] } })).metrics).toMatchObject({ placed: 0, adSpend: 0 });
    expect((await other.caller.orders.list({ ads: { campaignIds: ["701"] } })).total).toBe(0);
    expect(await other.caller.campaigns.filterOptions()).toEqual({ tokens: [], accounts: [], campaigns: [] });
  });
});
