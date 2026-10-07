import type { CostType, ExpenseAllocation, ExpenseCategory, ExpenseFrequency, Prisma } from "@prisma/client";
import { isRunning, monthlyEquivalent, recurringByMonth, recurringShare } from "@/domain/recurring";
import { dayRange } from "@/lib/zonedDays";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { InputError } from "@/server/errors";
import { toWorkspaceCurrency } from "@/server/fx";
import { assertCan, NotFoundError, type WorkspaceContext } from "@/server/tenancy";

export type ExpenseInput = {
  date: Date;
  category: ExpenseCategory;
  /** A category the business made. The built-in category is then OTHER. */
  customCategoryId?: string | null;
  amount: number;
  description?: string;
  allocation: ExpenseAllocation;
  productId?: string | null;
  costType: CostType;
  /** Currency `amount` was entered in. Defaults to the workspace currency. */
  currency?: string;
  /** Workspace currency per 1 unit of `currency`. Falls back to the rate in Settings. */
  fxRate?: number | null;
};

/** Expense columns for the form's input: `amount` in the workspace currency, the original kept alongside. */
async function expenseColumns(ctx: WorkspaceContext, input: ExpenseInput) {
  const { currency, fxRate, ...rest } = input;
  const money = await toWorkspaceCurrency(ctx, rest.amount, currency, fxRate);
  return {
    ...rest,
    amount: money.amount,
    currency: ctx.currency,
    originalAmount: money.original?.amount ?? null,
    originalCurrency: money.original?.currency ?? null,
    fxRate: money.original?.rate ?? null,
    productId: input.allocation === "PRODUCT" ? input.productId : null,
    category: input.customCategoryId ? ("OTHER" as const) : input.category,
    customCategoryId: input.customCategoryId ?? null,
  };
}

export type ExpenseListInput = {
  category?: ExpenseCategory;
  customCategoryId?: string;
  allocation?: ExpenseAllocation;
  productId?: string;
  costType?: CostType;
  /** Words in the description (or a repeating expense's name). */
  search?: string;
  /** Days (YYYY-MM-DD) in the workspace's time zone, both included. */
  from?: string;
  to?: string;
};

/** Filters shared by one-off and repeating expenses (they have the same category and scope columns). */
function scope(input: ExpenseListInput) {
  return {
    // "Other" means the built-in one: expenses in the business's own categories are listed under those.
    category: input.category,
    customCategoryId: input.customCategoryId ?? (input.category === "OTHER" ? null : undefined),
    allocation: input.allocation,
    productId: input.productId,
    costType: input.costType,
  };
}

async function rangeOf(ctx: WorkspaceContext, input: ExpenseListInput) {
  if (!input.from && !input.to) return {};
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: ctx.workspaceId }, select: { timezone: true } });
  return dayRange(input, ws.timezone);
}

function where(ctx: WorkspaceContext, input: ExpenseListInput, range: { from?: Date; to?: Date }): Prisma.ExpenseWhereInput {
  return {
    workspaceId: ctx.workspaceId,
    ...scope(input),
    date: range.from || range.to ? { gte: range.from, lte: range.to } : undefined,
    ...(input.search?.trim() ? { description: { not: null } } : {}),
  };
}

function recurringWhere(ctx: WorkspaceContext, input: ExpenseListInput): Prisma.RecurringExpenseWhereInput {
  return { workspaceId: ctx.workspaceId, ...scope(input) };
}

/**
 * Search ignores case and accents' case on both databases (SQLite's LIKE and PostgreSQL's don't agree),
 * so it runs here. A business has hundreds of expenses, not millions.
 */
function matcher(search: string | undefined) {
  const q = search?.trim().toLocaleLowerCase();
  return q ? (text: string | null) => !!text && text.toLocaleLowerCase().includes(q) : () => true;
}

const LIST_LIMIT = 500;

