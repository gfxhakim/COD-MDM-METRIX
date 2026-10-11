import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { addMember, cost, makeTenant } from "../helpers";

type Tenant = Awaited<ReturnType<typeof makeTenant>>;

const ORDER_HEADER = "Name,Id,Created at,Lineitem sku,Lineitem quantity,Lineitem price,Total,Status,Billing Phone,Landing Site";
const orderMapping = { orderNumber: "Name", externalOrderId: "Id", placedAt: "Created at", sku: "Lineitem sku", quantity: "Lineitem quantity", unitPrice: "Lineitem price", total: "Total", status: "Status", phone: "Billing Phone", landingUrl: "Landing Site" };
const SPEND_HEADER = "Day,Campaign name,Ad set name,Ad name,Ad ID,Amount spent (USD),Impressions";
const spendMapping = { date: "Day", campaignName: "Campaign name", adsetName: "Ad set name", adName: "Ad name", adId: "Ad ID", spend: "Amount spent (USD)", impressions: "Impressions" };
const csv = (kind: "ORDERS" | "AD_SPEND", csvText: string) =>
  kind === "ORDERS"
    ? { kind, fileName: "orders.csv", csvText, fileSize: csvText.length, mapping: orderMapping, options: { dateFormat: "AUTO" as const, source: "SHOPIFY" as const } }
    : { kind, fileName: "meta.csv", csvText, fileSize: csvText.length, mapping: spendMapping, options: { dateFormat: "AUTO" as const, fxRate: 250 } };
const at = (d: string) => new Date(`${d}T12:00:00Z`);

/** One business with some of every kind: imported files, MDM, Meta, typed expenses and products. */
async function seed(t: Tenant) {
  const w = t.ws.id;
  await t.caller.products.create({ name: "Lamp", sku: "LMP", cost });
  await t.caller.imports.commit(csv("ORDERS", `${ORDER_HEADER}\n#1,11,2026-09-01 10:00,LMP,1,3900,3900,confirmed,,\n#2,12,2026-09-02 10:00,LMP,1,3900,3900,confirmed,,`));
  await t.caller.imports.commit(csv("AD_SPEND", `${SPEND_HEADER}\n2026-09-01,Camp,Set,Ad A,901,10,100\n2026-09-01,Camp,Set,Ad B,902,5,50`));

  // MDM: one order only MDM knows, and the imported #1 that MDM filled in.
  const mdmOrder = await db.order.create({ data: { workspaceId: w, source: "MDM_EXPRESS", externalOrderId: "M-1", orderNumber: "M-1", normalizedOrderNumber: "M1", mdmOrderId: "M-1", placedAt: at("2026-09-03"), codAmount: 390000 } });
  const imported = await db.order.findFirstOrThrow({ where: { workspaceId: w, orderNumber: "#1" } });
  await db.order.update({ where: { id: imported.id }, data: { mdmOrderId: "M-0", mdmStatus: "delivered", storeName: "Store", deliveryType: "HOME" } });
  await db.parcel.create({ data: { workspaceId: w, orderId: mdmOrder.id, provider: "MDM_EXPRESS", trackingId: `T-1-${w}`, normalizedStatus: "DELIVERED", codAmount: 390000 } });
  await db.parcel.create({ data: { workspaceId: w, orderId: imported.id, provider: "MDM_EXPRESS", trackingId: `T-0-${w}`, normalizedStatus: "DELIVERED", codAmount: 390000 } });
  await db.mdmAccount.create({ data: { workspaceId: w, sellerId: "seller" } });
  await db.syncJob.create({ data: { workspaceId: w, provider: "MDM_EXPRESS", status: "SUCCEEDED" } });
  const conn = { encryptedCredential: "v1:test", keyVersion: 1, maskedLabel: "••••0000", status: "CONNECTED" as const, lastSuccessfulSyncAt: new Date(), ordersSyncedAt: new Date() };
  await db.integrationConnection.upsert({ where: { workspaceId_provider: { workspaceId: w, provider: "MDM_EXPRESS" } }, create: { workspaceId: w, provider: "MDM_EXPRESS", ...conn }, update: conn });

  // Meta: a token, and an API row that replaced the imported row of ad 901.
  await db.metaToken.create({ data: { workspaceId: w, label: "BM", encryptedCredential: "x", keyVersion: 1, maskedLabel: "••••0000" } });
  await db.adSpend.updateMany({ where: { workspaceId: w, adId: "901" }, data: { supersededAt: new Date() } });
  await db.adSpend.create({ data: { workspaceId: w, source: "META_API", date: new Date("2026-09-01T00:00:00Z"), adId: "901", spend: 2600, sourceRowHash: "api-901" } });

  // Typed in: an expense in an own category, and a repeating one.
  const tools = await t.caller.expenses.createCategory({ name: "Tools" });
  await t.caller.expenses.create({ date: at("2026-09-05"), category: "SOFTWARE", customCategoryId: tools.id, amount: 1000, description: "Canva", allocation: "GLOBAL", costType: "FIXED" });
  await t.caller.expenses.createRecurring({ name: "Agent", category: "SALARIES", amount: 100000, frequency: "DAILY", startDate: at("2026-09-01"), allocation: "GLOBAL", costType: "FIXED" });
}

