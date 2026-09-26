import type { BankReviewStatus, CostType, ExpenseAllocation, ExpenseCategory } from "@prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { InputError } from "@/server/errors";
import { assertCan, NotFoundError, type WorkspaceContext } from "@/server/tenancy";
import { normalizeCreativeKey } from "@/lib/normalize";
import { relinkAttribution } from "./service";

// ---------- Bank review queue ----------

export async function listBank(ctx: WorkspaceContext, input: { status?: BankReviewStatus; limit: number; cursor?: string | null }) {
  const rows = await db.bankTransaction.findMany({
    where: { workspaceId: ctx.workspaceId, reviewStatus: input.status },
    orderBy: [{ date: "desc" }, { id: "asc" }],
    take: input.limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    include: { expense: { select: { id: true, category: true, allocation: true, productId: true } } },
  });
  const counts = await db.bankTransaction.groupBy({ by: ["reviewStatus"], where: { workspaceId: ctx.workspaceId }, _count: true, _sum: { amount: true } });
  return {
    items: rows.slice(0, input.limit),
    nextCursor: rows.length > input.limit ? rows[input.limit].id : null,
    counts: Object.fromEntries(counts.map((c) => [c.reviewStatus, { count: c._count, amount: c._sum.amount ?? 0 }])) as Partial<Record<BankReviewStatus, { count: number; amount: number }>>,
  };
}

export type CategorizeInput = { id: string; category: ExpenseCategory; allocation: ExpenseAllocation; productId?: string | null; costType: CostType; description?: string };

/** Turn a bank debit into an expense. Only then does it count toward profit. */
export async function categorizeBank(ctx: WorkspaceContext, input: CategorizeInput) {
  assertCan(ctx, "expenses.write");
  return db.$transaction(async (tx) => {
    const row = await tx.bankTransaction.findFirst({ where: { id: input.id, workspaceId: ctx.workspaceId }, include: { expense: true } });
    if (!row) throw new NotFoundError("Bank row not found");
    if (row.amount >= 0) throw new InputError("Only money going out can become an expense. Exclude incoming transfers instead.");
    if (row.reviewStatus !== "PENDING") throw new InputError("This row was already reviewed. Reopen it first.");
    let productId: string | null = null;
    if (input.allocation === "PRODUCT") {
      const p = input.productId ? await tx.product.findFirst({ where: { id: input.productId, workspaceId: ctx.workspaceId }, select: { id: true } }) : null;
      if (!p) throw new NotFoundError("Product not found");
      productId = p.id;
    }
    const expense = await tx.expense.create({
      data: {
        workspaceId: ctx.workspaceId,
        date: row.date,
        category: input.category,
        amount: Math.abs(row.amount),
        currency: row.currency,
        description: input.description?.trim() || row.description,
        allocation: input.allocation,
        productId,
        costType: input.costType,
        bankTransactionId: row.id,
        createdById: ctx.userId,
      },
    });
    await tx.bankTransaction.update({ where: { id: row.id }, data: { reviewStatus: "CATEGORIZED" } });
    await audit(ctx, "bank.categorized", { type: "BankTransaction", id: row.id }, { expenseId: expense.id, category: input.category, amount: expense.amount }, tx);
    return expense;
  });
}

export async function excludeBank(ctx: WorkspaceContext, ids: string[]) {
  assertCan(ctx, "expenses.write");
  const r = await db.bankTransaction.updateMany({ where: { workspaceId: ctx.workspaceId, id: { in: ids }, reviewStatus: "PENDING" }, data: { reviewStatus: "EXCLUDED" } });
  await audit(ctx, "bank.excluded", { type: "BankTransaction" }, { count: r.count });
  return { count: r.count };
}

/** Undo a review decision: deletes the linked expense and puts the row back in the queue. */
export async function reopenBank(ctx: WorkspaceContext, id: string) {
  assertCan(ctx, "expenses.write");
  return db.$transaction(async (tx) => {
    const row = await tx.bankTransaction.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
    if (!row) throw new NotFoundError("Bank row not found");
    const deleted = await tx.expense.deleteMany({ where: { workspaceId: ctx.workspaceId, bankTransactionId: row.id } });
    await tx.bankTransaction.update({ where: { id: row.id }, data: { reviewStatus: "PENDING" } });
    await audit(ctx, "bank.reopened", { type: "BankTransaction", id: row.id }, { from: row.reviewStatus, removedExpenses: deleted.count }, tx);
  });
}

