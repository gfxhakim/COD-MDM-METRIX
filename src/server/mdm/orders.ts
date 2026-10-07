import type { AdPlatform, NormalizedStatus, OrderStatus, Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { CONFIRMING_STATES, normalizeProviderStatus } from "@/domain/statusMapping";
import { normalizeCreativeKey, normalizeReference } from "@/lib/normalize";
import { hashPhone } from "@/lib/pii";
import { customerKey, normalizeCustomer, openCustomer, sealCustomer } from "@/server/customers";
import { reconcileOrderStatuses } from "./statuses";
import type { MdmOrder, MdmOrdersPage, MdmUtm } from "./types";

type ProductRef = { id: string; sku: string; name: string; salePrice: number | null; active: boolean; fromMdm: boolean };

/**
 * Loaded once per sync. `creatives` grows as the sync creates creatives for new content IDs,
 * and `products` and `mdmLinks` as it links or creates products for MDM products.
 */
export type OrderSyncEnv = {
  workspaceId: string;
  overrides: Record<string, NormalizedStatus>;
  products: ProductRef[];
  creatives: Map<string, string>;
  /** MDM product ID → the product it counts as in the app. */
  mdmLinks: Map<string, string>;
  /** Product names from MDM's stock list, by MDM product ID: an order line may only carry a variant's name. */
  stockNames: Map<string, string>;
};

export async function loadOrderSyncEnv(workspaceId: string, overrides: Record<string, NormalizedStatus>): Promise<OrderSyncEnv> {
  const [products, creatives, links, stock] = await Promise.all([
    db.product.findMany({ where: { workspaceId }, select: { id: true, sku: true, name: true, active: true, fromMdm: true, costVersions: { orderBy: { effectiveFrom: "desc" }, take: 1, select: { salePrice: true } } } }),
    db.creative.findMany({ where: { workspaceId }, select: { id: true, normalizedKey: true } }),
    db.mdmProductLink.findMany({ where: { workspaceId }, select: { mdmProductId: true, productId: true } }),
    db.mdmStockItem.findMany({ where: { workspaceId }, distinct: ["mdmProductId"], select: { mdmProductId: true, productName: true } }),
  ]);
  return {
    workspaceId,
    overrides,
    products: products.map((p) => ({ id: p.id, sku: p.sku, name: p.name, active: p.active, fromMdm: p.fromMdm, salePrice: p.costVersions[0]?.salePrice ?? null })),
    creatives: new Map(creatives.map((c) => [c.normalizedKey, c.id])),
    mdmLinks: new Map(links.map((l) => [l.mdmProductId, l.productId])),
    stockNames: new Map(stock.map((x) => [x.mdmProductId, x.productName])),
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

type Line = { productId: string | null; sku: string | null; productName: string | null; quantity: number; unitPrice: number; mdmProductId: string | null; mdmVariantId: string | null };

const mdmId = (v: string | null) => v?.trim().slice(0, 100) || null;

/** A product whose SKU is one of `skus` (MDM product or variant ID, or name), else whose name is `name`. */
function matchProduct(products: ProductRef[], skus: (string | null)[], name: string | null) {
  const bySku = new Map(products.map((p) => [p.sku.toLowerCase(), p]));
  for (const k of skus) if (k && bySku.has(k.toLowerCase())) return bySku.get(k.toLowerCase())!;
  return name ? (products.find((p) => p.name.toLowerCase() === name.toLowerCase()) ?? null) : null;
}

/** A product made for an MDM product nobody has set up yet. Its costs are filled in on the Products page. */
async function createMdmProduct(env: OrderSyncEnv, id: string, name: string | null, currency: string): Promise<ProductRef> {
  const taken = new Set(env.products.map((p) => p.sku.toLowerCase()));
  const base = id.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 60) || "MDM";
  let sku = base;
  for (let n = 2; taken.has(sku.toLowerCase()); n++) sku = `${base}-${n}`;
  const p = await db.product.create({
    data: { workspaceId: env.workspaceId, name: (env.stockNames.get(id) ?? name ?? `MDM product ${id}`).slice(0, 120), sku, currency, fromMdm: true },
    select: { id: true, sku: true, name: true, active: true },
  });
  const ref: ProductRef = { ...p, fromMdm: true, salePrice: null };
  env.products.push(ref);
  return ref;
}

/**
 * The product an MDM product counts as. The first time MDM sends it, it is linked for good (an owner
 * can move it on the Products page) to: a product whose SKU or name matches it; else, while the
 * workspace sells one product that no MDM product counts as yet, that product, so the costs already
 * entered keep counting; else a new product created for it.
 */
async function productForMdm(env: OrderSyncEnv, id: string, line: MdmOrder["products"][number], currency: string): Promise<ProductRef> {
  const linked = env.mdmLinks.get(id);
  const known = linked ? env.products.find((p) => p.id === linked) : undefined;
  if (known) return known;
  const active = env.products.filter((p) => p.active);
  const taken = new Set(env.mdmLinks.values());
  const product =
    matchProduct(env.products, [id, line.ref, line.name], line.name) ??
    (active.length === 1 && !active[0].fromMdm && !taken.has(active[0].id) ? active[0] : null) ??
    (await createMdmProduct(env, id, line.name, currency));
  await db.mdmProductLink.upsert({
    where: { workspaceId_mdmProductId: { workspaceId: env.workspaceId, mdmProductId: id } },
    create: { workspaceId: env.workspaceId, mdmProductId: id, productId: product.id, mdmName: line.name?.slice(0, 200) ?? null },
    update: {},
  });
  env.mdmLinks.set(id, product.id);
  return product;
}

/**
 * The order's lines, each with the product it counts for. Lines carrying an MDM product ID go
 * through `productForMdm`; a line without one goes to a product matching its name, or to the
 * workspace's single active product so its costs still count.
 */
async function resolveLines(env: OrderSyncEnv, o: MdmOrder): Promise<Line[]> {
  const lines: Line[] = [];
  for (const l of o.products) {
    const mdmProductId = mdmId(l.variantOf ?? l.ref);
    const active = env.products.filter((p) => p.active);
    const product = mdmProductId ? await productForMdm(env, mdmProductId, l, o.currency) : (matchProduct(env.products, [l.name], l.name) ?? (active.length === 1 ? active[0] : null));
    lines.push({
      productId: product?.id ?? null,
      sku: product?.sku ?? null,
      productName: l.name ?? product?.name ?? null,
      quantity: l.quantity,
      unitPrice: l.unitPrice ?? product?.salePrice ?? 0,
      mdmProductId,
      mdmVariantId: l.variantOf ? mdmId(l.ref) : null,
    });
  }
  return lines;
}

const lineSig = (lines: Omit<Line, "mdmVariantId">[]) => JSON.stringify(lines.map((l) => JSON.stringify([l.productId, l.sku, l.productName, l.quantity, l.unitPrice, l.mdmProductId])).sort());

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
 * (content ID, hashed phone, wilaya) plus MDM's status and customer details. The customer's
 * name, phones and street address are stored encrypted (src/server/customers.ts); the IP
 * is never stored.
 */
export async function upsertMdmOrder(env: OrderSyncEnv, jobId: string, o: MdmOrder, history: MdmUtm | null, historyChecked: boolean): Promise<OrderOutcome> {
  const ws = env.workspaceId;
  const fresh: MdmUtm = o.utm.content || !history?.content ? o.utm : { source: o.utm.source ?? history.source, medium: o.utm.medium ?? history.medium, campaign: o.utm.campaign ?? history.campaign, content: history.content };
  const lines = await resolveLines(env, o);
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
    // MDM's own status word is kept as sent, so exports can show and filter it exactly.
    const mdm = { mdmStatus: o.status, mdmStatusAt: o.statusAt };
    const statusData =
      status === "CANCELED"
        ? { status, ...mdm, confirmedAt: null, canceledAt: existing?.status === "CANCELED" && existing.canceledAt ? existing.canceledAt : statusAt }
        : status === "CONFIRMED"
          ? { status, ...mdm, confirmedAt: existing?.confirmedAt ?? (normalized === "CONFIRMED" ? statusAt : o.placedAt), canceledAt: null }
          : { status, ...mdm, confirmedAt: null, canceledAt: null };
    // The salted hash spots repeat customers and finds orders by phone; the number itself is only in the encrypted customer.
    const phone = { phoneHash: o.phone ? hashPhone(o.phone, ws) : null };
    const customer = normalizeCustomer({ name: o.customer?.name, phone: o.phone, phone2: o.customer?.phone2, address: o.customer?.address });
    // Details MDM leaves out on a later read are kept rather than cleared.
    const details = { ...(o.deliveryType ? { deliveryType: o.deliveryType } : {}), ...(o.storeName ? { storeName: o.storeName } : {}) };
    const sealed = (e: ExistingOrder | null) => (!customer || (e && customerKey(openCustomer(e.customerEncrypted, ws)) === customerKey(customer)) ? {} : sealCustomer(customer, ws));
    const utmData = { utmSource: utm.source, utmMedium: utm.medium, utmCampaign: utm.campaign, utmContent: utm.content };
    const checked = historyChecked ? { mdmHistoryCheckedAt: new Date() } : {};
    const upsell = typeof o.upsell === "boolean" ? { mdmUpsell: o.upsell } : {};
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
          ...sealed(null),
          ...details,
          wilaya: o.wilaya,
          city: o.city,
          codAmount: o.total ?? lines.reduce((a, l) => a + l.quantity * l.unitPrice, 0),
          currency: o.currency,
          ...utmData,
          ...checked,
          ...upsell,
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
        ...sealed(existing),
        ...details,
        ...(fromMdm
          ? { placedAt: o.placedAt, ...phone, wilaya: o.wilaya, city: o.city, codAmount: o.total ?? existing.codAmount, currency: o.currency }
          : {
              ...(!existing.phoneHash && o.phone ? phone : {}),
              ...(!existing.wilaya && o.wilaya ? { wilaya: o.wilaya, city: o.city } : {}),
            }),
        ...(fillUtm ? utmData : {}),
        ...upsell,
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

/** Pages of MDM's upsell search read per sync, at most. */
const UPSELL_PAGES = 50;

/**
 * Marks the orders MDM's call center upsold. MDM's order doesn't say so itself, but its order search
 * filters on it, so the sync reads the upsold orders changed since the last sync (all of them on a
 * full sync, which also clears the mark from orders MDM no longer counts as upsold). If MDM answers
 * the filtered search with as many orders as the plain one, it ignored the filter and nothing changes.
 */
export async function syncUpsells(workspaceId: string, read: (cursor: string | null) => Promise<MdmOrdersPage>, o: { full: boolean; plainTotal: number | null }) {
  const ids = new Set<string>();
  let cursor: string | null = null;
  for (let n = 0; n < UPSELL_PAGES; n++) {
    const page = await read(cursor);
    if (n === 0 && page.total != null && o.plainTotal != null && o.plainTotal >= 20 && page.total >= o.plainTotal) return { marked: 0, ignored: true };
    for (const x of page.items) ids.add(x.trackingId);
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  const list = [...ids];
  if (o.full) await db.order.updateMany({ where: { workspaceId, mdmUpsell: true }, data: { mdmUpsell: false } });
  for (let i = 0; i < list.length; i += 500) await db.order.updateMany({ where: { workspaceId, mdmOrderId: { in: list.slice(i, i + 500) } }, data: { mdmUpsell: true } });
  return { marked: list.length, ignored: false };
}