export async function listExpenses(ctx: WorkspaceContext, input: ExpenseListInput) {
  const range = await rangeOf(ctx, input);
  const match = matcher(input.search);
  const items = await db.expense.findMany({
    where: where(ctx, input, range),
    include: { product: { select: { id: true, name: true } }, customCategory: { select: { id: true, name: true } } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: input.search?.trim() ? undefined : LIST_LIMIT,
  });
  return items.filter((e) => match(e.description)).slice(0, LIST_LIMIT);
}

/** Repeating expenses, each with what it costs in the days picked and in an average month. */
export async function listRecurring(ctx: WorkspaceContext, input: ExpenseListInput) {
  const range = await rangeOf(ctx, input);
  const now = new Date();
  const match = matcher(input.search);
  const items = await db.recurringExpense.findMany({
    where: recurringWhere(ctx, input),
    include: { product: { select: { id: true, name: true } }, customCategory: { select: { id: true, name: true } } },
    orderBy: [{ endDate: { sort: "asc", nulls: "first" } }, { name: "asc" }],
  });
  return items
    .filter((r) => match(r.name))
    .map((r) => ({ ...r, inPeriod: recurringShare(r, range, now), perMonth: monthlyEquivalent(r), running: isRunning(r, now) }));
}

/**
 * Totals for the days picked: one-off expenses plus each repeating expense's share of those days,
 * by month, by category and by product, with the unallocated (global) part always visible.
 */
export async function expenseSummary(ctx: WorkspaceContext, input: ExpenseListInput) {
  const range = await rangeOf(ctx, input);
  const now = new Date();
  const match = matcher(input.search);
  const [allRows, allRecurring, categories, products, pendingBank] = await Promise.all([
    db.expense.findMany({ where: where(ctx, input, range), select: { date: true, amount: true, allocation: true, category: true, customCategoryId: true, productId: true, description: true } }),
    db.recurringExpense.findMany({ where: recurringWhere(ctx, input) }),
    db.customExpenseCategory.findMany({ where: { workspaceId: ctx.workspaceId }, select: { id: true, name: true } }),
    db.product.findMany({ where: { workspaceId: ctx.workspaceId }, select: { id: true, name: true } }),
    db.bankTransaction.count({ where: { workspaceId: ctx.workspaceId, reviewStatus: "PENDING" } }),
  ]);
  const rows = allRows.filter((r) => match(r.description));
  const recurring = allRecurring.filter((r) => match(r.name));
  const months = new Map<string, { month: string; total: number; global: number; product: number; repeating: number }>();
  const byCategory = new Map<string, number>();
  const byProduct = new Map<string, number>();
  let total = 0;
  let unallocated = 0;
  let repeating = 0;
  const add = (r: { allocation: ExpenseAllocation; category: ExpenseCategory; customCategoryId: string | null; productId: string | null }, month: string, amount: number, isRepeating: boolean) => {
    if (!amount) return;
    const e = months.get(month) ?? months.set(month, { month, total: 0, global: 0, product: 0, repeating: 0 }).get(month)!;
    e.total += amount;
    if (r.allocation === "GLOBAL") e.global += amount;
    else e.product += amount;
    if (isRepeating) e.repeating += amount;
    const key = r.customCategoryId ? `custom:${r.customCategoryId}` : r.category;
    byCategory.set(key, (byCategory.get(key) ?? 0) + amount);
    if (r.allocation === "PRODUCT" && r.productId) byProduct.set(r.productId, (byProduct.get(r.productId) ?? 0) + amount);
    total += amount;
    if (r.allocation === "GLOBAL") unallocated += amount;
    if (isRepeating) repeating += amount;
  };
  for (const r of rows) add(r, r.date.toISOString().slice(0, 7), r.amount, false);
  for (const r of recurring) for (const [month, amount] of recurringByMonth(r, range, now)) add(r, month, amount, true);
  const customName = new Map(categories.map((c) => [`custom:${c.id}`, c.name]));
  const productName = new Map(products.map((p) => [p.id, p.name]));
  return {
    months: [...months.values()].sort((a, b) => b.month.localeCompare(a.month)),
    byCategory: [...byCategory.entries()].map(([category, amount]) => ({ category, name: customName.get(category) ?? null, amount })).sort((a, b) => b.amount - a.amount),
    byProduct: [...byProduct.entries()].map(([productId, amount]) => ({ productId, name: productName.get(productId) ?? "Product", amount })).sort((a, b) => b.amount - a.amount),
    total,
    unallocated,
    repeating,
    /** What the repeating expenses still running cost in an average month. */
    repeatingPerMonth: recurring.filter((r) => isRunning(r, now)).reduce((a, r) => a + monthlyEquivalent(r), 0),
    pendingBankRows: pendingBank,
  };
}

async function assertProduct(ctx: WorkspaceContext, input: { allocation: ExpenseAllocation; productId?: string | null }) {
  if (input.allocation === "PRODUCT") {
    if (!input.productId) throw new NotFoundError("Choose a product for a product-specific expense");
    const p = await db.product.findFirst({ where: { id: input.productId, workspaceId: ctx.workspaceId }, select: { id: true } });
    if (!p) throw new NotFoundError("Product not found");
  }
}

async function assertCategory(ctx: WorkspaceContext, customCategoryId: string | null | undefined) {
  if (!customCategoryId) return;
  const c = await db.customExpenseCategory.findFirst({ where: { id: customCategoryId, workspaceId: ctx.workspaceId }, select: { id: true } });
  if (!c) throw new NotFoundError("Category not found");
}

export async function createExpense(ctx: WorkspaceContext, input: ExpenseInput) {
  assertCan(ctx, "expenses.write");
  await assertProduct(ctx, input);
  await assertCategory(ctx, input.customCategoryId);
  const e = await db.expense.create({
    data: { workspaceId: ctx.workspaceId, ...(await expenseColumns(ctx, input)), createdById: ctx.userId },
  });
  await audit(ctx, "expense.created", { type: "Expense", id: e.id }, { category: e.category, amount: e.amount, originalAmount: e.originalAmount, originalCurrency: e.originalCurrency, fxRate: e.fxRate });
  return e;
}

export async function updateExpense(ctx: WorkspaceContext, id: string, input: ExpenseInput) {
  assertCan(ctx, "expenses.write");
  const existing = await db.expense.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!existing) throw new NotFoundError("Expense not found");
  await assertProduct(ctx, input);
  await assertCategory(ctx, input.customCategoryId);
  const e = await db.expense.update({ where: { id: existing.id }, data: await expenseColumns(ctx, input) });
  await audit(ctx, "expense.updated", { type: "Expense", id: e.id }, {
    from: { amount: existing.amount, category: existing.category, originalAmount: existing.originalAmount, originalCurrency: existing.originalCurrency },
    to: { amount: e.amount, category: e.category, originalAmount: e.originalAmount, originalCurrency: e.originalCurrency },
  });
  return e;
}

