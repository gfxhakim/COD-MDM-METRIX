import { beforeAll, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { db } from "@/server/db";
import { addMember, callerFor, cost, makeTenant } from "../helpers";

type Tenant = Awaited<ReturnType<typeof makeTenant>>;

const ORDER_HEADER = "Name,Id,Created at,Lineitem sku,Lineitem quantity,Lineitem price,Total,Status,Billing Phone,Landing Site";
const orderMapping = { orderNumber: "Name", externalOrderId: "Id", placedAt: "Created at", sku: "Lineitem sku", quantity: "Lineitem quantity", unitPrice: "Lineitem price", total: "Total", status: "Status", phone: "Billing Phone", landingUrl: "Landing Site" };
const orders = (csvText: string, source: "SHOPIFY" | "EASYSELL" = "SHOPIFY") => ({ kind: "ORDERS" as const, fileName: "orders.csv", csvText, fileSize: csvText.length, mapping: orderMapping, options: { dateFormat: "AUTO" as const, source } });

const SPEND_HEADER = "Day,Campaign name,Ad set name,Ad name,Ad ID,Amount spent (USD),Impressions";
const spendMapping = { date: "Day", campaignName: "Campaign name", adsetName: "Ad set name", adName: "Ad name", adId: "Ad ID", spend: "Amount spent (USD)", impressions: "Impressions" };
const spend = (csvText: string, options: Record<string, unknown> = {}) => ({ kind: "AD_SPEND" as const, fileName: "meta.csv", csvText, fileSize: csvText.length, mapping: spendMapping, options: { dateFormat: "AUTO" as const, fxRate: 250, ...options } });

let a: Tenant;
let b: Tenant;
let productId: string;

beforeAll(async () => {
  a = await makeTenant("ImportA");
  b = await makeTenant("ImportB");
  productId = (await a.caller.products.create({ name: "Posture", sku: "PC-01", cost })).id;
  await a.caller.products.create({ name: "Blender", sku: "MB-02", cost: { ...cost, salePrice: 450000 } });
});

describe("order import", () => {
  const file = [
    ORDER_HEADER,
    "#1001,555,2026-04-01 10:00,PC-01,2,3900,12300,confirmed,0551234567,/p?utm_content=cr_late",
    "#1001,,2026-04-01 10:00,MB-02,1,4500,,,,",
    "#1002,556,2026-04-02 11:00,PC-01,1,3900,3900,pending,0661234567,",
    "#1003,557,not-a-date,PC-01,1,3900,3900,pending,,",
  ].join("\n");

  it("previews with counts and does not write anything", async () => {
    const p = await a.caller.imports.preview(orders(file));
    expect(p.counts).toMatchObject({ valid: 2, new: 2, duplicate: 0, errorRows: 1 });
    expect(p.preview[0]).toMatchObject({ orderNumber: "#1001", codAmount: 1230000, state: "NEW", phone: expect.stringMatching(/•/) });
    expect(p.issues[0]).toMatchObject({ line: 5, field: "placedAt" });
    expect(await db.order.count({ where: { workspaceId: a.ws.id } })).toBe(0);
  });

  it("imports multi-line orders, hashes phones and reports duplicates on re-import", async () => {
    const first = await a.caller.imports.commit(orders(file));
    expect(first).toMatchObject({ status: "PARTIAL", importedRows: 2, duplicateRows: 0, errorRows: 1, totalRows: 4 });
    const o = await db.order.findFirstOrThrow({ where: { workspaceId: a.ws.id, orderNumber: "#1001" }, include: { lines: true, attribution: true } });
    expect(o.lines).toHaveLength(2);
    expect(o.phoneHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(o)).not.toContain("0551234567");
    expect(o.attribution).toMatchObject({ normalizedCreativeKey: "cr_late", creativeId: null, method: "NONE" });

    const again = await a.caller.imports.commit(orders(file));
    expect(again).toMatchObject({ importedRows: 0, duplicateRows: 2, errorRows: 1 });
    expect(await db.order.count({ where: { workspaceId: a.ws.id } })).toBe(2);
    // Same order number from another source is a different order.
    const es = await a.caller.imports.commit(orders(`${ORDER_HEADER}\n#1001,555,2026-04-01,PC-01,1,3900,3900,,,`, "EASYSELL"));
    expect(es.importedRows).toBe(1);
  });

  it("stores reviewable errors without raw phone numbers and exports a sanitized error CSV", async () => {
    const bad = `${ORDER_HEADER}\n=HYPERLINK(\"x\"),9,nope,PC-01,1,1,1,,0771234567,`;
    const batch = await a.caller.imports.commit(orders(bad));
    expect(batch.status).toBe("FAILED");
    const detail = await a.caller.imports.get({ id: batch.id });
    expect(JSON.stringify(detail.errors)).not.toContain("0771234567");
    const { content, filename } = await a.caller.imports.errorCsv({ id: batch.id });
    expect(filename).toBe("orders-errors.csv");
    expect(content).toContain("Invalid date");
    expect(content).toContain("'=HYPERLINK");
  });
});

describe("spend import and attribution normalization", () => {
  const file = [SPEND_HEADER, "2026-04-01,C1,AS1,Hook,cr_late,10,1000", "2026-04-01,C1,AS1,Mystery,cr_mystery,4,400", "2026-04-02,C1,AS1,Hook,cr_late,0,0"].join("\n");

  it("creates creatives, converts currency and relinks orders that arrived first", async () => {
    const batch = await a.caller.imports.commit(spend(file, { productId }));
    expect(batch).toMatchObject({ status: "COMMITTED", importedRows: 2 });
    expect((batch.summary as { createdCreatives: number; relinked: { attributions: number } }).createdCreatives).toBe(2);
    expect((batch.summary as { relinked: { attributions: number } }).relinked.attributions).toBe(1);
    const row = await db.adSpend.findFirstOrThrow({ where: { workspaceId: a.ws.id, externalCreativeId: "cr_late" }, include: { creative: true } });
    expect(row).toMatchObject({ spend: 250000, originalSpend: 1000, originalCurrency: "USD", fxRate: 250 });
    expect(row.creative?.productId).toBe(productId);
    const attr = await db.attribution.findFirstOrThrow({ where: { workspaceId: a.ws.id, normalizedCreativeKey: "cr_late" } });
    expect(attr).toMatchObject({ creativeId: row.creativeId, method: "UTM_CONTENT" });
  });

  it("updates amounts on re-export instead of double counting", async () => {
    const newer = [SPEND_HEADER, "2026-04-01,C1,AS1,Hook,cr_late,12,1200", "2026-04-01,C1,AS1,Mystery,cr_mystery,4,400"].join("\n");
    const p = await a.caller.imports.preview(spend(newer));
    expect(p.counts).toMatchObject({ new: 0, update: 1, duplicate: 1 });
    const batch = await a.caller.imports.commit(spend(newer));
    expect(batch).toMatchObject({ importedRows: 0, updatedRows: 1, duplicateRows: 1 });
    const total = await db.adSpend.aggregate({ where: { workspaceId: a.ws.id }, _sum: { spend: true } });
    expect(total._sum.spend).toBe(300000 + 100000);
  });

  it("keeps unknown creatives as unmatched spend and resolves them later", async () => {
    const file2 = `${SPEND_HEADER}\n2026-04-03,C2,AS2,New,cr_new,2,100\n2026-04-03,C2,AS2,,,1,50`;
    const p = await a.caller.imports.preview(spend(file2, { createCreatives: false }));
    expect(p.unmatchedCreatives).toEqual(["cr_new"]);
    await a.caller.imports.commit(spend(file2, { createCreatives: false }));
    const unmatched = await a.caller.spendReview.unmatched();
    expect(unmatched.map((u) => [u.externalCreativeId, u.spend]).sort()).toEqual([["cr_new", 50000], [null, 25000]].sort());
    const r = await a.caller.spendReview.resolve({ externalCreativeId: "cr_new", create: { name: "New hook", productId } });
    expect(r.rows).toBe(1);
    expect((await a.caller.spendReview.unmatched()).map((u) => u.externalCreativeId)).toEqual([null]);
    await expect(b.caller.spendReview.resolve({ externalCreativeId: "cr_new", creativeId: r.creativeId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("requires an exchange rate for foreign-currency spend", async () => {
    const p = await a.caller.imports.preview(spend(file, { fxRate: null }));
    expect(p.counts.valid).toBe(0);
    expect(p.issues[0].field).toBe("currency");
  });
});

describe("expense and bank imports", () => {
  const exp = (csvText: string) => ({ kind: "EXPENSES" as const, fileName: "expenses.csv", csvText, fileSize: csvText.length, mapping: { date: "date", category: "category", amount: "amount", productSku: "sku" }, options: { dateFormat: "AUTO" as const } });
  const bank = (csvText: string) => ({ kind: "BANK" as const, fileName: "bank.csv", csvText, fileSize: csvText.length, mapping: { date: "date", description: "label", amount: "amount" }, options: { dateFormat: "AUTO" as const } });

  it("dedupes expense rows by content but keeps genuine repeats within a file", async () => {
    const f = "date,category,amount,sku\n2026-04-01,Software,3000,\n2026-04-01,Software,3000,\n2026-04-02,Packaging,500,PC-01";
    expect((await a.caller.imports.commit(exp(f))).importedRows).toBe(3);
    expect(await a.caller.imports.commit(exp(f))).toMatchObject({ importedRows: 0, duplicateRows: 3 });
    const pkg = await db.expense.findFirstOrThrow({ where: { workspaceId: a.ws.id, category: "PACKAGING" } });
    expect(pkg).toMatchObject({ allocation: "PRODUCT", productId, amount: 50000 });
  });

  it("queues bank rows as pending until categorized or excluded", async () => {
    const f = "date,label,amount\n2026-04-01,FB ADS,-12000\n2026-04-02,MDM REMIT,85000\n2026-04-03,Canva,-1500";
    await a.caller.imports.commit(bank(f));
    const before = await db.expense.count({ where: { workspaceId: a.ws.id } });
    const list = await a.caller.bank.list({ status: "PENDING", limit: 50 });
    expect(list.items).toHaveLength(3);
    const debit = list.items.find((r) => r.description === "Canva")!;
    const credit = list.items.find((r) => r.description === "MDM REMIT")!;
    await expect(a.caller.bank.categorize({ id: credit.id, category: "OTHER", allocation: "GLOBAL", costType: "FIXED" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const e = await a.caller.bank.categorize({ id: debit.id, category: "SOFTWARE", allocation: "GLOBAL", costType: "FIXED" });
    expect(e.amount).toBe(150000);
    await a.caller.bank.exclude({ ids: [credit.id] });
    expect(await db.expense.count({ where: { workspaceId: a.ws.id } })).toBe(before + 1);
    await a.caller.bank.reopen({ id: debit.id });
    expect(await db.expense.count({ where: { workspaceId: a.ws.id } })).toBe(before);
    expect((await a.caller.bank.list({ limit: 50 })).counts).toMatchObject({ PENDING: { count: 2 }, EXCLUDED: { count: 1 } });
  });

  it("deleting a batch removes what it created, including expenses made from its bank rows", async () => {
    const f = "date,label,amount\n2026-05-01,Office rent,-40000";
    const batch = await a.caller.imports.commit(bank(f));
    const row = (await a.caller.bank.list({ status: "PENDING", limit: 50 })).items.find((r) => r.description === "Office rent")!;
    await a.caller.bank.categorize({ id: row.id, category: "OFFICE", allocation: "GLOBAL", costType: "FIXED" });
    const removed = await a.caller.imports.delete({ id: batch.id });
    expect(removed).toEqual({ orders: 0, adSpend: 0, expenses: 1, bankTransactions: 1 });
    const log = await db.auditLog.findFirst({ where: { workspaceId: a.ws.id, action: "import.deleted", entityId: batch.id } });
    expect(log).not.toBeNull();
  });
});

describe("import security", () => {
  it("isolates batches between workspaces and enforces roles", async () => {
    const mine = await a.caller.imports.list({ limit: 100 });
    expect(mine.length).toBeGreaterThan(0);
    expect(await b.caller.imports.list({ limit: 100 })).toEqual([]);
    await expect(b.caller.imports.get({ id: mine[0].id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(b.caller.imports.errorCsv({ id: mine[0].id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(b.caller.imports.delete({ id: mine[0].id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const analyst = await addMember(a.ws.id, "ANALYST");
    await expect(analyst.caller.imports.commit(orders(`${ORDER_HEADER}\nX,1,2026-04-01,PC-01,1,1,1,,,`))).rejects.toMatchObject({ code: "FORBIDDEN" });
    const operator = await addMember(a.ws.id, "OPERATOR");
    await expect(operator.caller.bank.exclude({ ids: [mine[0].id] })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects non-CSV names, unmapped columns and missing required fields", async () => {
    await expect(a.caller.imports.preview({ ...orders(`${ORDER_HEADER}\n`), fileName: "orders.xlsx" })).rejects.toBeInstanceOf(TRPCError);
    await expect(a.caller.imports.preview({ ...orders(`${ORDER_HEADER}\nX,1,2026-04-01,PC-01,1,1,1,,,`), mapping: { ...orderMapping, orderNumber: "Nope" } })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("not in the file") });
    await expect(a.caller.imports.preview({ ...orders(`${ORDER_HEADER}\nX,1,2026-04-01,PC-01,1,1,1,,,`), mapping: { placedAt: "Created at" } })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("Order number") });
    void callerFor;
  });
});
