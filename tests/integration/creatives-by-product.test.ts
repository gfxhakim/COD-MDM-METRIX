import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { cost, makeTenant } from "../helpers";

type Tenant = Awaited<ReturnType<typeof makeTenant>>;

/**
 * Two products:
 * cr_1 in campaign c1, linked to Lamp: 2 Lamp orders
 * cr_2 in campaign c2, not linked: 2 Chair orders and 1 Lamp order
 * cr_3 in campaign c3, not linked: spend only
 * cr_4 without a campaign, its own product Lamp: 1 Chair order
 * One order without an ad ID, and spend without a known ad.
 */
async function build(t: Tenant) {
  const w = t.ws.id;
  const lamp = await t.caller.products.create({ name: "Lamp", sku: "LMP", cost });
  const chair = await t.caller.products.create({ name: "Chair", sku: "CHR", cost });
  await db.campaign.create({ data: { workspaceId: w, externalId: "c1", name: "Lamp campaign", productId: lamp.id } });
  await db.campaign.createMany({ data: ["c2", "c3"].map((externalId) => ({ workspaceId: w, externalId, name: `Campaign ${externalId}` })) });
  const creative = (ext: string, campaignId: string | null, productId: string | null = null) =>
    db.creative.create({ data: { workspaceId: w, externalCreativeId: ext, normalizedKey: ext, name: `Ad ${ext}`, campaignId, productId } });
  const cr1 = await creative("cr_1", "c1");
  const cr2 = await creative("cr_2", "c2");
  const cr3 = await creative("cr_3", "c3");
  const cr4 = await creative("cr_4", null, lamp.id);
  const placedAt = new Date("2026-09-20T10:00:00Z");
  let n = 0;
  const order = (utm: string | undefined, productId: string) =>
    t.caller.orders.create({ orderNumber: `N${++n}`, placedAt, status: "CONFIRMED", codAmount: 390000, utmContent: utm, lines: [{ productId, quantity: 1, unitPrice: 390000 }] });
  await order("cr_1", lamp.id);
  await order("cr_1", lamp.id);
  await order("cr_2", chair.id);
  await order("cr_2", chair.id);
  await order("cr_2", lamp.id);
  await order("cr_4", chair.id);
  await order(undefined, lamp.id);
  const spend = (creativeId: string | null, campaignId: string | null, amount: number, h: string) =>
    db.adSpend.create({ data: { workspaceId: w, date: placedAt, creativeId, campaignId, externalCreativeId: creativeId ? undefined : "cr_zzz", spend: amount, sourceRowHash: h } });
  await spend(cr1.id, "c1", 100000, "s1");
  await spend(cr2.id, "c2", 60000, "s2");
  await spend(cr3.id, "c3", 30000, "s3");
  await spend(null, null, 20000, "s4");
  return { lamp, chair, cr1, cr2, cr3, cr4 };
}

const csvLines = (content: string) => content.split("\r\n").filter(Boolean);

describe("creatives by product", () => {
  it("puts each ad with its linked product, else the product most of its orders are for", async () => {
    const t = await makeTenant("CreativesByProduct");
    const { lamp, chair, cr1, cr2, cr3, cr4 } = await build(t);
    const r = await t.caller.creatives.matrix({});
    const row = (id: string) => r.rows.find((x) => x.creativeId === id)!;
    expect(row(cr1.id).product).toEqual({ id: lamp.id, source: "LINK" });
    expect(row(cr2.id).product).toEqual({ id: chair.id, source: "ORDERS" });
    expect(row(cr3.id).product).toBeNull();
    // An ad without a campaign keeps its own product, whatever its orders are for.
    expect(row(cr4.id).product).toEqual({ id: lamp.id, source: "LINK" });
    expect(r.rows.filter((x) => x.kind !== "CREATIVE").map((x) => x.product)).toEqual([null, null]);
    expect(r.products.map((p) => p.name)).toEqual(["Chair", "Lamp"]);
  });

  it("exports one product's ads, the ads with no product, or each product apart", async () => {
    const t = await makeTenant("CreativesByProductCsv");
    const { lamp } = await build(t);
    const columns = ["creative", "product", "adSpend"] as const;

    const one = csvLines((await t.caller.creatives.exportCsv({ columns: [...columns], product: lamp.id })).content);
    expect(one[0]).toBe("Creative ID,Product,Spend (DZD)");
    expect(one.slice(1).sort()).toEqual(["cr_1,Lamp,1000", "cr_4,Lamp,0"]);

    const none = csvLines((await t.caller.creatives.exportCsv({ columns: [...columns], product: "none" })).content);
    expect(none.slice(1)).toEqual(["cr_3,,300"]);

    const each = csvLines((await t.caller.creatives.exportCsv({ columns: [...columns], product: "each" })).content);
    expect(each.slice(1).map((l) => l.split(",")[1])).toEqual(["Chair", "Lamp", "Lamp", "", "", ""]);
    expect(each.at(-2)).toContain("Unattributed orders");

    // Every product together, as before: every row, the product column filled where there is one.
    const all = csvLines((await t.caller.creatives.exportCsv({ columns: [...columns] })).content);
    expect(all).toHaveLength(1 + 6);
  });
});