export async function deleteExpense(ctx: WorkspaceContext, id: string) {
  assertCan(ctx, "expenses.write");
  const existing = await db.expense.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!existing) throw new NotFoundError("Expense not found");
  await db.expense.delete({ where: { id: existing.id } });
  await audit(ctx, "expense.deleted", { type: "Expense", id }, { category: existing.category, amount: existing.amount, date: existing.date });
}

// ───────────── The business's own categories ─────────────

export async function listCategories(ctx: WorkspaceContext) {
  const rows = await db.customExpenseCategory.findMany({
    where: { workspaceId: ctx.workspaceId },
    select: { id: true, name: true, _count: { select: { expenses: true, recurring: true } } },
    orderBy: { name: "asc" },
  });
  return rows.map((c) => ({ id: c.id, name: c.name, used: c._count.expenses + c._count.recurring }));
}

export async function createCategory(ctx: WorkspaceContext, name: string) {
  assertCan(ctx, "expenses.write");
  const clean = name.trim().replace(/\s+/g, " ");
  const taken = await db.customExpenseCategory.findMany({ where: { workspaceId: ctx.workspaceId }, select: { id: true, name: true } });
  const same = taken.find((c) => c.name.toLowerCase() === clean.toLowerCase());
  if (same) return same;
  if (taken.length >= 100) throw new InputError("You can have up to 100 categories of your own.");
  const c = await db.customExpenseCategory.create({ data: { workspaceId: ctx.workspaceId, name: clean }, select: { id: true, name: true } });
  await audit(ctx, "expenseCategory.created", { type: "CustomExpenseCategory", id: c.id }, { name: c.name });
  return c;
}

