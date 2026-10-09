import type { NormalizedStatus, OrderSource, OrderStatus, Prisma } from "@prisma/client";
import type { AdFilter } from "@/domain/adFilter";
import { sortWilayas, wilayaName } from "@/domain/wilayas";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { normalizeCreativeKey, normalizeReference } from "@/lib/normalize";
import { hashPhone, maskPhone } from "@/lib/pii";
import { assertCan, NotFoundError, type WorkspaceContext } from "@/server/tenancy";
import { customerFor } from "@/server/customers";
import { resolveAdScope, scopeCampaignIds } from "@/server/reports/adScope";

export type OrderListInput = {
  search?: string;
  status?: OrderStatus;
  parcelStatus?: NormalizedStatus;
  wilaya?: string;
  productId?: string;
  creativeId?: string;
  source?: OrderSource;
  /** Only orders MDM's call center upsold (true), or only the others (false). */
  upsell?: boolean;
  from?: Date;
  to?: Date;
  /** Only orders whose ad is in these Meta Business Managers, ad accounts or campaigns. */
  ads?: AdFilter;
  page: number;
  pageSize: number;
};

/** The campaigns (platform IDs) an order's ad must be in for an ad filter, or undefined for any order. */
export async function adCampaignIdsFor(ctx: WorkspaceContext, ads: AdFilter | undefined) {
  const scope = await resolveAdScope(ctx.workspaceId, ads);
  return scope ? scopeCampaignIds(ctx.workspaceId, scope) : undefined;
}

export function orderWhere(ctx: WorkspaceContext, input: Omit<OrderListInput, "page" | "pageSize" | "ads"> & { adCampaignIds?: string[] }): Prisma.OrderWhereInput {
  const and: Prisma.OrderWhereInput[] = [{ workspaceId: ctx.workspaceId }];
  if (input.search) {
    const q = input.search.trim();
    // A phone number is found through its salted hash; the number itself is stored encrypted.
    const phoneHash = /^[+\d][\d\s().-]{5,}$/.test(q) ? hashPhone(q, ctx.workspaceId) : null;
    and.push({
      OR: [
        { orderNumber: { contains: q } },
        { normalizedOrderNumber: { contains: normalizeReference(q) || q } },
        { mdmOrderId: { contains: q } },
        { parcels: { some: { trackingId: { contains: q } } } },
        ...(phoneHash ? [{ phoneHash }] : []),
      ],
    });
  }
  if (input.status) and.push({ status: input.status });
  if (input.parcelStatus) and.push({ parcels: { some: { normalizedStatus: input.parcelStatus } } });
  if (input.wilaya) and.push({ wilaya: input.wilaya });
  if (input.productId) and.push({ lines: { some: { productId: input.productId } } });
  if (input.creativeId) and.push({ attribution: { creativeId: input.creativeId } });
  if (input.source) and.push({ source: input.source });
  if (input.upsell !== undefined) and.push({ mdmUpsell: input.upsell });
  if (input.adCampaignIds) and.push({ attribution: { creative: { campaignId: { in: input.adCampaignIds } } } });
  if (input.from) and.push({ placedAt: { gte: input.from } });
  if (input.to) and.push({ placedAt: { lte: input.to } });
  return { AND: and };
}

export async function listOrders(ctx: WorkspaceContext, input: OrderListInput) {
  const where = orderWhere(ctx, { ...input, adCampaignIds: await adCampaignIdsFor(ctx, input.ads) });
  const [total, rows] = await Promise.all([
    db.order.count({ where }),
    db.order.findMany({
      where,
      orderBy: [{ placedAt: "desc" }, { id: "desc" }],
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      include: {
        lines: { include: { product: { select: { id: true, name: true } } } },
        attribution: { include: { creative: { select: { id: true, externalCreativeId: true, name: true } } } },
        parcels: { orderBy: { createdAt: "desc" } },
      },
    }),
  ]);
  return {
    total,
    items: rows.map((o) => {
      const primary = o.parcels[0];
      return {
        id: o.id,
        orderNumber: o.orderNumber,
        mdmOrderId: o.mdmOrderId,
        customer: customerFor(ctx.role, o.customerEncrypted, ctx.workspaceId),
        source: o.source,
        product: o.lines[0]?.product?.name ?? o.lines[0]?.productName ?? null,
        extraLines: Math.max(0, o.lines.length - 1),
        /** Every line as MDM or the store named it, with its quantity. */
        lines: o.lines.map((l) => ({ name: l.productName ?? l.product?.name ?? null, product: l.product?.name ?? null, quantity: l.quantity })),
        upsell: o.mdmUpsell,
        creative: o.attribution?.creative ?? null,
        placedAt: o.placedAt,
        wilaya: o.wilaya,
        status: o.status,
        parcelCount: o.parcels.length,
        trackingId: primary?.trackingId ?? null,
        providerStatus: primary?.providerStatus ?? null,
        normalizedStatus: primary?.normalizedStatus ?? null,
        codAmount: o.codAmount,
        currency: o.currency,
        lastProviderUpdateAt: o.parcels.reduce<Date | null>(
          (acc, p) => (p.lastProviderUpdateAt && (!acc || p.lastProviderUpdateAt > acc) ? p.lastProviderUpdateAt : acc),
          null,
        ),
      };
    }),
  };
}

