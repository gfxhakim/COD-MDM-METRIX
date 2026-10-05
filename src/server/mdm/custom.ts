import type { NormalizedStatus } from "@prisma/client";
import { matchesCustomSync, MDM_STATUS_ORDER, textKey, type CustomSyncChoices, type CustomSyncFilters } from "@/domain/customSync";
import { STATUS_GROUPS, statusGroupOf } from "@/domain/orderExport";
import { normalizeProviderStatus, providerStatusLabel, statusKey } from "@/domain/statusMapping";
import { normalizeReference } from "@/lib/normalize";
import { dayRange } from "@/lib/zonedDays";
import { db } from "@/server/db";
import { orderStatusSelect, resolveStatus } from "@/server/exports/orders";
import type { WorkspaceContext } from "@/server/tenancy";
import { orderStatusFor } from "./orders";
import { workspaceStatusOverrides } from "./statuses";
import type { MdmOrder, MdmOrderFilters } from "./types";

/**
 * Custom syncs (src/domain/customSync.ts): what to ask MDM for, and which of the orders it
 * sends back to keep. MDM narrows the read where its search allows (dates, delivery type,
 * order IDs); everything is then checked here, so the result is the same when MDM ignores
 * or refuses a filter, only slower.
 */

/** Orders whose parcels are read in one request. */
export const PARCEL_BATCH = 100;

/** Turn the panel's choices into what the job keeps: days become instants, typed order numbers are looked up. */
export async function resolveCustomSync(workspaceId: string, input: CustomSyncChoices): Promise<CustomSyncFilters> {
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { timezone: true } });
  const range = dayRange(input, ws.timezone);
  const list = <T,>(v: T[] | undefined) => (v?.length ? [...new Set(v)] : undefined);
  const orderIds = list(input.orderIds);
  let mdmOrderIds: string[] | undefined;
  if (orderIds) {
    const refs = orderIds.map((id) => normalizeReference(id)).filter((r): r is string => !!r);
    const local = await db.order.findMany({
      where: { workspaceId, mdmOrderId: { not: null }, OR: [{ mdmOrderId: { in: orderIds } }, { externalOrderId: { in: orderIds } }, { orderNumber: { in: orderIds } }, { normalizedOrderNumber: { in: refs } }] },
      select: { mdmOrderId: true },
      take: 500,
    });
    mdmOrderIds = list(local.map((o) => o.mdmOrderId!));
  }
  return {
    from: input.from,
    to: input.to,
    dateField: input.dateField,
    groups: list(input.groups),
    statuses: list(input.statuses?.map(statusKey)),
    wilayas: list(input.wilayas),
    deliveryType: input.deliveryType,
    stores: list(input.stores),
    products: list(input.products),
    ad: input.ad,
    orderIds,
    parcels: input.parcels,
    fromAt: range.from?.toISOString(),
    toAt: range.to?.toISOString(),
    mdmOrderIds,
  };
}

/**
 * The order searches a custom sync runs, one after the other. Named orders are looked up by
 * MDM order ID, then by store order ID. After MDM refused the filters, orders changed since
 * the start day are read instead (an order placed or moved since then was changed since then).
 */
export function customOrderPlan(f: CustomSyncFilters): { updatedSince: Date | null; passes: MdmOrderFilters[] } {
  if (f.fallbackOrders) return { updatedSince: f.fromAt ? new Date(f.fromAt) : null, passes: [{}] };
  if (f.orderIds?.length) {
    const typed = [...new Set(f.orderIds.flatMap((id) => (id.startsWith("#") ? [id, id.slice(1)] : [id])))];
    return { updatedSince: null, passes: [{ trackingIds: [...new Set([...(f.mdmOrderIds ?? []), ...typed])] }, { externalIds: typed }] };
  }
  const range = f.fromAt || f.toAt ? { start: f.fromAt ? new Date(f.fromAt) : undefined, end: f.toAt ? new Date(f.toAt) : undefined } : undefined;
  return {
    updatedSince: null,
    passes: [{ ...(range ? (f.dateField === "status" ? { statusDate: range } : { createdAt: range }) : {}), ...(f.deliveryType ? { isStopDesk: f.deliveryType === "STOP_DESK" } : {}) }],
  };
}

/** Parcels read unfiltered (after MDM ignored or refused the order filter): those changed since the start day. */
export const customParcelsSince = (f: CustomSyncFilters) => (f.fromAt ? new Date(f.fromAt) : null);

/** A custom sync's resumable position: which search (or batch) it is on, and MDM's page cursor in it. */
export function readStep(cursor: string | null): { step: number; page: string | null } {
  if (!cursor) return { step: 0, page: null };
  try {
    const v = JSON.parse(cursor) as { s?: unknown; p?: unknown };
    return { step: typeof v.s === "number" && v.s >= 0 ? v.s : 0, page: typeof v.p === "string" ? v.p : null };
  } catch {
    return { step: 0, page: null };
  }
}
export const writeStep = (step: number, page: string | null) => JSON.stringify({ s: step, p: page });

/**
 * Which orders on a page match. Each order is judged on what MDM sends now and on what the
 * app shows for it now, so picking a status also refreshes the orders sitting in it.
 * `seen` drops orders an earlier search of this sync already handled.
 */