// ---------- Unmatched spend review ----------

export async function unmatchedSpend(ctx: WorkspaceContext) {
  const groups = await db.adSpend.groupBy({
    by: ["externalCreativeId"],
    where: { workspaceId: ctx.workspaceId, creativeId: null },
    _sum: { spend: true, impressions: true, clicks: true },
    _count: true,
    _min: { date: true },
    _max: { date: true, adName: true, campaignName: true },
    orderBy: { _sum: { spend: "desc" } },
  });
  return groups.map((g) => ({
    externalCreativeId: g.externalCreativeId,
    normalizedKey: g.externalCreativeId ? normalizeCreativeKey(g.externalCreativeId) : null,
    rows: g._count,
    spend: g._sum.spend ?? 0,
    impressions: g._sum.impressions ?? 0,
    clicks: g._sum.clicks ?? 0,
    from: g._min.date,
    to: g._max.date,
    adName: g._max.adName,
    campaignName: g._max.campaignName,
  }));
}

/**
 * Resolve unmatched spend for one external creative ID: link it to an existing creative,
 * or create a creative for it. Orders whose utm_content matches the new key are relinked too.
 */
export async function resolveUnmatchedSpend(
  ctx: WorkspaceContext,
  input: { externalCreativeId: string; creativeId?: string | null; create?: { name?: string; productId?: string | null } | null },
) {
  assertCan(ctx, "catalog.write");
  const ws = ctx.workspaceId;
  return db.$transaction(async (tx) => {
    const count = await tx.adSpend.count({ where: { workspaceId: ws, creativeId: null, externalCreativeId: input.externalCreativeId } });
    if (!count) throw new NotFoundError("No unmatched spend for that creative ID");
    let creativeId: string;
    if (input.creativeId) {
      const c = await tx.creative.findFirst({ where: { id: input.creativeId, workspaceId: ws }, select: { id: true } });
      if (!c) throw new NotFoundError("Creative not found");
      creativeId = c.id;
    } else if (input.create) {
      const key = normalizeCreativeKey(input.externalCreativeId);
      if (!key) throw new InputError("This spend has no usable creative ID");
      if (input.create.productId) {
        const p = await tx.product.findFirst({ where: { id: input.create.productId, workspaceId: ws }, select: { id: true } });
        if (!p) throw new NotFoundError("Product not found");
      }
      const existing = await tx.creative.findFirst({ where: { workspaceId: ws, normalizedKey: key }, select: { id: true } });
      creativeId =
        existing?.id ??
        (await tx.creative.create({ data: { workspaceId: ws, platform: "META", externalCreativeId: input.externalCreativeId, normalizedKey: key, name: input.create.name?.trim() || input.externalCreativeId, productId: input.create.productId ?? null } })).id;
    } else throw new InputError("Pick a creative or create one");
    const r = await tx.adSpend.updateMany({ where: { workspaceId: ws, creativeId: null, externalCreativeId: input.externalCreativeId }, data: { creativeId } });
    const relinked = await relinkAttribution(ctx, tx);
    await audit(ctx, "spend.matched", { type: "Creative", id: creativeId }, { externalCreativeId: input.externalCreativeId, rows: r.count, relinkedOrders: relinked.attributions }, tx);
    return { creativeId, rows: r.count, relinkedOrders: relinked.attributions };
  });
}

export async function setCreativeProduct(ctx: WorkspaceContext, input: { id: string; productId: string | null; name?: string }) {
  assertCan(ctx, "catalog.write");
  const c = await db.creative.findFirst({ where: { id: input.id, workspaceId: ctx.workspaceId } });
  if (!c) throw new NotFoundError("Creative not found");
  if (input.productId) {
    const p = await db.product.findFirst({ where: { id: input.productId, workspaceId: ctx.workspaceId }, select: { id: true } });
    if (!p) throw new NotFoundError("Product not found");
  }
  const updated = await db.creative.update({ where: { id: c.id }, data: { productId: input.productId, ...(input.name?.trim() ? { name: input.name.trim() } : {}) } });
  await audit(ctx, "creative.updated", { type: "Creative", id: c.id }, { productId: input.productId, previousProductId: c.productId });
  return updated;
}
