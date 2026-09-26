import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { planNewCostVersion, selectCostVersion } from "@/domain/costVersions";
import { assertCan, NotFoundError, type WorkspaceContext } from "@/server/tenancy";

export type CostInput = {
  salePrice: number;
  sourcingCost: number;
  forwardShippingFee: number;
  rtoFee: number;
  callCenterFee: number;
  packagingFee: number;
};

export async function listProducts(ctx: WorkspaceContext, input: { includeInactive?: boolean } = {}) {
  const products = await db.product.findMany({
    where: { workspaceId: ctx.workspaceId, ...(input.includeInactive ? {} : { active: true }) },
    include: { costVersions: { orderBy: { effectiveFrom: "desc" } } },
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
  }));
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
            ...input.cost,
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
    const v = await tx.productCostVersion.create({
      data: {
        workspaceId: ctx.workspaceId,
        productId: product.id,
        effectiveFrom: input.effectiveFrom,
        currency: product.currency,
        note: input.note,
        createdById: ctx.userId,
        ...input.cost,
      },
    });
    await audit(ctx, "product.cost_version_created", { type: "ProductCostVersion", id: v.id }, { productId: product.id, effectiveFrom: input.effectiveFrom, ...input.cost }, tx);
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
