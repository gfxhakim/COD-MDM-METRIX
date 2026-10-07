import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { planNewCostVersion, selectCostVersion } from "@/domain/costVersions";
import { toWorkspaceCurrency } from "@/server/fx";
import { assertCan, NotFoundError, type WorkspaceContext } from "@/server/tenancy";

export type CostInput = {
  salePrice: number;
  sourcingCost: number;
  forwardShippingFee: number;
  rtoFee: number;
  callCenterFee: number;
  packagingFee: number;
  /** Currency the sourcing cost was entered in; the other fields are in the workspace currency. */
  sourcingCurrency?: string;
  /** Workspace currency per 1 sourcingCurrency. Falls back to the rate in Settings. */
  sourcingFxRate?: number | null;
};

/** Cost-version columns for a cost entered in the form, converting the sourcing cost when needed. */
async function costColumns(ctx: WorkspaceContext, cost: CostInput, tx: Prisma.TransactionClient) {
  const { sourcingCurrency, sourcingFxRate, ...values } = cost;
  const sourcing = await toWorkspaceCurrency(ctx, values.sourcingCost, sourcingCurrency, sourcingFxRate, tx);
  return {
    ...values,
    sourcingCost: sourcing.amount,
    sourcingCostOriginal: sourcing.original?.amount ?? null,
    sourcingCurrency: sourcing.original?.currency ?? null,
    sourcingFxRate: sourcing.original?.rate ?? null,
  };
}

export async function listProducts(ctx: WorkspaceContext, input: { includeInactive?: boolean } = {}) {
  const products = await db.product.findMany({
    where: { workspaceId: ctx.workspaceId, ...(input.includeInactive ? {} : { active: true }) },
    include: { costVersions: { orderBy: { effectiveFrom: "desc" } }, mdmLinks: { select: { mdmProductId: true, mdmName: true }, orderBy: { createdAt: "asc" } }, _count: { select: { campaigns: true, adAccounts: true } } },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
  const now = new Date();
  return products.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    currency: p.currency,
    active: p.active,
    createdAt: p.createdAt,
    currentCost: selectCostVersion(p.costVersions, now),
    versionCount: p.costVersions.length,
    /** Campaigns linked to it, and ad accounts whose campaigns count for it by default. */
    linkedCampaigns: p._count.campaigns,
    linkedAdAccounts: p._count.adAccounts,
    /** Created by the MDM sync; its costs still need entering while it has no cost version. */
    fromMdm: p.fromMdm,
    /** The MDM products that count as this product. */
    mdmProducts: p.mdmLinks.map((l) => ({ id: l.mdmProductId, name: l.mdmName })),
  }));
}

/** Every product MDM has sent with an order, the product it counts as, and how much it sold. */
export async function listMdmProducts(ctx: WorkspaceContext) {
  const [links, lines] = await Promise.all([
    db.mdmProductLink.findMany({ where: { workspaceId: ctx.workspaceId }, select: { mdmProductId: true, mdmName: true, productId: true, createdAt: true }, orderBy: { createdAt: "asc" } }),
    db.orderLine.groupBy({ by: ["mdmProductId"], where: { workspaceId: ctx.workspaceId, mdmProductId: { not: null } }, _count: { _all: true }, _sum: { quantity: true } }),
  ]);
  const sold = new Map(lines.map((l) => [l.mdmProductId, { lines: l._count._all, units: l._sum.quantity ?? 0 }]));
  return links.map((l) => ({ id: l.mdmProductId, name: l.mdmName, productId: l.productId, since: l.createdAt, lines: sold.get(l.mdmProductId)?.lines ?? 0, units: sold.get(l.mdmProductId)?.units ?? 0 }));
}

/**
 * Makes an MDM product count as another product, with every order line it already has. A product the
 * sync created that is left with nothing (no MDM product, orders, costs, ads or expenses) is removed.
 */
export async function moveMdmProduct(ctx: WorkspaceContext, input: { mdmProductId: string; productId: string }) {
  assertCan(ctx, "catalog.write");
  const ws = ctx.workspaceId;
  const [link, target] = await Promise.all([
    db.mdmProductLink.findUnique({ where: { workspaceId_mdmProductId: { workspaceId: ws, mdmProductId: input.mdmProductId } }, select: { productId: true } }),
    db.product.findFirst({ where: { id: input.productId, workspaceId: ws }, select: { id: true, sku: true } }),
  ]);
  if (!link) throw new NotFoundError("MDM product not found");
  if (!target) throw new NotFoundError("Product not found");
  if (link.productId === target.id) return { moved: 0, removed: null };
  return db.$transaction(async (tx) => {
    await tx.mdmProductLink.update({ where: { workspaceId_mdmProductId: { workspaceId: ws, mdmProductId: input.mdmProductId } }, data: { productId: target.id } });
    const moved = await tx.orderLine.updateMany({ where: { workspaceId: ws, mdmProductId: input.mdmProductId }, data: { productId: target.id, sku: target.sku } });
    const old = await tx.product.findUnique({
      where: { id: link.productId },
      select: { id: true, name: true, fromMdm: true, _count: { select: { mdmLinks: true, orderLines: true, costVersions: true, campaigns: true, adAccounts: true, creatives: true, expenses: true } } },
    });
    const empty = old?.fromMdm && Object.values(old._count).every((n) => n === 0);
    if (empty) await tx.product.delete({ where: { id: old.id } });
    await audit(ctx, "product.mdm_product_moved", { type: "Product", id: target.id }, { mdmProductId: input.mdmProductId, from: link.productId, lines: moved.count, removedFrom: !!empty }, tx);
    return { moved: moved.count, removed: empty ? old.name : null };
  });
}

