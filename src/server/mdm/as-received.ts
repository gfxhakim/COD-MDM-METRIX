import { db } from "@/server/db";

/**
 * What MDM sent for an order and its parcels, as label and value rows ("pricing.totalToPayFromClient",
 * "4000"), from the payloads the sync keeps. Values are MDM's own: amounts in dinars as sent, dates
 * as sent. Only order and money fields are picked; the customer is never part of them.
 */
export type AsReceived = { observedAt: Date; rows: [string, string][] };

const PARCEL_FIELDS = [
  "trackingId", "orderId", "parentParcelId", "type", "subType", "status", "statusDate", "createdAt", "updatedAt", "archived",
  "company", "isStopDesk", "isPaymentReady", "isShippingFree", "isFulfilledByUs", "paymentMethod", "currency", "pricing", "fees", "products",
] as const;
/** A parcel's products: their names are not kept (the stored payload hides every "name"). */
const PARCEL_PRODUCT_FIELDS = ["quantity", "completedQuantity", "price"];

function value(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

function flatten(v: unknown, path: string, out: [string, string][], pick?: (key: string, path: string) => boolean) {
  if (Array.isArray(v)) {
    if (!v.length) out.push([path, "—"]);
    v.forEach((x, i) => flatten(x, `${path}[${i + 1}]`, out, pick));
  } else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      const at = path ? `${path}.${k}` : k;
      if (!pick || pick(k, at)) flatten(x, at, out, pick);
    }
  } else out.push([path, value(v)]);
}

export function orderRows(payload: unknown): [string, string][] {
  const out: [string, string][] = [];
  flatten(payload, "", out);
  return out;
}

export function parcelRows(payload: unknown): [string, string][] {
  const out: [string, string][] = [];
  if (!payload || typeof payload !== "object") return out;
  const p = payload as Record<string, unknown>;
  for (const k of PARCEL_FIELDS) {
    if (!(k in p)) continue;
    flatten(p[k], k, out, (key, at) => !at.startsWith("products[") || PARCEL_PRODUCT_FIELDS.includes(key));
  }
  return out;
}

/** The latest payload MDM sent for the order and for each of its parcels. */
export async function asReceivedFor(workspaceId: string, mdmOrderId: string | null, trackingIds: string[]) {
  const records = await db.rawExternalRecord.findMany({
    where: {
      workspaceId,
      provider: "MDM_EXPRESS",
      OR: [...(mdmOrderId ? [{ entityType: "order", externalId: mdmOrderId }] : []), ...(trackingIds.length ? [{ entityType: "parcel", externalId: { in: trackingIds } }] : [])],
    },
    orderBy: { observedAt: "desc" },
    select: { entityType: true, externalId: true, payload: true, observedAt: true },
  });
  let order: AsReceived | null = null;
  const parcels: Record<string, AsReceived> = {};
  for (const r of records) {
    if (r.entityType === "order") order ??= { observedAt: r.observedAt, rows: orderRows(r.payload) };
    else parcels[r.externalId] ??= { observedAt: r.observedAt, rows: parcelRows(r.payload) };
  }
  return { order, parcels };
}