export async function pickCustomOrders(workspaceId: string, jobId: string, f: CustomSyncFilters, items: MdmOrder[], overrides: Record<string, NormalizedStatus>, dropSeen: boolean) {
  if (!items.length) return { matched: [] as MdmOrder[], skipped: 0 };
  const ids = items.map((o) => o.trackingId);
  const [stored, seen] = await Promise.all([
    db.order.findMany({ where: { workspaceId, mdmOrderId: { in: ids } }, select: { mdmOrderId: true, utmContent: true, ...orderStatusSelect } }),
    dropSeen ? db.syncItem.findMany({ where: { workspaceId, jobId, entityType: "order", providerId: { in: ids } }, select: { providerId: true } }) : Promise.resolve([]),
  ]);
  const byId = new Map(stored.map((s) => [s.mdmOrderId!, s]));
  const done = new Set(seen.map((s) => s.providerId));
  const matched: MdmOrder[] = [];
  let skipped = 0;
  for (const o of items) {
    if (done.has(o.trackingId)) continue;
    const local = byId.get(o.trackingId);
    const now = resolveStatus({ status: orderStatusFor(o, overrides).status, placedAt: o.placedAt, confirmedAt: null, canceledAt: null, mdmStatus: o.status, mdmStatusAt: o.statusAt, parcels: [] }, overrides);
    const statuses = [now, ...(local ? [resolveStatus(local, overrides)] : [])];
    const ok = matchesCustomSync(f, {
      trackingId: o.trackingId,
      externalId: o.externalId,
      placedAt: o.placedAt,
      statusAt: o.statusAt,
      statuses,
      wilaya: o.wilaya,
      deliveryType: o.deliveryType ?? null,
      storeName: o.storeName ?? null,
      productNames: o.products.map((p) => p.name).filter((n): n is string => !!n),
      hasAd: !!o.utm.content || !!local?.utmContent,
    });
    if (ok) matched.push(o);
    else skipped++;
  }
  return { matched, skipped };
}

/** MDM order IDs a custom sync kept, in a stable order so parcel batches resume where they stopped. */
export async function matchedOrderIds(workspaceId: string, jobId: string): Promise<string[]> {
  const rows = await db.syncItem.groupBy({ by: ["providerId"], where: { workspaceId, jobId, entityType: "order", result: { in: ["ADDED", "UPDATED", "UNCHANGED"] } }, orderBy: { providerId: "asc" } });
  return rows.map((r) => r.providerId);
}

/** Whether any of these orders is past the warehouse, so it should have a parcel at MDM. */
export async function anyShipped(workspaceId: string, mdmOrderIds: string[], overrides: Record<string, NormalizedStatus>): Promise<boolean> {
  for (let i = 0; i < mdmOrderIds.length; i += 500) {
    const rows = await db.order.findMany({ where: { workspaceId, mdmOrderId: { in: mdmOrderIds.slice(i, i + 500) }, mdmStatus: { not: null } }, select: { mdmStatus: true } });
    if (rows.some((r) => ["carrier", "delivered", "returns"].includes(statusGroupOf(normalizeProviderStatus(r.mdmStatus, overrides))))) return true;
  }
  return false;
}

// ---------------------------------------------------------------- panel options

/** What the custom sync panel offers: MDM's statuses by group, and the wilayas, stores and products seen in MDM orders. */
export async function customSyncOptions(ctx: WorkspaceContext) {
  const workspaceId = ctx.workspaceId;
  const mdm = { workspaceId, source: "MDM_EXPRESS" as const };
  const [overrides, orderStatuses, parcelStatuses, wilayas, stores, products] = await Promise.all([
    workspaceStatusOverrides(workspaceId),
    db.order.groupBy({ by: ["mdmStatus"], where: { workspaceId, mdmStatus: { not: null } } }),
    db.parcel.groupBy({ by: ["providerStatus"], where: { workspaceId, providerStatus: { not: null } } }),
    db.order.groupBy({ by: ["wilaya"], where: { ...mdm, wilaya: { not: null } }, orderBy: { wilaya: "asc" } }),
    db.order.groupBy({ by: ["storeName"], where: { ...mdm, storeName: { not: null } }, orderBy: { storeName: "asc" } }),
    db.orderLine.groupBy({ by: ["productName"], where: { workspaceId, productName: { not: null }, order: { source: "MDM_EXPRESS" } }, orderBy: { productName: "asc" } }),
  ]);
  const keys = new Set([...MDM_STATUS_ORDER, ...Object.keys(overrides)]);
  for (const r of orderStatuses) keys.add(statusKey(r.mdmStatus!));
  for (const r of parcelStatuses) keys.add(statusKey(r.providerStatus!));
  const rank = (k: string) => (MDM_STATUS_ORDER.includes(k) ? MDM_STATUS_ORDER.indexOf(k) : MDM_STATUS_ORDER.length);
  const statuses = [...keys]
    .filter(Boolean)
    .map((key) => ({ key, label: providerStatusLabel(key), group: statusGroupOf(normalizeProviderStatus(key, overrides)) }))
    .sort((a, b) => rank(a.key) - rank(b.key) || a.label.localeCompare(b.label));
  const unique = (values: (string | null)[]) => {
    const out = new Map<string, string>();
    for (const v of values) if (v?.trim() && !out.has(textKey(v))) out.set(textKey(v), v.trim());
    return [...out.values()].sort((a, b) => a.localeCompare(b, "fr"));
  };
  return {
    groups: STATUS_GROUPS.map((g) => ({ key: g.key, label: g.label, hint: g.hint, statuses: statuses.filter((s) => s.group === g.key).map(({ key, label }) => ({ key, label })) })),
    wilayas: unique(wilayas.map((w) => w.wilaya)),
    stores: unique(stores.map((s) => s.storeName)),
    products: unique(products.map((p) => p.productName)),
  };
}
