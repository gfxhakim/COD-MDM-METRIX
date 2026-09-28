import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { addMember, cost, makeTenant } from "../helpers";

type Tenant = Awaited<ReturnType<typeof makeTenant>>;

describe("role-based access", () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await makeTenant("Roles");
  });

  it("analysts can read but not write", async () => {
    const { caller } = await addMember(t.ws.id, "ANALYST");
    await expect(caller.products.list()).resolves.toBeDefined();
    await expect(caller.products.create({ name: "X", sku: "X-1", cost })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.expenses.create({ date: new Date(), category: "OTHER", amount: 100, allocation: "GLOBAL", costType: "FIXED" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.workspace.updateSettings({ name: "hijack" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.audit.list({ limit: 10 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("operators manage orders but not catalog, economics or members", async () => {
    const product = await t.caller.products.create({ name: "Op Lamp", sku: "OP-1", cost });
    const { caller } = await addMember(t.ws.id, "OPERATOR");
    const o = await caller.orders.create({ orderNumber: "OP-1", placedAt: new Date(), status: "PENDING", codAmount: 1000, lines: [{ productId: product.id, quantity: 1, unitPrice: 1000 }] });
    await expect(caller.orders.updateStatus({ id: o.id, status: "CONFIRMED" })).resolves.toMatchObject({ status: "CONFIRMED" });
    await expect(caller.products.update({ id: product.id, name: "nope" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.workspace.updateSettings({ verdictThresholds: { minSampleOrders: 1, targetPoas: 1, minDeliveryRate: 0.5, maxRtoRate: 0.3, acceptablePlacedCpa: 100 } })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.members.add({ email: "x@test.local", role: "OWNER" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("admins cannot change roles", async () => {
    const { caller } = await addMember(t.ws.id, "ADMIN");
    const members = await t.caller.members.list();
    await expect(caller.members.changeRole({ memberId: members[0].id, role: "ANALYST" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("keeps at least one owner and audits role changes", async () => {
    const owner = (await t.caller.members.list()).find((m) => m.role === "OWNER")!;
    await expect(t.caller.members.changeRole({ memberId: owner.id, role: "ADMIN" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(t.caller.members.remove({ memberId: owner.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const analyst = (await t.caller.members.list()).find((m) => m.role === "ANALYST")!;
    await t.caller.members.changeRole({ memberId: analyst.id, role: "OPERATOR" });
    const log = await t.caller.audit.list({ limit: 50 });
    expect(log.items.find((e) => e.action === "member.role_changed")?.metadata).toEqual({ from: "ANALYST", to: "OPERATOR" });
  });
});

describe("product cost history", () => {
  it("never overwrites a cost version; a new one closes the previous", async () => {
    const t = await makeTenant("Costs");
    const p = await t.caller.products.create({ name: "Blender", sku: "BL-1", cost });
    const effective = new Date(Date.now() + 86_400_000);
    await t.caller.products.createCostVersion({ productId: p.id, effectiveFrom: effective, cost: { ...cost, sourcingCost: 120000 } });
    const versions = await db.productCostVersion.findMany({ where: { productId: p.id }, orderBy: { effectiveFrom: "asc" } });
    expect(versions).toHaveLength(2);
    expect(versions[0].sourcingCost).toBe(90000);
    expect(versions[0].effectiveTo?.getTime()).toBe(effective.getTime());
    expect(versions[1].sourcingCost).toBe(120000);
    expect(versions[1].effectiveTo).toBeNull();
    // Current cost is still the old one until the effective date.
    expect((await t.caller.products.get({ id: p.id })).currentCost?.sourcingCost).toBe(90000);
    await expect(t.caller.products.createCostVersion({ productId: p.id, effectiveFrom: new Date("2020-01-01"), cost })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("deactivates instead of deleting products that have orders", async () => {
    const t = await makeTenant("Delete");
    const p = await t.caller.products.create({ name: "Lamp", sku: "LP-1", cost });
    await t.caller.orders.create({ orderNumber: "1", placedAt: new Date(), status: "PENDING", codAmount: 1, lines: [{ productId: p.id, quantity: 1, unitPrice: 1 }] });
    await expect(t.caller.products.delete({ id: p.id })).resolves.toEqual({ deleted: false, deactivated: true });
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).active).toBe(false);
  });

  it("rejects duplicate SKUs within a workspace with a safe error", async () => {
    const t = await makeTenant("Dupes");
    await t.caller.products.create({ name: "A", sku: "DUP", cost });
    await expect(t.caller.products.create({ name: "B", sku: "DUP", cost })).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("manual orders", () => {
  it("attributes by utm_content, stores only hashed/masked phone, and audits deletion", async () => {
    const t = await makeTenant("Orders");
    const p = await t.caller.products.create({ name: "Lamp", sku: "LP-2", cost });
    await db.creative.create({ data: { workspaceId: t.ws.id, externalCreativeId: "CR_ABC", normalizedKey: "cr_abc" } });
    const o = await t.caller.orders.create({ orderNumber: "#1042", placedAt: new Date(), status: "CONFIRMED", codAmount: 390000, phone: "0555 12 34 56", utmContent: " cr_abc ", lines: [{ productId: p.id, quantity: 1, unitPrice: 390000 }] });
    const stored = await db.order.findUniqueOrThrow({ where: { id: o.id }, include: { attribution: true } });
    expect(stored.normalizedOrderNumber).toBe("1042");
    expect(stored.attribution?.method).toBe("UTM_CONTENT");
    expect(stored.attribution?.creativeId).not.toBeNull();
    expect(stored.phoneHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(stored)).not.toContain("0555");
    await t.caller.orders.delete({ id: o.id });
    const log = await t.caller.audit.list({ limit: 10 });
    expect(log.items.some((e) => e.action === "order.deleted" && e.entityId === o.id)).toBe(true);
  });
});
