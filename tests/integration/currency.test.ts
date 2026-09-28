import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { addMember, cost, makeTenant } from "../helpers";

type Tenant = Awaited<ReturnType<typeof makeTenant>>;
let t: Tenant;

beforeAll(async () => {
  t = await makeTenant("Currencies");
});

describe("exchange rates in Settings", () => {
  it("are saved by owners and admins only, without a rate for the workspace's own currency", async () => {
    await t.caller.workspace.updateSettings({ exchangeRates: { USD: 250, EUR: 270, DZD: 1 } });
    expect((await t.caller.workspace.getCurrent()).exchangeRates).toEqual({ USD: 250, EUR: 270 });

    const analyst = await addMember(t.ws.id, "ANALYST");
    await expect(analyst.caller.workspace.updateSettings({ exchangeRates: { USD: 1 } })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(t.caller.workspace.updateSettings({ exchangeRates: { USD: -3 } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(t.caller.workspace.updateSettings({ exchangeRates: { XYZ: 3 } as never })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await t.caller.workspace.getCurrent()).exchangeRates).toEqual({ USD: 250, EUR: 270 });
  });
});

describe("product sourcing cost in another currency", () => {
  it("converts with the Settings rate and keeps what was entered", async () => {
    // 5.00 USD at 250 = 1 250.00 DZD. The sale price and fees stay in DZD.
    const p = await t.caller.products.create({ name: "Lamp", sku: "LMP-USD", cost: { ...cost, sourcingCost: 500, sourcingCurrency: "USD" } });
    const v = await db.productCostVersion.findFirstOrThrow({ where: { productId: p.id } });
    expect(v).toMatchObject({ salePrice: cost.salePrice, sourcingCost: 125000, sourcingCostOriginal: 500, sourcingCurrency: "USD", sourcingFxRate: 250, currency: "DZD" });
    const listed = (await t.caller.products.list()).find((x) => x.id === p.id)!;
    expect(listed.currentCost).toMatchObject({ sourcingCost: 125000, sourcingCostOriginal: 500, sourcingCurrency: "USD" });
  });

  it("uses the rate sent with the form, and a later Settings change never rewrites it", async () => {
    const p = await t.caller.products.create({ name: "Fan", sku: "FAN-1", cost });
    const v = await t.caller.products.createCostVersion({ productId: p.id, effectiveFrom: new Date("2026-09-01T00:00:00Z"), cost: { ...cost, sourcingCost: 3000, sourcingCurrency: "EUR", sourcingFxRate: 265.5 } });
    expect(v).toMatchObject({ sourcingCost: 796500, sourcingCostOriginal: 3000, sourcingCurrency: "EUR", sourcingFxRate: 265.5 });
    await t.caller.workspace.updateSettings({ exchangeRates: { USD: 300, EUR: 300 } });
    expect(await db.productCostVersion.findUniqueOrThrow({ where: { id: v.id } })).toMatchObject({ sourcingCost: 796500, sourcingFxRate: 265.5 });
    // The first version, in DZD, has no original.
    const first = await db.productCostVersion.findFirstOrThrow({ where: { productId: p.id, effectiveTo: { not: null } } });
    expect(first).toMatchObject({ sourcingCost: cost.sourcingCost, sourcingCostOriginal: null, sourcingCurrency: null });
  });

  it("asks for a rate when neither the form nor Settings has one", async () => {
    await expect(t.caller.products.create({ name: "Mug", sku: "MUG-1", cost: { ...cost, sourcingCurrency: "CNY" } })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("one CNY costs"),
    });
    expect(await db.product.count({ where: { workspaceId: t.ws.id, sku: "MUG-1" } })).toBe(0);
  });
});

describe("expenses in another currency", () => {
  it("stores the converted amount for reports and the original for display, and edits back to DZD", async () => {
    const e = await t.caller.expenses.create({ date: new Date("2026-09-10T12:00:00Z"), category: "SOFTWARE", amount: 2900, currency: "USD", allocation: "GLOBAL", costType: "FIXED", description: "Shopify" });
    // 29.00 USD at the current Settings rate of 300.
    expect(e).toMatchObject({ amount: 870000, currency: "DZD", originalAmount: 2900, originalCurrency: "USD", fxRate: 300 });
    expect((await t.caller.expenses.summary({})).total).toBe(870000);

    const edited = await t.caller.expenses.update({ id: e.id, data: { date: e.date, category: "SOFTWARE", amount: 500000, allocation: "GLOBAL", costType: "FIXED" } });
    expect(edited).toMatchObject({ amount: 500000, originalAmount: null, originalCurrency: null, fxRate: null });
    const log = await db.auditLog.findFirstOrThrow({ where: { workspaceId: t.ws.id, action: "expense.updated" } });
    expect(log.metadata).toMatchObject({ from: { originalCurrency: "USD" }, to: { originalCurrency: null } });
  });

  it("converts expense CSV rows with the Settings rate and rejects currencies without one", async () => {
    const csvText = "date,category,amount,currency\n2026-09-11,Software,20,USD\n2026-09-12,AI tools,15,GBP\n2026-09-13,Office,4000,DZD";
    const req = { kind: "EXPENSES" as const, fileName: "expenses.csv", csvText, fileSize: csvText.length, mapping: { date: "date", category: "category", amount: "amount", currency: "currency" }, options: { dateFormat: "AUTO" as const } };
    const p = await t.caller.imports.preview(req);
    expect(p.issues).toHaveLength(1);
    expect(p.issues[0]).toMatchObject({ line: 3, field: "currency" });
    expect(p.issues[0].message).toContain("GBP exchange rate");
    expect(await t.caller.imports.commit(req)).toMatchObject({ importedRows: 2, errorRows: 1 });
    const usd = await db.expense.findFirstOrThrow({ where: { workspaceId: t.ws.id, originalCurrency: "USD", originalAmount: 2000 } });
    expect(usd).toMatchObject({ amount: 600000, originalAmount: 2000, fxRate: 300 });

    // A new rate doesn't make the same file look new.
    await t.caller.workspace.updateSettings({ exchangeRates: { USD: 310 } });
    expect(await t.caller.imports.commit(req)).toMatchObject({ importedRows: 0, duplicateRows: 2 });
  });
});

describe("report currency", () => {
  let r: Tenant;
  beforeAll(async () => {
    r = await makeTenant("Report currency");
  });

  it("shows reports in another currency only once it has a rate, and never touches stored amounts", async () => {
    expect(await r.caller.workspace.getCurrent()).toMatchObject({ currency: "DZD", reportCurrency: "DZD" });
    await expect(r.caller.workspace.updateSettings({ reportCurrency: "USD" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("Add a USD rate") });

    const e = await r.caller.expenses.create({ date: new Date("2026-09-10T12:00:00Z"), category: "SOFTWARE", amount: 290000, currency: "DZD", allocation: "GLOBAL", costType: "FIXED", description: "Rent" });
    await r.caller.workspace.updateSettings({ exchangeRates: { USD: 250 } });
    await r.caller.workspace.updateSettings({ reportCurrency: "USD" });
    expect(await r.caller.workspace.getCurrent()).toMatchObject({ currency: "DZD", reportCurrency: "USD" });
    expect(await db.expense.findUniqueOrThrow({ where: { id: e.id } })).toMatchObject({ amount: 290000, currency: "DZD" });

    // Its rate can't be removed while reports use it.
    await expect(r.caller.workspace.updateSettings({ exchangeRates: {} })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("Reports are shown in USD") });
    expect((await r.caller.workspace.getCurrent()).exchangeRates).toEqual({ USD: 250 });

    // Back to the stored currency: saved as "no report currency".
    await r.caller.workspace.updateSettings({ reportCurrency: "DZD" });
    expect(await db.workspace.findUniqueOrThrow({ where: { id: r.ws.id } })).toMatchObject({ currency: "DZD", reportCurrency: null });
    await r.caller.workspace.updateSettings({ exchangeRates: {} });
  });

  it("is changed by owners and admins only", async () => {
    await r.caller.workspace.updateSettings({ exchangeRates: { EUR: 270 } });
    const analyst = await addMember(r.ws.id, "ANALYST");
    await expect(analyst.caller.workspace.updateSettings({ reportCurrency: "EUR" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const admin = await addMember(r.ws.id, "ADMIN");
    await admin.caller.workspace.updateSettings({ reportCurrency: "EUR" });
    expect((await r.caller.workspace.getCurrent()).reportCurrency).toBe("EUR");
  });
});
