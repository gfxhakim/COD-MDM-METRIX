import { TRPCError } from "@trpc/server";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { listOrders } from "@/server/repositories/orders";
import { listProducts } from "@/server/repositories/products";
import { callerFor, cost, makeTenant } from "../helpers";

type Tenant = Awaited<ReturnType<typeof makeTenant>>;

async function expectCode(p: Promise<unknown>, code: TRPCError["code"]) {
  await expect(p).rejects.toMatchObject({ code });
}

describe("tenant isolation", () => {
  let a: Tenant;
  let b: Tenant;
  let bProductId: string;
  let bOrderId: string;
  let bExpenseId: string;
  let bParcelTracking: string;

  beforeAll(async () => {
    a = await makeTenant("Alpha");
    b = await makeTenant("Bravo");
    await a.caller.products.create({ name: "Alpha Lamp", sku: "A-1", cost });
    const bp = await b.caller.products.create({ name: "Bravo Serum", sku: "B-1", cost });
    bProductId = bp.id;
    const bo = await b.caller.orders.create({ orderNumber: "B-1001", placedAt: new Date(), status: "CONFIRMED", codAmount: 390000, phone: "0555000000", lines: [{ productId: bp.id, quantity: 1, unitPrice: 390000 }] });
    bOrderId = bo.id;
    const be = await b.caller.expenses.create({ date: new Date(), category: "SOFTWARE", amount: 450000, allocation: "GLOBAL", costType: "FIXED" });
    bExpenseId = be.id;
    bParcelTracking = "TRK-BRAVO-1";
    await db.parcel.create({ data: { workspaceId: b.ws.id, provider: "MDM_EXPRESS", trackingId: bParcelTracking, orderId: bo.id } });
  });

  it("lists only the caller's own products, orders and expenses", async () => {
    const products = await a.caller.products.list();
    expect(products.map((p) => p.name)).toEqual(["Alpha Lamp"]);
    const orders = await a.caller.orders.list({ page: 1, pageSize: 25 });
    expect(orders.total).toBe(0);
    expect(await a.caller.expenses.list({})).toHaveLength(0);
    const summary = await a.caller.expenses.summary({});
    expect(summary.total).toBe(0);
  });

  it("rejects a browser-supplied workspace id the user is not a member of", async () => {
    const spoofed = callerFor(a.user, b.ws.id);
    await expectCode(spoofed.products.list(), "FORBIDDEN");
    await expectCode(spoofed.orders.list({ page: 1, pageSize: 25 }), "FORBIDDEN");
    await expectCode(spoofed.workspace.getCurrent(), "FORBIDDEN");
    await expectCode(spoofed.members.list(), "FORBIDDEN");
    await expectCode(spoofed.expenses.create({ date: new Date(), category: "OTHER", amount: 100, allocation: "GLOBAL", costType: "FIXED" }), "FORBIDDEN");
  });

  it("cannot read another workspace's records by guessing ids", async () => {
    await expectCode(a.caller.products.get({ id: bProductId }), "NOT_FOUND");
    await expectCode(a.caller.orders.getDetails({ id: bOrderId }), "NOT_FOUND");
  });

  it("cannot update or delete another workspace's records", async () => {
    await expectCode(a.caller.products.update({ id: bProductId, name: "pwned" }), "NOT_FOUND");
    await expectCode(a.caller.products.createCostVersion({ productId: bProductId, effectiveFrom: new Date(Date.now() + 86400000), cost }), "NOT_FOUND");
    await expectCode(a.caller.products.delete({ id: bProductId }), "NOT_FOUND");
    await expectCode(a.caller.orders.updateStatus({ id: bOrderId, status: "CANCELED" }), "NOT_FOUND");
    await expectCode(a.caller.orders.delete({ id: bOrderId }), "NOT_FOUND");
    await expectCode(a.caller.expenses.update({ id: bExpenseId, data: { date: new Date(), category: "OTHER", amount: 1, allocation: "GLOBAL", costType: "FIXED" } }), "NOT_FOUND");
    await expectCode(a.caller.expenses.delete({ id: bExpenseId }), "NOT_FOUND");
    // Records are untouched.
    expect((await db.product.findUniqueOrThrow({ where: { id: bProductId } })).name).toBe("Bravo Serum");
    expect((await db.order.findUniqueOrThrow({ where: { id: bOrderId } })).status).toBe("CONFIRMED");
    expect(await db.expense.count({ where: { id: bExpenseId } })).toBe(1);
  });

  it("cannot link another workspace's parcel or product", async () => {
    const aProduct = (await a.caller.products.list())[0];
    const ao = await a.caller.orders.create({ orderNumber: "A-1", placedAt: new Date(), status: "PENDING", codAmount: 1000, lines: [{ productId: aProduct.id, quantity: 1, unitPrice: 1000 }] });
    await expectCode(a.caller.orders.manualMatchParcel({ orderId: ao.id, trackingId: bParcelTracking }), "NOT_FOUND");
    await expectCode(a.caller.orders.create({ orderNumber: "A-2", placedAt: new Date(), status: "PENDING", codAmount: 1000, lines: [{ productId: bProductId, quantity: 1, unitPrice: 1000 }] }), "NOT_FOUND");
    await expectCode(a.caller.expenses.create({ date: new Date(), category: "PACKAGING", amount: 100, allocation: "PRODUCT", productId: bProductId, costType: "VARIABLE" }), "NOT_FOUND");
    expect((await db.parcel.findFirstOrThrow({ where: { trackingId: bParcelTracking } })).orderId).toBe(bOrderId);
  });

  it("cannot manage another workspace's members", async () => {
    const bMembers = await b.caller.members.list();
    await expectCode(a.caller.members.changeRole({ memberId: bMembers[0].id, role: "ANALYST" }), "NOT_FOUND");
    await expectCode(a.caller.members.remove({ memberId: bMembers[0].id }), "NOT_FOUND");
  });

  it("does not leak audit entries across workspaces", async () => {
    const log = await a.caller.audit.list({ limit: 100 });
    expect(log.items.every((e) => e.workspaceId === a.ws.id)).toBe(true);
    expect(log.items.some((e) => e.entityId === bProductId)).toBe(false);
  });

  it("repository methods are scoped by the workspace context", async () => {
    expect((await listProducts(a.ctx, { includeInactive: true })).some((p) => p.id === bProductId)).toBe(false);
    expect((await listOrders(a.ctx, { page: 1, pageSize: 100 })).items.some((o) => o.id === bOrderId)).toBe(false);
  });

  it("never returns the phone hash to the browser", async () => {
    const details = await b.caller.orders.getDetails({ id: bOrderId });
    expect(details).not.toHaveProperty("phoneHash");
    expect(details.phoneMasked).toBe("•••• 000");
  });

  it("requires authentication", async () => {
    const anon = (await import("@/server/trpc/root")).createCaller({ user: null, requestedWorkspaceId: null });
    await expectCode(anon.products.list(), "UNAUTHORIZED");
  });
});
