import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { tidyWilayas } from "@/server/wilayas";
import { cost, makeTenant } from "../helpers";

async function order(workspaceId: string, n: string, wilaya: string, source: "SHOPIFY" | "MDM_EXPRESS" = "SHOPIFY") {
  return db.order.create({ data: { workspaceId, source, externalOrderId: n, orderNumber: n, normalizedOrderNumber: n, placedAt: new Date("2026-09-20T09:00:00Z"), codAmount: 390000, wilaya } });
}

describe("wilayas", () => {
  it("renames French and Arabic spellings stored earlier to one Arabic name, workspace by workspace", async () => {
    const a = await makeTenant("Wilaya A");
    const b = await makeTenant("Wilaya B");
    await order(a.ws.id, "W-1", "Alger");
    await order(a.ws.id, "W-2", "الجزائر", "MDM_EXPRESS");
    await order(a.ws.id, "W-3", "Béjaïa");
    await order(a.ws.id, "W-4", "Somewhere");
    const o5 = await order(a.ws.id, "W-5", "16 - Alger");
    await db.parcel.create({ data: { workspaceId: a.ws.id, orderId: o5.id, provider: "MDM_EXPRESS", trackingId: "WT-1", normalizedStatus: "DELIVERED", codAmount: 390000, wilaya: "Oran" } });
    await order(b.ws.id, "W-1", "Oran");

    expect(await tidyWilayas(a.ws.id)).toBe(4);
    const names = await db.order.findMany({ where: { workspaceId: a.ws.id }, orderBy: { orderNumber: "asc" }, select: { wilaya: true } });
    expect(names.map((o) => o.wilaya)).toEqual(["الجزائر", "الجزائر", "بجاية", "Somewhere", "الجزائر"]);
    expect((await db.parcel.findFirstOrThrow({ where: { workspaceId: a.ws.id } })).wilaya).toBe("وهران");
    // The other business waits for its own sync, or the next start, which tidies every workspace.
    expect((await db.order.findFirstOrThrow({ where: { workspaceId: b.ws.id } })).wilaya).toBe("Oran");
    expect(await tidyWilayas(a.ws.id)).toBe(0);
    await tidyWilayas();
    expect((await db.order.findFirstOrThrow({ where: { workspaceId: b.ws.id } })).wilaya).toBe("وهران");

    // The orders filter lists each wilaya once, in number order.
    expect((await a.caller.orders.facets()).wilayas).toEqual(["بجاية", "الجزائر", "Somewhere"]);
    expect((await a.caller.orders.list({ wilaya: "الجزائر" })).items).toHaveLength(3);
  });

  it("stores a typed wilaya under its Arabic name", async () => {
    const t = await makeTenant("Wilaya typed");
    const p = await t.caller.products.create({ name: "Lamp", sku: "LMP", cost });
    const { id } = await t.caller.orders.create({ orderNumber: "M-1", placedAt: new Date("2026-09-20T09:00:00Z"), status: "PENDING", wilaya: "oran", codAmount: 1000, lines: [{ productId: p.id, quantity: 1, unitPrice: 1000 }] });
    expect((await db.order.findUniqueOrThrow({ where: { id } })).wilaya).toBe("وهران");
  });
});
