import { z } from "zod";
import { shortDay } from "@/lib/dateRanges";
import { STATUS_GROUPS, statusGroupLabel, type StatusGroupKey } from "./orderExport";
import { providerStatusLabel } from "./statusMapping";

/**
 * Custom MDM syncs: a one-off read of only the MDM orders a user picks (by dates, statuses,
 * wilaya, store, product, delivery type, ad ID or order number), then their parcels.
 * Shared by the Sync page's panel and the sync engine, so both read the choices the same way.
 */

/** The most orders one custom sync can name. */
export const CUSTOM_SYNC_MAX_ORDERS = 100;

const STATUS_GROUP_KEYS = STATUS_GROUPS.map((g) => g.key) as [StatusGroupKey, ...StatusGroupKey[]];
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-09-30");
const names = z.array(z.string().trim().min(1).max(120)).max(100);

const choices = z.object({
  /** Days as YYYY-MM-DD, inclusive, in the workspace's time zone. */
  from: day.optional(),
  to: day.optional(),
  /** Pick orders by the day they were placed, or by the day MDM last changed their status. */
  dateField: z.enum(["placed", "status"]).default("placed"),
  /** Whole status groups, and single MDM statuses (as statusKey gives them). An order in either matches; none means every status. */
  groups: z.array(z.enum(STATUS_GROUP_KEYS)).max(STATUS_GROUP_KEYS.length).optional(),
  statuses: z.array(z.string().trim().min(1).max(100)).max(200).optional(),
  wilayas: names.optional(),
  deliveryType: z.enum(["HOME", "STOP_DESK"]).optional(),
  stores: names.optional(),
  products: names.optional(),
  /** Orders carrying an ad ID (utm_content), orders without one, or both. */
  ad: z.enum(["any", "with", "without"]).default("any"),
  /** MDM order IDs or store order numbers, as typed. */
  orderIds: z.array(z.string().trim().min(1).max(100)).max(CUSTOM_SYNC_MAX_ORDERS).optional(),
  /** Also re-read the parcels of the orders that match. */
  parcels: z.boolean().default(true),
});

export const customSyncInput = choices.refine((f) => !f.from || !f.to || f.from <= f.to, { message: "The start date is after the end date", path: ["from"] });
export type CustomSyncChoices = z.output<typeof choices>;

const stored = choices.extend({
  /** The picked days resolved to instants in the workspace's time zone when the sync was queued. */
  fromAt: z.string().optional(),
  toAt: z.string().optional(),
  /** Picked orders the app already holds, as MDM order IDs. */
  mdmOrderIds: z.array(z.string()).optional(),
  /** MDM refused the search filters, so orders (or parcels) are read unfiltered and picked by the app. */
  fallbackOrders: z.boolean().optional(),
  fallbackParcels: z.boolean().optional(),
});

/** What a custom sync job keeps in `SyncJob.filters`. */
export type CustomSyncFilters = z.output<typeof stored>;

export function readCustomFilters(json: unknown): CustomSyncFilters | null {
  const r = stored.safeParse(json);
  return r.success ? r.data : null;
}

/** Order numbers typed by hand: one per line, or separated by commas, semicolons or spaces. */
export function parseOrderIds(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))];
}

/** MDM statuses in the order an order moves through them, so the panel lists them that way. Statuses seen in the workspace are added by the server. */
export const MDM_STATUS_ORDER = [
  "pending", "not_answered", "call_later", "out_of_stock",
  "cancelled", "canceled_after_confirmation",
  "preparing", "packaged", "ready_for_dispatch", "waiting_collection",
  "dispatched", "received", "in_transit", "ready_for_delivery", "out_for_delivery", "postponed", "delivery_attempt_failed", "waiting_for_client", "missing",
  "delivered", "payment_ready",
  "delivery_failed", "returning", "return_ready", "returned",
  "lost",
];

// ---------------------------------------------------------------- matching

