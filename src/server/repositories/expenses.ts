import type { CostType, ExpenseAllocation, ExpenseCategory, Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { assertCan, NotFoundError, type WorkspaceContext } from "@/server/tenancy";

export type ExpenseInput = {
  date: Date;
  category: ExpenseCategory;
  amount: number;
  description?: string;
  allocation: ExpenseAllocation;
  productId?: string | null;
  costType: CostType;
};

export type ExpenseListInput = {
  category?: ExpenseCategory;
  allocation?: ExpenseAllocation;
  productId?: string;
  from?: Date;
  to?: Date;
};

function where(ctx: WorkspaceContext, input: ExpenseListInput): Prisma.ExpenseWhereInput {
  return {
    workspaceId: ctx.workspaceId,
    category: input.category,
    allocation: input.allocation,
    productId: input.productId,
    date: input.from || input.to ? { gte: input.from, lte: input.to } : undefined,
  };
}

export async function listExpenses(ctx: WorkspaceContext, input: ExpenseListInput) {
  const items = await db.expense.findMany({
    where: where(ctx, input),
    include: { product: { select: { id: true, name: true } } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 500,
  });
  return items;
}

/** Monthly totals split by allocation so unallocated (global) overhead is always visible. */
export async function expenseSummary(ctx: WorkspaceContext, input: ExpenseListInput) {
  const rows = await db.expense.findMany({ where: where(ctx, input), select: { date: true, amount: true, allocation: true, category: true } });
  const months = new Map<string, { month: string; total: number; global: number; product: number }>();
  const byCategory = new Map<string, number>();
  for (const r of rows) {
    const m = r.date.toISOString().slice(0, 7);
    const e = months.get(m) ?? { month: m, total: 0, global: 0, product: 0 };
    e.total += r.amount;
    if (r.allocation === "GLOBAL") e.global += r.amount;
    else e.product += r.amount;
    months.set(m, e);
    byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + r.amount);
  }
  const pendingBank = await db.bankTransaction.count({ where: { workspaceId: ctx.workspaceId, reviewStatus: "PENDING" } });
  return {
    months: [...months.values()].sort((a, b) => b.month.localeCompare(a.month)),
    byCategory: [...byCategory.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
    total: rows.reduce((a, r) => a + r.amount, 0),
    unallocated: rows.filter((r) => r.allocation === "GLOBAL").reduce((a, r) => a + r.amount, 0),
    pendingBankRows: pendingBank,
  };
}

async function assertProduct(ctx: WorkspaceContext, input: ExpenseInput) {
  if (input.allocation === "PRODUCT") {
    if (!input.productId) throw new NotFoundError("Choose a product for a product-specific expense");
    const p = await db.product.findFirst({ where: { id: input.productId, workspaceId: ctx.workspaceId }, select: { id: true } });
    if (!p) throw new NotFoundError("Product not found");
  }
}

export async function createExpense(ctx: WorkspaceContext, input: ExpenseInput) {
  assertCan(ctx, "expenses.write");
  await assertProduct(ctx, input);
  const e = await db.expense.create({
    data: {
      workspaceId: ctx.workspaceId,
      ...input,
      productId: input.allocation === "PRODUCT" ? input.productId : null,
      currency: ctx.currency,
      createdById: ctx.userId,
    },
  });
  await audit(ctx, "expense.created", { type: "Expense", id: e.id }, { category: e.category, amount: e.amount });
  return e;
}

export async function updateExpense(ctx: WorkspaceContext, id: string, input: ExpenseInput) {
  assertCan(ctx, "expenses.write");
  const existing = await db.expense.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!existing) throw new NotFoundError("Expense not found");
  await assertProduct(ctx, input);
  const e = await db.expense.update({
    where: { id: existing.id },
    data: { ...input, productId: input.allocation === "PRODUCT" ? input.productId : null },
  });
  await audit(ctx, "expense.updated", { type: "Expense", id: e.id }, { from: { amount: existing.amount, category: existing.category }, to: { amount: e.amount, category: e.category } });
  return e;
}

export async function deleteExpense(ctx: WorkspaceContext, id: string) {
  assertCan(ctx, "expenses.write");
  const existing = await db.expense.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!existing) throw new NotFoundError("Expense not found");
  await db.expense.delete({ where: { id: existing.id } });
  await audit(ctx, "expense.deleted", { type: "Expense", id }, { category: existing.category, amount: existing.amount, date: existing.date });
}