export async function listOrderFacets(ctx: WorkspaceContext) {
  const [wilayas, products, creatives] = await Promise.all([
    db.order.findMany({ where: { workspaceId: ctx.workspaceId, wilaya: { not: null } }, distinct: ["wilaya"], select: { wilaya: true }, orderBy: { wilaya: "asc" } }),
    db.product.findMany({ where: { workspaceId: ctx.workspaceId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.creative.findMany({ where: { workspaceId: ctx.workspaceId }, select: { id: true, externalCreativeId: true, name: true }, orderBy: { externalCreativeId: "asc" } }),
  ]);
  return { wilayas: sortWilayas(wilayas.map((w) => w.wilaya)), products, creatives };
}

export async function getOrderDetails(ctx: WorkspaceContext, id: string) {
  const order = await db.order.findFirst({
    where: { id, workspaceId: ctx.workspaceId },
    include: {
      lines: { include: { product: { select: { id: true, name: true, sku: true } } } },
      attribution: { include: { creative: true } },
      parcels: {
        include: { events: { orderBy: { occurredAt: "asc" } } },
        orderBy: { createdAt: "asc" },
      },
      cashEvents: { orderBy: { occurredAt: "asc" } },
    },
  });
  if (!order) throw new NotFoundError("Order not found");
  const { phoneHash: _hash, customerEncrypted, customerKeyVersion: _version, ...safe } = order;
  void _hash;
  void _version;
  return { ...safe, customer: customerFor(ctx.role, customerEncrypted, ctx.workspaceId) };
}

async function resolveCreative(ctx: WorkspaceContext, utmContent: string | null | undefined, tx: Prisma.TransactionClient) {
  const key = normalizeCreativeKey(utmContent);
  if (!key) return { creativeId: null, key: null };
  const creative = await tx.creative.findFirst({ where: { workspaceId: ctx.workspaceId, normalizedKey: key }, select: { id: true } });
  return { creativeId: creative?.id ?? null, key };
}

export type ManualOrderInput = {
  orderNumber: string;
  placedAt: Date;
  status: OrderStatus;
  wilaya?: string;
  city?: string;
  phone?: string;
  codAmount: number;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  notes?: string;
  lines: { productId: string; quantity: number; unitPrice: number }[];
};

export async function createManualOrder(ctx: WorkspaceContext, input: ManualOrderInput) {
  assertCan(ctx, "orders.write");
  return db.$transaction(async (tx) => {
    const products = await tx.product.findMany({
      where: { workspaceId: ctx.workspaceId, id: { in: input.lines.map((l) => l.productId) } },
    });
    if (products.length !== new Set(input.lines.map((l) => l.productId)).size) throw new NotFoundError("Product not found");
    const byId = new Map(products.map((p) => [p.id, p]));
    const { creativeId, key } = await resolveCreative(ctx, input.utmContent, tx);
    const order = await tx.order.create({
      data: {
        workspaceId: ctx.workspaceId,
        source: "MANUAL",
        externalOrderId: input.orderNumber,
        orderNumber: input.orderNumber,
        normalizedOrderNumber: normalizeReference(input.orderNumber),
        placedAt: input.placedAt,
        status: input.status,
        confirmedAt: input.status === "CONFIRMED" ? new Date() : null,
        canceledAt: input.status === "CANCELED" ? new Date() : null,
        wilaya: wilayaName(input.wilaya),
        city: input.city || null,
        phoneHash: input.phone ? hashPhone(input.phone, ctx.workspaceId) : null,
        phoneMasked: input.phone ? maskPhone(input.phone) : null,
        codAmount: input.codAmount,
        currency: ctx.currency,
        utmSource: input.utmSource || null,
        utmMedium: input.utmMedium || null,
        utmCampaign: input.utmCampaign || null,
        utmContent: input.utmContent || null,
        notes: input.notes || null,
        lines: {
          create: input.lines.map((l) => ({
            workspaceId: ctx.workspaceId,
            productId: l.productId,
            sku: byId.get(l.productId)!.sku,
            productName: byId.get(l.productId)!.name,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            currency: ctx.currency,
          })),
        },
        attribution: {
          create: {
            workspaceId: ctx.workspaceId,
            orderPlacedAt: input.placedAt,
            rawUtmContent: input.utmContent || null,
            normalizedCreativeKey: key,
            creativeId,
            method: creativeId ? "UTM_CONTENT" : "NONE",
            confidence: creativeId ? 1 : 0,
          },
        },
      },
    });
    await audit(ctx, "order.created", { type: "Order", id: order.id }, { orderNumber: order.orderNumber, source: "MANUAL" }, tx);
    return order;
  });
}

export async function updateOrderStatus(ctx: WorkspaceContext, input: { id: string; status: OrderStatus }) {
  assertCan(ctx, "orders.write");
  const order = await db.order.findFirst({ where: { id: input.id, workspaceId: ctx.workspaceId } });
  if (!order) throw new NotFoundError("Order not found");
  const updated = await db.order.update({
    where: { id: order.id },
    data: {
      status: input.status,
      confirmedAt: input.status === "CONFIRMED" ? order.confirmedAt ?? new Date() : input.status === "PENDING" ? null : order.confirmedAt,
      canceledAt: input.status === "CANCELED" ? new Date() : null,
    },
    // Never the phone hash or the encrypted customer.
    select: { id: true, orderNumber: true, status: true, confirmedAt: true, canceledAt: true },
  });
  await audit(ctx, "order.status_changed", { type: "Order", id: order.id }, { from: order.status, to: input.status });
  return updated;
}

export async function deleteOrder(ctx: WorkspaceContext, id: string) {
  assertCan(ctx, "orders.write");
  const order = await db.order.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!order) throw new NotFoundError("Order not found");
  await db.order.delete({ where: { id: order.id } });
  await audit(ctx, "order.deleted", { type: "Order", id: order.id }, { orderNumber: order.orderNumber, source: order.source });
}

/** Manually link a parcel (by tracking ID, same workspace) to an order. */
export async function manualMatchParcel(ctx: WorkspaceContext, input: { orderId: string; trackingId: string }) {
  assertCan(ctx, "orders.match");
  return db.$transaction(async (tx) => {
    const order = await tx.order.findFirst({ where: { id: input.orderId, workspaceId: ctx.workspaceId } });
    if (!order) throw new NotFoundError("Order not found");
    const parcel = await tx.parcel.findFirst({ where: { workspaceId: ctx.workspaceId, trackingId: input.trackingId.trim() } });
    if (!parcel) throw new NotFoundError("No parcel with that tracking ID in this workspace");
    const updated = await tx.parcel.update({
      where: { id: parcel.id },
      data: { orderId: order.id, matchMethod: "MANUAL", matchConfidence: 1 },
    });
    await tx.unmatchedRecord.updateMany({
      where: { workspaceId: ctx.workspaceId, parcelId: parcel.id, status: "OPEN" },
      data: { status: "RESOLVED", resolvedAt: new Date(), resolvedById: ctx.userId },
    });
    await audit(ctx, "parcel.manual_match", { type: "Parcel", id: parcel.id }, { orderId: order.id, previousOrderId: parcel.orderId, trackingId: parcel.trackingId }, tx);
    return updated;
  });
}

export async function unlinkParcel(ctx: WorkspaceContext, parcelId: string) {
  assertCan(ctx, "orders.match");
  const parcel = await db.parcel.findFirst({ where: { id: parcelId, workspaceId: ctx.workspaceId } });
  if (!parcel) throw new NotFoundError("Parcel not found");
  await db.$transaction(async (tx) => {
    await tx.parcel.update({ where: { id: parcel.id }, data: { orderId: null, matchMethod: "NONE", matchConfidence: 0 } });
    await tx.unmatchedRecord.upsert({
      where: { workspaceId_provider_entityType_externalId: { workspaceId: ctx.workspaceId, provider: parcel.provider, entityType: "parcel", externalId: parcel.trackingId } },
      create: { workspaceId: ctx.workspaceId, provider: parcel.provider, entityType: "parcel", externalId: parcel.trackingId, reference: parcel.providerReference, reason: "Manually unlinked", parcelId: parcel.id },
      update: { status: "OPEN", reason: "Manually unlinked", resolvedAt: null, resolvedById: null },
    });
    await audit(ctx, "parcel.manual_unlink", { type: "Parcel", id: parcel.id }, { orderId: parcel.orderId, trackingId: parcel.trackingId }, tx);
  });
}
