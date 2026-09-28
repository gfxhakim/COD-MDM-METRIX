import type { AdPlatform, NormalizedStatus, OrderStatus, Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { CONFIRMING_STATES, normalizeProviderStatus } from "@/domain/statusMapping";
import { normalizeCreativeKey, normalizeReference } from "@/lib/normalize";
import { hashPhone } from "@/lib/pii";
import { reconcileOrderStatuses } from "./statuses";
import type { MdmOrder, MdmUtm } from "./types";

type ProductRef = { id: string; sku: string; name: string; salePrice: number | null; active: boolean };

/** Loaded once per sync; `creatives` grows as the sync creates creatives for new content IDs. */
export type OrderSyncEnv = {
  workspaceId: string;
  overrides: Record<string, NormalizedStatus>;
  products: ProductRef[];
  creatives: Map<string, string>;
};

export async function loadOrderSyncEnv(workspaceId: string, overrides: Record<string, NormalizedStatus>): Promise<OrderSyncEnv> {
  const [products, creatives] = await Promise.all([
    db.product.findMany({ where: { workspaceId }, select: { id: true, sku: true, name: true, active: true, costVersions: { orderBy: { effectiveFrom: "desc" }, take: 1, select: { salePrice: true } } } }),
    db.creative.findMany({ where: { workspaceId }, select: { id: true, normalizedKey: true } }),
  ]);
  return {
    workspaceId,
    overrides,
    products: products.map((p) => ({ id: p.id, sku: p.sku, name: p.name, active: p.active, salePrice: p.costVersions[0]?.salePrice ?? null })),
    creatives: new Map(creatives.map((c) => [c.normalizedKey, c.id])),
  };
}

/** How an MDM order counts: canceled (even after confirming), confirmed once past the call center, else pending. */
export function orderStatusFor(o: Pick<MdmOrder, "status" | "confirmed">, overrides: Record<string, NormalizedStatus>): { status: OrderStatus; normalized: NormalizedStatus } {
  const normalized = normalizeProviderStatus(o.status, overrides);
  if (normalized === "CANCELED") return { status: "CANCELED", normalized };
  if (CONFIRMING_STATES.includes(normalized)) return { status: "CONFIRMED", normalized };
  if (normalized === "UNKNOWN" && o.confirmed) return { status: "CONFIRMED", normalized };
  return { status: "PENDING", normalized };
}

/**
 * Orders on this page whose content ID can only come from their MDM status history:
 * no utm_content on the order, and never looked up before for an order we already hold.
 */
export async function ordersNeedingHistory(workspaceId: string, orders: MdmOrder[]): Promise<Set<string>> {
  const candidates = orders.filter((o) => !o.utm.content).map((o) => o.trackingId);
  if (!candidates.length) return new Set();
  const known = await db.order.findMany({
    where: { workspaceId, mdmOrderId: { in: candidates }, OR: [{ utmContent: { not: null } }, { mdmHistoryCheckedAt: { not: null } }] },
    select: { mdmOrderId: true },
  });
  const skip = new Set(known.map((k) => k.mdmOrderId));
  return new Set(candidates.filter((id) => !skip.has(id)));
}

type Line = { productId: string | null; sku: string | null; productName: string | null; quantity: number; unitPrice: number };

/**
 * MDM products are matched to the workspace's products by SKU (MDM product ID) or name.
 * A workspace selling a single active product gets every unmatched line linked to it,
 * so its costs count even when MDM names the product differently.
 */
function mapLines(o: MdmOrder, products: ProductRef[]): Line[] {
  const bySku = new Map(products.map((p) => [p.sku.toLowerCase(), p]));
  const byName = new Map(products.map((p) => [p.name.toLowerCase(), p]));
  const active = products.filter((p) => p.active);
  const only = active.length === 1 ? active[0] : null;
  return o.products.map((l) => {
    const product =
      (l.ref && bySku.get(l.ref.toLowerCase())) || (l.variantOf && bySku.get(l.variantOf.toLowerCase())) || (l.name && (bySku.get(l.name.toLowerCase()) ?? byName.get(l.name.toLowerCase()))) || only;
    return { productId: product?.id ?? null, sku: product?.sku ?? null, productName: l.name ?? product?.name ?? null, quantity: l.quantity, unitPrice: l.unitPrice ?? product?.salePrice ?? 0 };
  });
}

const lineSig = (lines: { productId: string | null; sku: string | null; productName: string | null; quantity: number; unitPrice: number }[]) =>
  JSON.stringify(lines.map((l) => JSON.stringify([l.productId, l.sku, l.productName, l.quantity, l.unitPrice])).sort());

function platformOf(source: string | null): AdPlatform {
  if (!source) return "META";
  if (/tik/i.test(source)) return "TIKTOK";
  if (/^(fb|ig|facebook|instagram|meta|an|msg|messenger)$/i.test(source.trim())) return "META";
  return "OTHER";
}

/**
 * The creative a content ID belongs to, created on first sight so orders show under it
 * before any ad spend is imported. A later spend import with the same ad ID reuses it.
 */
async function ensureCreative(env: OrderSyncEnv, key: string, utm: MdmUtm, lines: Line[]): Promise<string> {
  const known = env.creatives.get(key);
  if (known) return known;
  const products = [...new Set(lines.map((l) => l.productId).filter((p): p is string => !!p))];
  const platform = platformOf(utm.source);
  const external = utm.content!.trim().slice(0, 200);
  const c = await db.creative.upsert({
    where: { workspaceId_platform_externalCreativeId: { workspaceId: env.workspaceId, platform, externalCreativeId: external } },
    create: { workspaceId: env.workspaceId, platform, externalCreativeId: external, normalizedKey: key, campaignName: utm.campaign, productId: products.length === 1 ? products[0] : null },
    update: {},
    select: { id: true },
  });
  env.creatives.set(key, c.id);
  return c.id;
}

const orderInclude = { attribution: true, lines: true } as const satisfies Prisma.OrderInclude;
type ExistingOrder = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

/** A store order imported from a CSV, found by the store order ID MDM holds. Ambiguous matches are never guessed. */
async function findStoreOrder(tx: Prisma.TransactionClient, workspaceId: string, externalId: string): Promise<ExistingOrder | null> {
  const exact = await tx.order.findMany({ where: { workspaceId, mdmOrderId: null, externalOrderId: externalId }, include: orderInclude, take: 2 });
  if (exact.length) return exact.length === 1 ? exact[0] : null;
  const ref = normalizeReference(externalId);
  if (!ref) return null;
  const byNumber = await tx.order.findMany({ where: { workspaceId, mdmOrderId: null, normalizedOrderNumber: ref }, include: orderInclude, take: 2 });
  return byNumber.length === 1 ? byNumber[0] : null;
}

function same(a: unknown, b: unknown) {
  if (a instanceof Date || b instanceof Date) return (a as Date | null)?.getTime() === (b as Date | null)?.getTime();
  return a === b;
}

export type OrderOutcome = { counter: "added" | "updated" | "unchanged"; orderId: string; hasContent: boolean; linkedParcels: number };

/**
 * Save one MDM order. New orders are created with source MDM Express. An order already
 * imported from the store keeps its lines and amounts, and only gains what it lacks
 * (content ID, hashed phone, wilaya) plus MDM's status. The customer's name, address and
 * IP are never stored; the phone is kept only as a salted hash.
 */
export async function upsertMdmOrder(env: OrderSyncEnv, jobId: string, o: MdmOrder, history: MdmUtm | null, historyChecked: boolean): Promise<OrderOutcome> {
  const ws = env.workspaceId;
  const fresh: MdmUtm = o.utm.content || !history?.content ? o.utm : { source: o.utm.source ?? history.source, medium: o.utm.medium ?? history.medium, campaign: o.utm.campaign ?? history.campaign, content: history.content };
  const lines = mapLines(o, env.products);
  const { status, normalized } = orderStatusFor(o, env.overrides);
  const find = async (tx: Prisma.TransactionClient) =>
    (await tx.order.findFirst({ where: { workspaceId: ws, mdmOrderId: o.trackingId }, include: orderInclude })) ?? (o.externalId ? await findStoreOrder(tx, ws, o.externalId) : null);
  // Store orders keep their own content ID; the sync only fills one in when they have none.
  const takesUtm = (e: ExistingOrder | null) => !e || e.source === "MDM_EXPRESS" || !e.utmContent;
  const pre = await find(db);
  // A content ID found earlier (e.g. in the status history) is kept when MDM sends the order again without one.
  const utm: MdmUtm = !fresh.content && pre?.utmContent ? { source: pre.utmSource, medium: pre.utmMedium, campaign: pre.utmCampaign, content: pre.utmContent } : fresh;
  const key = takesUtm(pre) ? normalizeCreativeKey(utm.content) || null : null;
  const creativeId = key ? await ensureCreative(env, key, utm, lines) : null;

  return db.$transaction(async (tx) => {
    const existing = await find(tx);
    const statusAt = o.statusAt ?? o.placedAt;
    const statusData =
      status === "CANCELED"
        ? { status, confirmedAt: null, canceledAt: existing?.status === "CANCELED" && existing.canceledAt ? existing.canceledAt : statusAt }
        : status === "CONFIRMED"
          ? { status, confirmedAt: existing?.confirmedAt ?? (normalized === "CONFIRMED" ? statusAt : o.placedAt), canceledAt: null }
          : { status, confirmedAt: null, canceledAt: null };
    // Only the salted hash is kept (it spots repeat customers); not even a masked copy of the number.
    const phone = { phoneHash: o.phone ? hashPhone(o.phone, ws) : null };
    const utmData = { utmSource: utm.source, utmMedium: utm.medium, utmCampaign: utm.campaign, utmContent: utm.content };
    const checked = historyChecked ? { mdmHistoryCheckedAt: new Date() } : {};
    const attribution = { rawUtmContent: utm.content, normalizedCreativeKey: key, creativeId, method: creativeId ? ("UTM_CONTENT" as const) : ("NONE" as const), confidence: creativeId ? 1 : 0 };

    let orderId: string;
    let counter: OrderOutcome["counter"];
    let hasContent: boolean;
    if (!existing) {
      const number = o.externalId ?? o.trackingId;
      const created = await tx.order.create({
        data: {
          workspaceId: ws,
          source: "MDM_EXPRESS",
          externalOrderId: o.trackingId,
          mdmOrderId: o.trackingId,
          orderNumber: number,
          normalizedOrderNumber: normalizeReference(number) || normalizeReference(o.trackingId) || o.trackingId,
          placedAt: o.placedAt,
          ...statusData,
          ...phone,
          wilaya: o.wilaya,
          city: o.city,
          codAmount: o.total ?? lines.reduce((a, l) => a + l.quantity * l.unitPrice, 0),
          currency: o.currency,
          ...utmData,
          ...checked,
          lines: { create: lines.map((l) => ({ workspaceId: ws, ...l, currency: o.currency })) },
          attribution: { create: { workspaceId: ws, orderPlacedAt: o.placedAt, ...attribution } },
        },
      });
      orderId = created.id;
      counter = "added";
      hasContent = !!utm.content;
    } else {
      orderId = existing.id;
      const fromMdm = existing.source === "MDM_EXPRESS";
      const fillUtm = fromMdm || (takesUtm(existing) && !!utm.content);
      const data: Prisma.OrderUncheckedUpdateInput = {
        mdmOrderId: o.trackingId,
        ...statusData,
        ...(fromMdm
          ? { placedAt: o.placedAt, ...phone, wilaya: o.wilaya, city: o.city, codAmount: o.total ?? existing.codAmount, currency: o.currency }
          : {
              ...(!existing.phoneHash && o.phone ? phone : {}),
              ...(!existing.wilaya && o.wilaya ? { wilaya: o.wilaya, city: o.city } : {}),
            }),
        ...(fillUtm ? utmData : {}),
      };
      const changed = Object.entries(data).some(([k, v]) => !same(existing[k as keyof typeof existing], v));
      if (changed || historyChecked) await tx.order.update({ where: { id: existing.id }, data: { ...data, ...checked } });
      let linesChanged = false;
      if (fromMdm && lineSig(existing.lines) !== lineSig(lines)) {
        await tx.orderLine.deleteMany({ where: { orderId: existing.id } });
        await tx.orderLine.createMany({ data: lines.map((l) => ({ workspaceId: ws, orderId: existing.id, ...l, currency: o.currency })) });
        linesChanged = true;
      }
      // Attributions someone set by hand are never changed.
      let attributionChanged = false;
      if (fillUtm && existing.attribution?.method !== "MANUAL") {
        const a = existing.attribution;
        if (!a || a.rawUtmContent !== attribution.rawUtmContent || a.creativeId !== attribution.creativeId || !same(a.orderPlacedAt, o.placedAt)) {
          await tx.attribution.upsert({
            where: { orderId: existing.id },
            create: { workspaceId: ws, orderId: existing.id, orderPlacedAt: fromMdm ? o.placedAt : existing.placedAt, ...attribution },
            update: { ...attribution, ...(fromMdm ? { orderPlacedAt: o.placedAt } : {}) },
          });
          attributionChanged = true;
        }
      }
      counter = changed || linesChanged || attributionChanged ? "updated" : "unchanged";
      hasContent = !!(fillUtm ? utm.content : existing.utmContent);
    }

    // Parcels MDM says belong to this order, synced before the order was.
    const loose = await tx.parcel.findMany({ where: { workspaceId: ws, mdmOrderId: o.trackingId, orderId: null }, select: { id: true } });
    if (loose.length) {
      const ids = loose.map((p) => p.id);
      await tx.parcel.updateMany({ where: { id: { in: ids } }, data: { orderId, matchMethod: "MDM_ORDER", matchConfidence: 1 } });
      await tx.unmatchedRecord.updateMany({ where: { workspaceId: ws, parcelId: { in: ids }, status: "OPEN" }, data: { status: "RESOLVED", resolvedAt: new Date() } });
    }
    await reconcileOrderStatuses(tx, ws, [orderId]);

    if (counter !== "unchanged") await tx.syncItem.create({ data: { workspaceId: ws, jobId, entityType: "order", providerId: o.trackingId.slice(0, 200), localId: orderId, result: counter === "added" ? "ADDED" : "UPDATED" } });
    return { counter, orderId, hasContent, linkedParcels: loose.length };
  });
}
