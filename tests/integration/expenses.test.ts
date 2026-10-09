import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { addMember, cost, makeTenant } from "../helpers";

type Tenant = Awaited<ReturnType<typeof makeTenant>>;
const DAY = 86_400_000;
/** Days counted from today in UTC, which is where repeating expenses stop counting. */
const dayAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);
const noon = (d: string) => new Date(`${d}T12:00:00Z`);

describe("expenses: own categories, repeating expenses, filters and export", () => {
  let t: Tenant;
  let productId: string;
  let toolsId: string;
  let salaryId: string;

  beforeAll(async () => {
    t = await makeTenant("Expenses");
    productId = (await t.caller.products.create({ name: "Lamp", sku: "LMP", cost })).id;
    await t.caller.expenses.create({ date: noon(dayAgo(2)), category: "SOFTWARE", amount: 450000, description: "Shopify plan", allocation: "GLOBAL", costType: "FIXED" });
    await t.caller.expenses.create({ date: noon(dayAgo(1)), category: "OTHER", amount: 30000, description: "Coffee", allocation: "GLOBAL", costType: "VARIABLE" });
  });

  it("makes the business's own categories, once per name", async () => {
    const tools = await t.caller.expenses.createCategory({ name: "  Design   tools " });
    expect(tools.name).toBe("Design tools");
    expect((await t.caller.expenses.createCategory({ name: "design TOOLS" })).id).toBe(tools.id);
    toolsId = tools.id;
    await t.caller.expenses.create({ date: noon(dayAgo(1)), category: "SOFTWARE", customCategoryId: toolsId, amount: 120000, description: "Canva", allocation: "PRODUCT", productId, costType: "FIXED" });
    const own = await t.caller.expenses.list({ customCategoryId: toolsId });
    expect(own).toHaveLength(1);
    // Saved under the built-in "Other", but listed only under its own category.
    expect(own[0]).toMatchObject({ category: "OTHER", customCategory: { name: "Design tools" } });
    expect((await t.caller.expenses.list({ category: "OTHER" })).map((e) => e.description)).toEqual(["Coffee"]);
    expect(await t.caller.expenses.categories()).toEqual([{ id: toolsId, name: "Design tools", used: 1 }]);
  });

  it("adds a repeating expense's share of the days picked", async () => {
    // 1,000 DZD a day for the last 5 days (today included).
    const salary = await t.caller.expenses.createRecurring({ name: "Confirmation agent", category: "SALARIES", amount: 100000, frequency: "DAILY", startDate: noon(dayAgo(4)), allocation: "GLOBAL", costType: "FIXED" });
    salaryId = salary.id;
    const all = await t.caller.expenses.summary({});
    expect(all.repeating).toBe(500000);
    expect(all.total).toBe(450000 + 30000 + 120000 + 500000);
    expect(all.unallocated).toBe(450000 + 30000 + 500000);
    expect(all.repeatingPerMonth).toBe(Math.round((100000 * 365) / 12));
    expect(all.byCategory).toContainEqual({ category: "SALARIES", name: null, amount: 500000 });
    expect(all.byCategory).toContainEqual({ category: `custom:${toolsId}`, name: "Design tools", amount: 120000 });
    expect(all.byProduct).toEqual([{ productId, name: "Lamp", amount: 120000 }]);

    const two = await t.caller.expenses.summary({ from: dayAgo(4), to: dayAgo(3) });
    expect(two.total).toBe(200000);
    const rows = await t.caller.expenses.recurring({ from: dayAgo(4), to: dayAgo(3) });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Confirmation agent", inPeriod: 200000, running: true });
  });

  it("counts repeating expenses in the dashboard's costs", async () => {
    const r = await t.caller.reports.dashboard({});
    expect(r.metrics.allocatedOverhead).toBe(450000 + 30000 + 120000 + 500000);
  });

  it("filters by words, scope and type", async () => {
    expect((await t.caller.expenses.list({ search: "SHOPIFY" })).map((e) => e.description)).toEqual(["Shopify plan"]);
    expect(await t.caller.expenses.recurring({ search: "agent" })).toHaveLength(1);
    expect((await t.caller.expenses.summary({ search: "agent" })).total).toBe(500000);
    expect((await t.caller.expenses.list({ allocation: "PRODUCT" })).map((e) => e.description)).toEqual(["Canva"]);
    expect((await t.caller.expenses.summary({ costType: "VARIABLE" })).total).toBe(30000);
    expect((await t.caller.expenses.summary({ productId })).total).toBe(120000);
  });

  it("stops, edits and deletes a repeating expense", async () => {
    await t.caller.expenses.updateRecurring({ id: salaryId, data: { name: "Confirmation agent", category: "SALARIES", amount: 200000, frequency: "DAILY", startDate: noon(dayAgo(4)), allocation: "GLOBAL", costType: "FIXED" } });
    expect((await t.caller.expenses.summary({})).repeating).toBe(1000000);
    await t.caller.expenses.stopRecurring({ id: salaryId, today: dayAgo(2) });
    const [stopped] = await t.caller.expenses.recurring({});
    expect(stopped).toMatchObject({ running: false, inPeriod: 600000 });
    await expect(t.caller.expenses.updateRecurring({ id: salaryId, data: { name: "x", category: "SALARIES", amount: 1, frequency: "DAILY", startDate: noon(dayAgo(1)), endDate: noon(dayAgo(3)), allocation: "GLOBAL", costType: "FIXED" } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await db.auditLog.count({ where: { workspaceId: t.ws.id, action: { startsWith: "recurringExpense." } } })).toBe(3);
  });

  it("exports what the page shows to Excel and CSV", async () => {
    const csv = await t.caller.expenses.export({ format: "csv", csvDelimiter: ";" });
    expect(csv.filename).toBe("expenses_all-dates.csv");
    const text = Buffer.from(csv.base64, "base64").toString("utf8");
    expect(text).toContain("Shopify plan;All products;Fixed;4500");
    expect(text).toContain("Design tools;Canva;Lamp");
    expect(text).toContain("Confirmation agent;Employee pay;Every day;2000;");
    expect(text).toMatch(/\r\nTotal;12000\r\n/);
    const xlsx = await t.caller.expenses.export({ format: "xlsx", from: dayAgo(4), to: dayAgo(1) });
    expect(xlsx.filename).toBe(`expenses_${dayAgo(4)}_to_${dayAgo(1)}.xlsx`);
    expect(Buffer.from(xlsx.base64, "base64").subarray(0, 2).toString()).toBe("PK");
  });

  it("puts expenses back in Other when their category is deleted", async () => {
    await t.caller.expenses.deleteCategory({ id: toolsId });
    expect((await t.caller.expenses.list({ category: "OTHER" })).map((e) => e.description).sort()).toEqual(["Canva", "Coffee"]);
    await t.caller.expenses.deleteRecurring({ id: salaryId });
    expect((await t.caller.expenses.summary({})).repeating).toBe(0);
  });

  it("keeps analysts and other businesses out", async () => {
    const analyst = await addMember(t.ws.id, "ANALYST");
    await expect(analyst.caller.expenses.createCategory({ name: "Mine" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(analyst.caller.expenses.createRecurring({ name: "x", category: "TAXES", amount: 1, frequency: "MONTHLY", startDate: new Date(), allocation: "GLOBAL", costType: "FIXED" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const mine = await t.caller.expenses.createCategory({ name: "Private" });
    const rent = await t.caller.expenses.createRecurring({ name: "Rent", category: "OFFICE", amount: 1, frequency: "MONTHLY", startDate: new Date(), allocation: "GLOBAL", costType: "FIXED" });
    const other = await makeTenant("Expenses other");
    await expect(other.caller.expenses.create({ date: new Date(), category: "OTHER", customCategoryId: mine.id, amount: 1, allocation: "GLOBAL", costType: "FIXED" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(other.caller.expenses.stopRecurring({ id: rent.id, today: dayAgo(0) })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(other.caller.expenses.deleteCategory({ id: mine.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await other.caller.expenses.categories()).toEqual([]);
    expect(await other.caller.expenses.recurring({})).toEqual([]);
    expect((await other.caller.reports.dashboard({})).metrics.allocatedOverhead).toBe(0);
  });
});