/** Removes one of the business's categories. Its expenses go back to the built-in "Other". */
export async function deleteCategory(ctx: WorkspaceContext, id: string) {
  assertCan(ctx, "expenses.write");
  const c = await db.customExpenseCategory.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!c) throw new NotFoundError("Category not found");
  await db.customExpenseCategory.delete({ where: { id: c.id } });
  await audit(ctx, "expenseCategory.deleted", { type: "CustomExpenseCategory", id: c.id }, { name: c.name });
}

// ───────────── Repeating expenses ─────────────

export type RecurringInput = {
  name: string;
  category: ExpenseCategory;
  customCategoryId?: string | null;
  amount: number;
  currency?: string;
  fxRate?: number | null;
  frequency: ExpenseFrequency;
  startDate: Date;
  endDate?: Date | null;
  allocation: ExpenseAllocation;
  productId?: string | null;
  costType: CostType;
};

async function recurringColumns(ctx: WorkspaceContext, input: RecurringInput) {
  if (input.endDate && input.endDate < input.startDate) throw new InputError("The last day must be after the first day.");
  await assertProduct(ctx, input);
  await assertCategory(ctx, input.customCategoryId);
  const money = await toWorkspaceCurrency(ctx, input.amount, input.currency, input.fxRate);
  return {
    name: input.name.trim(),
    category: input.customCategoryId ? ("OTHER" as const) : input.category,
    customCategoryId: input.customCategoryId ?? null,
    amount: money.amount,
    currency: ctx.currency,
    originalAmount: money.original?.amount ?? null,
    originalCurrency: money.original?.currency ?? null,
    fxRate: money.original?.rate ?? null,
    frequency: input.frequency,
    startDate: input.startDate,
    endDate: input.endDate ?? null,
    allocation: input.allocation,
    productId: input.allocation === "PRODUCT" ? input.productId : null,
    costType: input.costType,
  };
}

export async function createRecurring(ctx: WorkspaceContext, input: RecurringInput) {
  assertCan(ctx, "expenses.write");
  const r = await db.recurringExpense.create({ data: { workspaceId: ctx.workspaceId, ...(await recurringColumns(ctx, input)), createdById: ctx.userId } });
  await audit(ctx, "recurringExpense.created", { type: "RecurringExpense", id: r.id }, { name: r.name, amount: r.amount, frequency: r.frequency });
  return r;
}

export async function updateRecurring(ctx: WorkspaceContext, id: string, input: RecurringInput) {
  assertCan(ctx, "expenses.write");
  const existing = await db.recurringExpense.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!existing) throw new NotFoundError("Repeating expense not found");
  const r = await db.recurringExpense.update({ where: { id: existing.id }, data: await recurringColumns(ctx, input) });
  await audit(ctx, "recurringExpense.updated", { type: "RecurringExpense", id: r.id }, { from: { amount: existing.amount, frequency: existing.frequency, endDate: existing.endDate }, to: { amount: r.amount, frequency: r.frequency, endDate: r.endDate } });
  return r;
}

/** Stops a repeating expense: today is the last day it counts. What it cost before stays. */
export async function stopRecurring(ctx: WorkspaceContext, id: string, today: Date) {
  assertCan(ctx, "expenses.write");
  const existing = await db.recurringExpense.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!existing) throw new NotFoundError("Repeating expense not found");
  const endDate = today < existing.startDate ? existing.startDate : today;
  const r = await db.recurringExpense.update({ where: { id: existing.id }, data: { endDate } });
  await audit(ctx, "recurringExpense.stopped", { type: "RecurringExpense", id: r.id }, { endDate });
  return r;
}

/** Deletes a repeating expense, including what it cost in the past. */
export async function deleteRecurring(ctx: WorkspaceContext, id: string) {
  assertCan(ctx, "expenses.write");
  const existing = await db.recurringExpense.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!existing) throw new NotFoundError("Repeating expense not found");
  await db.recurringExpense.delete({ where: { id: existing.id } });
  await audit(ctx, "recurringExpense.deleted", { type: "RecurringExpense", id }, { name: existing.name, amount: existing.amount, frequency: existing.frequency });
}