export async function getProduct(ctx: WorkspaceContext, id: string) {
  const product = await db.product.findFirst({
    where: { id, workspaceId: ctx.workspaceId },
    include: { costVersions: { orderBy: { effectiveFrom: "desc" } } },
  });
  if (!product) throw new NotFoundError("Product not found");
  return { ...product, currentCost: selectCostVersion(product.costVersions, new Date()) };
}

export async function createProduct(
  ctx: WorkspaceContext,
  input: { name: string; sku: string; active?: boolean; cost: CostInput; effectiveFrom?: Date },
) {
  assertCan(ctx, "catalog.write");
  const product = await db.$transaction(async (tx) => {
    const cost = await costColumns(ctx, input.cost, tx);
    const p = await tx.product.create({
      data: {
        workspaceId: ctx.workspaceId,
        name: input.name,
        sku: input.sku,
        currency: ctx.currency,
        active: input.active ?? true,
        costVersions: {
          create: {
            workspaceId: ctx.workspaceId,
            effectiveFrom: input.effectiveFrom ?? new Date("2000-01-01T00:00:00Z"),
            currency: ctx.currency,
            createdById: ctx.userId,
            note: "Initial cost assumptions",
            ...cost,
          },
        },
      },
    });
    await audit(ctx, "product.created", { type: "Product", id: p.id }, { sku: p.sku }, tx);
    return p;
  });
  return product;
}

export async function updateProduct(ctx: WorkspaceContext, input: { id: string; name?: string; sku?: string; active?: boolean }) {
  assertCan(ctx, "catalog.write");
  const existing = await db.product.findFirst({ where: { id: input.id, workspaceId: ctx.workspaceId } });
  if (!existing) throw new NotFoundError("Product not found");
  const p = await db.product.update({
    where: { id: existing.id },
    data: { name: input.name, sku: input.sku, active: input.active },
  });
  await audit(ctx, "product.updated", { type: "Product", id: p.id }, { name: input.name, sku: input.sku, active: input.active });
  return p;
}

export async function createCostVersion(
  ctx: WorkspaceContext,
  input: { productId: string; effectiveFrom: Date; note?: string; cost: CostInput },
) {
  assertCan(ctx, "catalog.write");
  return db.$transaction(async (tx) => {
    const product = await tx.product.findFirst({
      where: { id: input.productId, workspaceId: ctx.workspaceId },
      include: { costVersions: true },
    });
    if (!product) throw new NotFoundError("Product not found");
    const { closeId } = planNewCostVersion(product.costVersions, input.effectiveFrom);
    if (closeId) await tx.productCostVersion.update({ where: { id: closeId }, data: { effectiveTo: input.effectiveFrom } });
    const cost = await costColumns(ctx, input.cost, tx);
    const v = await tx.productCostVersion.create({
      data: {
        workspaceId: ctx.workspaceId,
        productId: product.id,
        effectiveFrom: input.effectiveFrom,
        currency: product.currency,
        note: input.note,
        createdById: ctx.userId,
        ...cost,
      },
    });
    await audit(ctx, "product.cost_version_created", { type: "ProductCostVersion", id: v.id }, { productId: product.id, effectiveFrom: input.effectiveFrom, ...cost }, tx);
    return v;
  });
}

/** Deletion is blocked when orders reference the product; deactivate instead to keep history. */
export async function deleteProduct(ctx: WorkspaceContext, id: string) {
  assertCan(ctx, "catalog.write");
  const product = await db.product.findFirst({ where: { id, workspaceId: ctx.workspaceId }, include: { _count: { select: { orderLines: true } } } });
  if (!product) throw new NotFoundError("Product not found");
  if (product._count.orderLines > 0) {
    await db.product.update({ where: { id }, data: { active: false } });
    await audit(ctx, "product.deactivated", { type: "Product", id }, { reason: "has order history" });
    return { deleted: false, deactivated: true };
  }
  await db.product.delete({ where: { id } });
  await audit(ctx, "product.deleted", { type: "Product", id }, { sku: product.sku });
  return { deleted: true, deactivated: false };
}