/** Row counts that show whether anything of a business was touched. */
const counts = async (w: string) => ({
  orders: await db.order.count({ where: { workspaceId: w } }),
  parcels: await db.parcel.count({ where: { workspaceId: w } }),
  adSpend: await db.adSpend.count({ where: { workspaceId: w } }),
  files: await db.importBatch.count({ where: { workspaceId: w } }),
  expenses: await db.expense.count({ where: { workspaceId: w } }),
  recurring: await db.recurringExpense.count({ where: { workspaceId: w } }),
  products: await db.product.count({ where: { workspaceId: w } }),
  syncs: await db.syncJob.count({ where: { workspaceId: w } }),
  tokens: await db.metaToken.count({ where: { workspaceId: w } }),
});

let a: Tenant;
let b: Tenant;
let bBefore: Awaited<ReturnType<typeof counts>>;

beforeAll(async () => {
  a = await makeTenant("DeleteA");
  b = await makeTenant("DeleteB");
  await seed(a);
  await seed(b);
  bBefore = await counts(b.ws.id);
});

describe("Settings > Your data", () => {
  it("counts each kind of data", async () => {
    const s = await a.caller.data.summary();
    expect(s.mdm).toMatchObject({ orders: 1, parcels: 2, syncs: 1, money: true, keySaved: true, busy: false });
    expect(s.meta).toMatchObject({ spendRows: 1, ads: 1, from: "2026-09-01", to: "2026-09-01", tokens: 1, busy: false });
    expect(s.imports).toMatchObject({ files: 2, orders: 2, adSpend: 2 });
    expect(s.expenses).toEqual({ expenses: 1, recurring: 1, categories: 1 });
    expect(s.products.products).toBe(1);
  });

  it("is for the owner only, and needs DELETE typed", async () => {
    for (const role of ["ADMIN", "ANALYST", "OPERATOR"] as const) {
      const m = await addMember(a.ws.id, role);
      await expect(m.caller.data.summary()).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(m.caller.data.delete({ target: "everything", stopSyncs: false, confirm: "DELETE" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(a.caller.data.delete({ target: "imports", stopSyncs: false, confirm: "delete" as "DELETE" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await db.importBatch.count({ where: { workspaceId: a.ws.id } })).toBe(2);
  });

  it("waits while an MDM sync runs", async () => {
    const job = await db.syncJob.create({ data: { workspaceId: a.ws.id, provider: "MDM_EXPRESS", status: "RUNNING", activeLock: `test-${a.ws.id}` } });
    expect((await a.caller.data.summary()).mdm.busy).toBe(true);
    await expect(a.caller.data.delete({ target: "mdm", stopSyncs: false, confirm: "DELETE" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("MDM sync is running") });
    await expect(a.caller.data.delete({ target: "everything", stopSyncs: false, confirm: "DELETE" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await db.syncJob.delete({ where: { id: job.id } });
  });

  it("deletes Meta spend and counts the imported rows it had replaced again", async () => {
    const r = await a.caller.data.delete({ target: "meta", stopSyncs: false, confirm: "DELETE" });
    expect(r).toEqual({ metaSpendRows: 1 });
    const rows = await db.adSpend.findMany({ where: { workspaceId: a.ws.id }, select: { source: true, supersededAt: true } });
    expect(rows).toHaveLength(2);
    expect(rows.every((x) => x.source !== "META_API" && x.supersededAt === null)).toBe(true);
    expect(await db.metaToken.count({ where: { workspaceId: a.ws.id } })).toBe(1);
  });

  it("deletes what MDM brought, keeps the key and the imported orders", async () => {
    const r = await a.caller.data.delete({ target: "mdm", stopSyncs: false, confirm: "DELETE" });
    expect(r).toEqual({ mdmOrders: 1, mdmParcels: 2 });
    const left = await db.order.findMany({ where: { workspaceId: a.ws.id }, select: { orderNumber: true, mdmOrderId: true, mdmStatus: true, storeName: true, deliveryType: true }, orderBy: { orderNumber: "asc" } });
    expect(left).toEqual([
      { orderNumber: "#1", mdmOrderId: null, mdmStatus: null, storeName: null, deliveryType: null },
      { orderNumber: "#2", mdmOrderId: null, mdmStatus: null, storeName: null, deliveryType: null },
    ]);
    expect(await db.mdmAccount.count({ where: { workspaceId: a.ws.id } })).toBe(0);
    expect(await db.syncJob.count({ where: { workspaceId: a.ws.id } })).toBe(0);
    const conn = await db.integrationConnection.findUniqueOrThrow({ where: { workspaceId_provider: { workspaceId: a.ws.id, provider: "MDM_EXPRESS" } } });
    // The key stays; the next sync reads everything MDM still has again.
    expect(conn).toMatchObject({ encryptedCredential: "v1:test", status: "CONNECTED", lastSuccessfulSyncAt: null, ordersSyncedAt: null });
  });

  it("deletes typed expenses, repeating ones and unused own categories", async () => {
    expect(await a.caller.data.delete({ target: "expenses", stopSyncs: false, confirm: "DELETE" })).toEqual({ expenses: 1, repeatingExpenses: 1 });
    expect(await a.caller.data.summary()).toMatchObject({ expenses: { expenses: 0, recurring: 0, categories: 0 } });
  });

  it("deletes every imported file with what it added", async () => {
    const r = await a.caller.data.delete({ target: "imports", stopSyncs: false, confirm: "DELETE" });
    expect(r).toMatchObject({ files: 2, importedOrders: 2, importedAdSpend: 2 });
    expect(await counts(a.ws.id)).toMatchObject({ orders: 0, adSpend: 0, files: 0 });
  });

  it("deletes products and costs, and has the next MDM sync bring MDM's products back", async () => {
    const mdm = { workspaceId_provider: { workspaceId: a.ws.id, provider: "MDM_EXPRESS" as const } };
    await db.integrationConnection.update({ where: mdm, data: { ordersSyncedAt: new Date(Date.now() - 60_000) } });
    expect(await a.caller.data.delete({ target: "products", stopSyncs: false, confirm: "DELETE" })).toEqual({ products: 1 });
    expect(await db.productCostVersion.count({ where: { workspaceId: a.ws.id } })).toBe(0);
    const conn = await db.integrationConnection.findUniqueOrThrow({ where: mdm });
    expect(conn.choicesWidenedAt!.getTime()).toBeGreaterThan(conn.ordersSyncedAt!.getTime());
  });

  it("deletes everything and, when asked, the MDM key and Meta tokens", async () => {
    const c = await makeTenant("DeleteC");
    await seed(c);
    await c.caller.data.delete({ target: "everything", stopSyncs: true, confirm: "DELETE" });
    expect(await counts(c.ws.id)).toEqual({ orders: 0, parcels: 0, adSpend: 0, files: 0, expenses: 0, recurring: 0, products: 0, syncs: 0, tokens: 0 });
    expect(await db.creative.count({ where: { workspaceId: c.ws.id } })).toBe(0);
    const conn = await db.integrationConnection.findUniqueOrThrow({ where: { workspaceId_provider: { workspaceId: c.ws.id, provider: "MDM_EXPRESS" } } });
    expect(conn).toMatchObject({ encryptedCredential: null, maskedLabel: null, status: "NOT_CONFIGURED" });
    // Members, the workspace and the audit log stay.
    expect(await db.workspaceMember.count({ where: { workspaceId: c.ws.id } })).toBe(1);
    const log = await db.auditLog.findFirstOrThrow({ where: { workspaceId: c.ws.id, action: "data.deleted" } });
    expect(log.metadata).toMatchObject({ target: "everything", stopSyncs: true });
  });

  it("never touches another business", async () => {
    expect(await counts(b.ws.id)).toEqual(bBefore);
  });
});