/** Accents, case and a leading "#" don't matter when comparing names and order numbers. */
export const textKey = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase().replace(/\s+/g, " ");
export const orderIdKey = (s: string) => textKey(s).replace(/^#/, "");

/** One MDM order as the custom sync judges it. */
export type CustomSyncCandidate = {
  trackingId: string;
  externalId: string | null;
  placedAt: Date;
  statusAt: Date | null;
  /** MDM's status for the order now, and the status the app shows for it now, so orders sitting in a status can be refreshed. */
  statuses: { key: string; group: StatusGroupKey }[];
  wilaya: string | null;
  deliveryType: "HOME" | "STOP_DESK" | null;
  storeName: string | null;
  productNames: string[];
  hasAd: boolean;
};

const inList = (list: string[] | undefined, value: string | null) => !list?.length || (!!value && list.some((v) => textKey(v) === textKey(value)));

export function matchesCustomSync(f: CustomSyncFilters, o: CustomSyncCandidate): boolean {
  const at = f.dateField === "status" ? (o.statusAt ?? o.placedAt) : o.placedAt;
  if (f.fromAt && at < new Date(f.fromAt)) return false;
  if (f.toAt && at > new Date(f.toAt)) return false;
  if ((f.groups?.length || f.statuses?.length) && !o.statuses.some((s) => f.groups?.includes(s.group) || f.statuses?.includes(s.key))) return false;
  if (!inList(f.wilayas, o.wilaya) || !inList(f.stores, o.storeName)) return false;
  if (f.deliveryType && o.deliveryType !== f.deliveryType) return false;
  if (f.products?.length && !o.productNames.some((n) => inList(f.products, n))) return false;
  if ((f.ad === "with" && !o.hasAd) || (f.ad === "without" && o.hasAd)) return false;
  if (f.orderIds?.length) {
    const want = new Set([...f.orderIds, ...(f.mdmOrderIds ?? [])].map(orderIdKey));
    if (!want.has(orderIdKey(o.trackingId)) && !(o.externalId && want.has(orderIdKey(o.externalId)))) return false;
  }
  return true;
}

// ---------------------------------------------------------------- describing

function few(list: string[] | undefined, noun: string): string | null {
  if (!list?.length) return null;
  return list.length <= 2 ? list.join(", ") : `${list.length} ${noun}`;
}

/** Short phrases for a custom sync's choices, e.g. ["Placed 1 Sep 2026 to 30 Sep 2026", "Delivered, Returns", "Oran"]. Defaults are left out. */
export function describeCustomSync(f: Pick<CustomSyncChoices, "from" | "to" | "dateField" | "groups" | "statuses" | "wilayas" | "deliveryType" | "stores" | "products" | "ad" | "orderIds" | "parcels">): string[] {
  const parts: string[] = [];
  const what = f.dateField === "status" ? "Status changed" : "Placed";
  parts.push(
    f.from && f.to ? (f.from === f.to ? `${what} on ${shortDay(f.from)}` : `${what} ${shortDay(f.from)} to ${shortDay(f.to)}`)
      : f.from ? `${what} from ${shortDay(f.from)}`
        : f.to ? `${what} until ${shortDay(f.to)}`
          : "All dates",
  );
  const statuses = [...(f.groups ?? []).map(statusGroupLabel), ...(f.statuses ?? []).map(providerStatusLabel)];
  if (statuses.length) parts.push(statuses.length <= 3 ? statuses.join(", ") : `${statuses.slice(0, 2).join(", ")} +${statuses.length - 2} more`);
  for (const p of [few(f.wilayas, "wilayas"), few(f.stores, "stores"), few(f.products, "products")]) if (p) parts.push(p);
  if (f.deliveryType) parts.push(f.deliveryType === "STOP_DESK" ? "Stop desk" : "Home delivery");
  if (f.ad === "with") parts.push("With an ad ID");
  if (f.ad === "without") parts.push("No ad ID");
  if (f.orderIds?.length) parts.push(f.orderIds.length === 1 ? `Order ${f.orderIds[0]}` : `${f.orderIds.length} orders`);
  if (!f.parcels) parts.push("Orders only");
  return parts;
}
