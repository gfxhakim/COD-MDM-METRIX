import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createMockMetaAdapter } from "@/server/meta/mock";
import { runMetaSync } from "@/server/meta/sync";
import { MetaError, type MetaAdAccount, type MetaSpendRow } from "@/server/meta/types";
import { addMember, cost, makeTenant } from "../helpers";

type Tenant = Awaited<ReturnType<typeof makeTenant>>;
const TOKEN = "EAAplaceholderTOKEN0000000000000077";
const NOW = new Date("2026-09-28T12:00:00Z");
const DAY = "2026-09-27";
const RANGE = { from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-09-30T23:59:59Z") };
const ACCOUNT: MetaAdAccount = { id: "act_111", name: "Main account", currency: "DZD", timezone: "Africa/Algiers", accountStatus: 1 };
const row = (adId: string, campaignId: string, campaignName: string, spend: number): MetaSpendRow => ({
  date: DAY, adId, adName: `Ad ${adId}`, adsetId: "900", adsetName: "Broad", campaignId, campaignName, spend, currency: "DZD", impressions: 1000, clicks: 10,
});

async function connected(name: string) {
  const t = await makeTenant(name);
  await t.caller.integrations.saveMetaToken({ label: "Main BM", token: TOKEN });
  await db.metaToken.updateMany({ where: { workspaceId: t.ws.id }, data: { status: "CONNECTED" } });
  await db.integrationConnection.updateMany({ where: { workspaceId: t.ws.id, provider: "META_ADS" }, data: { status: "CONNECTED" } });
  return t;
}
const sync = (t: Tenant, opts: Parameters<typeof createMockMetaAdapter>[0]) =>
  runMetaSync(t.ws.id, {}, { adapterFactory: async () => createMockMetaAdapter(opts), sleep: async () => {}, now: () => NOW });
const campaigns = async (t: Tenant) =>
  Object.fromEntries((await db.campaign.findMany({ where: { workspaceId: t.ws.id } })).map((c) => [c.externalId, { name: c.name, status: c.status, adAccountId: c.adAccountId }]));

describe("campaigns from the Meta sync", () => {
  it("records each campaign with its status, and marks ones Meta stops listing", async () => {
    const t = await connected("CampaignSync");
    const rows = { act_111: [row("1001", "700", "Spring", 300000), row("1002", "701", "Summer", 100000)] };
    const first = await sync(t, { token: TOKEN, accounts: [ACCOUNT], rows, campaigns: { act_111: [{ id: "700", name: "Spring", status: "ACTIVE" }, { id: "701", name: "Summer", status: "ACTIVE" }, { id: "702", name: "Idle", status: "PAUSED" }] } });
    expect(first).toMatchObject({ ran: true, ok: true });
    expect(await campaigns(t)).toEqual({
      "700": { name: "Spring", status: "ACTIVE", adAccountId: "act_111" },
      "701": { name: "Summer", status: "ACTIVE", adAccountId: "act_111" },
      "702": { name: "Idle", status: "PAUSED", adAccountId: "act_111" },
    });
    const ad = await db.creative.findFirstOrThrow({ where: { workspaceId: t.ws.id, externalCreativeId: "1002" } });
    expect(ad.campaignId).toBe("701");

    // Summer was deleted in Meta: its past spend still counts, and it is shown as archived or deleted.
    await sync(t, { token: TOKEN, accounts: [ACCOUNT], rows, campaigns: { act_111: [{ id: "700", name: "Spring renamed", status: "PAUSED" }, { id: "702", name: "Idle", status: "PAUSED" }] } });
    expect(await campaigns(t)).toMatchObject({ "700": { name: "Spring renamed", status: "PAUSED" }, "701": { status: "NOT_LISTED" } });
    const report = await t.caller.campaigns.report(RANGE);
    const summer = report.rows.find((r) => r.externalId === "701")!;
    expect(summer).toMatchObject({ status: "NOT_LISTED", running: true, metrics: { adSpend: 100000 } });
    expect(report.rows.find((r) => r.externalId === "702")).toMatchObject({ running: false });
  });

  it("keeps the spend when the campaign status can't be read", async () => {
    const t = await connected("CampaignStatusFails");
    const result = await sync(t, { token: TOKEN, accounts: [ACCOUNT], rows: { act_111: [row("2001", "800", "Autumn", 50000)] }, failures: { "campaigns:act_111": [new MetaError("refused", "PERMISSION")] } });
    expect(result).toMatchObject({ ran: true, ok: true, added: 1 });
    // Known from its spend, status unknown.
    expect(await campaigns(t)).toEqual({ "800": { name: "Autumn", status: null, adAccountId: "act_111" } });
  });
});

/**
 * Two products, two ad accounts:
 * act_111: campaign c1 (ad cr_1, spend 1000, 2 orders of Lamp), campaign c2 (ad cr_2, spend 500, 1 order of Chair)
 * act_222: campaign c3 (ad cr_3, no spend in range, 1 order of Lamp)
 * One order without an ad ID, and 200 of spend without a campaign.
 */
async function build(t: Tenant) {
  const w = t.ws.id;
  const lamp = await t.caller.products.create({ name: "Lamp", sku: "LMP", cost });
  const chair = await t.caller.products.create({ name: "Chair", sku: "CHR", cost });
  const [a1, a2] = await Promise.all(["act_111", "act_222"].map((externalId, i) => db.adAccount.create({ data: { workspaceId: w, externalId, name: `Account ${i + 1}` } })));
  const creative = (ext: string, campaignId: string, productId: string) => db.creative.create({ data: { workspaceId: w, externalCreativeId: ext, normalizedKey: ext, name: `Ad ${ext}`, campaignId, campaignName: `Campaign ${campaignId}`, productId } });
  const cr1 = await creative("cr_1", "c1", lamp.id);
  const cr2 = await creative("cr_2", "c2", chair.id);
  const cr3 = await creative("cr_3", "c3", lamp.id);
  const placedAt = new Date("2026-09-20T10:00:00Z");
  const order = (n: string, utm: string | undefined, productId: string) =>
    t.caller.orders.create({ orderNumber: n, placedAt, status: "CONFIRMED", codAmount: 390000, utmContent: utm, lines: [{ productId, quantity: 1, unitPrice: 390000 }] });
  await order("1", "cr_1", lamp.id);
  await order("2", "cr_1", lamp.id);
  await order("3", "cr_2", chair.id);
  await order("4", "cr_3", lamp.id);
  await order("5", undefined, lamp.id);
  const spend = (creativeId: string | null, campaignId: string | null, adAccountId: string | null, amount: number, h: string, date = placedAt) =>
    db.adSpend.create({ data: { workspaceId: w, date, creativeId, campaignId, campaignName: campaignId ? `Campaign ${campaignId}` : null, adAccountId, spend: amount, sourceRowHash: h } });
  await spend(cr1.id, "c1", "act_111", 100000, "s1");
  await spend(cr2.id, "c2", "act_111", 50000, "s2");
  await spend(cr3.id, "c3", "act_222", 70000, "s3", new Date("2026-08-01T10:00:00Z"));
  await spend(null, null, null, 20000, "s4");
  return { lamp, chair, a1, a2, cr1, cr2, cr3 };
}

describe("campaign report and product links", () => {
  it("shows each campaign with its own orders and spend, per ad account", async () => {
    const t = await makeTenant("CampaignReport");
    await build(t);
    const all = await t.caller.campaigns.report(RANGE);
    const by = (ext: string | null) => all.rows.find((r) => r.externalId === ext)!;
    // Not linked yet: no product, even though their ads have one. Nothing is guessed.
    expect(by("c1")).toMatchObject({ ownProductId: null, productId: null, productSource: null });
    expect(by("c2")).toMatchObject({ productId: null, productSource: null, otherProductOrders: 0 });
    expect(by("c1")).toMatchObject({ adAccountId: "act_111", running: true, metrics: { adSpend: 100000, placed: 2 }, ads: [{ externalCreativeId: "cr_1" }] });
    expect(by("c2")).toMatchObject({ metrics: { adSpend: 50000, placed: 1 } });
    // No spend in the period and no status from Meta: not running, but its orders still count.
    expect(by("c3")).toMatchObject({ adAccountId: "act_222", running: false, metrics: { adSpend: 0, placed: 1 } });
    expect(all.rows.at(-1)).toMatchObject({ kind: "NO_CAMPAIGN", metrics: { adSpend: 20000, placed: 1 } });
    expect(all.total).toMatchObject({ adSpend: 170000, placed: 5 });
    expect(all.accounts.map((a) => [a.externalId, a.campaigns])).toEqual([["act_111", 2], ["act_222", 1]]);

    const one = await t.caller.campaigns.report({ ...RANGE, adAccountId: "act_111" });
    expect(one.rows.map((r) => r.externalId).sort()).toEqual(["c1", "c2"]);
    expect(one.total).toMatchObject({ adSpend: 150000, placed: 3 });

    await db.campaign.updateMany({ where: { workspaceId: t.ws.id, externalId: "c3" }, data: { status: "ACTIVE" } });
    expect((await t.caller.campaigns.report({ ...RANGE, adAccountId: "act_222" })).rows).toMatchObject([{ externalId: "c3", running: true }]);
    await expect(t.caller.campaigns.report({ ...RANGE, adAccountId: "act_../x" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("counts spend for a product only through its campaign's link, else its ad account's", async () => {
    const t = await makeTenant("CampaignLinks");
    const ids = await build(t);
    const spendFor = async (productId: string) => (await t.caller.reports.dashboard({ ...RANGE, productId })).metrics.adSpend;
    // Before any link: no product, though the ads have one of their own.
    expect(await spendFor(ids.lamp.id)).toBe(0);
    expect(await spendFor(ids.chair.id)).toBe(0);

    const links = await t.caller.campaigns.links();
    const c = (ext: string) => links.campaigns.find((x) => x.externalId === ext)!;
    // A whole ad account counts for Chair...
    await t.caller.campaigns.setAccountProduct({ id: ids.a1.id, productId: ids.chair.id });
    expect(await spendFor(ids.chair.id)).toBe(150000);
    // ...except a campaign linked to its own product.
    await t.caller.campaigns.setProduct({ id: c("c1").id, productId: ids.lamp.id });
    await t.caller.campaigns.setProduct({ id: c("c2").id, productId: ids.lamp.id });
    expect(await spendFor(ids.lamp.id)).toBe(150000);
    expect(await spendFor(ids.chair.id)).toBe(0);

    const report = await t.caller.campaigns.report(RANGE);
    const c2 = report.rows.find((r) => r.externalId === "c2")!;
    expect(c2).toMatchObject({ productId: ids.lamp.id, productSource: "CAMPAIGN" });
    // Its order was for a Chair, so it is flagged.
    expect(c2.otherProductOrders).toBe(1);
    // The creative matrix follows the link too.
    const matrix = await t.caller.creatives.matrix(RANGE);
    expect(matrix.rows.find((r) => r.externalCreativeId === "cr_2")?.productId).toBe(ids.lamp.id);

    // From the product form: Chair gets c3 and the whole of act_222; Lamp keeps c1 and c2.
    await t.caller.products.update({ id: ids.chair.id, links: { campaignIds: [c("c3").id], adAccountIds: [ids.a2.id] } });
    let after = await t.caller.campaigns.links();
    expect(after.accounts.map((a) => [a.externalId, a.defaultProductId])).toEqual([["act_111", null], ["act_222", ids.chair.id]]);
    expect(after.campaigns.filter((x) => x.productId === ids.chair.id).map((x) => x.externalId)).toEqual(["c3"]);
    expect((await t.caller.products.list({ includeInactive: true })).find((p) => p.id === ids.chair.id)).toMatchObject({ linkedCampaigns: 1, linkedAdAccounts: 1 });
    // Saving Lamp with only c1 unlinks c2.
    await t.caller.products.update({ id: ids.lamp.id, links: { campaignIds: [c("c1").id], adAccountIds: [] } });
    after = await t.caller.campaigns.links();
    expect(after.campaigns.find((x) => x.externalId === "c2")?.productId).toBeNull();

    // A new product can be linked as it is created.
    const desk = await t.caller.products.create({ name: "Desk", sku: "DSK", cost, links: { campaignIds: [c("c2").id], adAccountIds: [] } });
    expect((await t.caller.campaigns.links()).campaigns.find((x) => x.externalId === "c2")?.productId).toBe(desk.id);
    expect(await db.auditLog.count({ where: { workspaceId: t.ws.id, action: { in: ["campaign.product_linked", "ad_account.product_linked", "product.ads_linked"] } } })).toBe(6);
  });

  it("only people who manage products can link, and only within their workspace", async () => {
    const t = await makeTenant("CampaignLinkRoles");
    const ids = await build(t);
    const camp = (await t.caller.campaigns.links()).campaigns[0];
    const analyst = await addMember(t.ws.id, "ANALYST");
    await expect(analyst.caller.campaigns.setProduct({ id: camp.id, productId: ids.lamp.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(analyst.caller.campaigns.setAccountProduct({ id: ids.a1.id, productId: ids.lamp.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await analyst.caller.campaigns.report(RANGE)).rows.length).toBeGreaterThan(0);

    const other = await makeTenant("CampaignLinkOther");
    const mine = await other.caller.products.create({ name: "Mine", sku: "MINE", cost });
    await expect(other.caller.campaigns.setProduct({ id: camp.id, productId: mine.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(other.caller.campaigns.setAccountProduct({ id: ids.a1.id, productId: mine.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(other.caller.campaigns.setProductLinks({ productId: mine.id, campaignIds: [camp.id], adAccountIds: [] })).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Nor link a campaign to another workspace's product.
    await expect(t.caller.campaigns.setProduct({ id: camp.id, productId: mine.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await other.caller.campaigns.report(RANGE)).rows).toEqual([]);
  });
});
