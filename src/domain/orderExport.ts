import type { NormalizedStatus } from "@prisma/client";
import { msg } from "@/i18n/core";

/**
 * Order export: status groups, columns and presets. Shared by the export panel and the server,
 * so both always agree on what a column or a group means. Labels are marked with msg(): the panel
 * shows them translated, the exported files keep the English.
 */

/** The owner's own reading of MDM statuses (2026-09-28), in the order an order moves through them. */
export const STATUS_GROUPS = [
  { key: "not_confirmed", label: msg("Not confirmed yet"), hint: msg("Pending, not answered, call later"), normalized: ["PENDING"] },
  { key: "cancelled", label: msg("Cancelled"), hint: msg("Before or after confirmation"), normalized: ["CANCELED"] },
  { key: "confirmed", label: msg("Confirmed"), hint: msg("Preparing, packaged"), normalized: ["CONFIRMED"] },
  { key: "carrier", label: msg("With the carrier"), hint: msg("Dispatched to out for delivery, postponed"), normalized: ["SHIPPED"] },
  { key: "delivered", label: msg("Delivered"), hint: msg("Delivered and paid"), normalized: ["DELIVERED"] },
  { key: "returns", label: msg("Returns"), hint: msg("Delivery failed, returning, returned"), normalized: ["RETURNED"] },
  { key: "other", label: msg("Lost, exchanged or unknown"), hint: msg("Statuses with no mapping yet"), normalized: ["LOST", "EXCHANGED", "UNKNOWN"] },
] as const satisfies readonly { key: string; label: string; hint: string; normalized: readonly NormalizedStatus[] }[];

export type StatusGroupKey = (typeof STATUS_GROUPS)[number]["key"];

export function statusGroupOf(normalized: NormalizedStatus): StatusGroupKey {
  return STATUS_GROUPS.find((g) => (g.normalized as readonly NormalizedStatus[]).includes(normalized))?.key ?? "other";
}

export const statusGroupLabel = (key: StatusGroupKey) => STATUS_GROUPS.find((g) => g.key === key)!.label;

export type ExportColumnKind = "text" | "number" | "money" | "datetime";

export const EXPORT_COLUMNS = [
  { key: "orderNumber", label: msg("Order number"), kind: "text" },
  { key: "mdmOrderId", label: msg("MDM order ID"), kind: "text" },
  { key: "customerName", label: msg("Customer name"), kind: "text", customer: true },
  { key: "phone", label: msg("Phone"), kind: "text", customer: true },
  { key: "phone2", label: msg("Second phone"), kind: "text", customer: true },
  { key: "address", label: msg("Address"), kind: "text", customer: true },
  { key: "city", label: msg("Commune"), kind: "text" },
  { key: "wilaya", label: msg("Wilaya"), kind: "text" },
  { key: "deliveryType", label: msg("Delivery"), kind: "text" },
  { key: "status", label: msg("MDM status"), kind: "text" },
  { key: "statusGroup", label: msg("Status group"), kind: "text" },
  { key: "statusAt", label: msg("Status date"), kind: "datetime" },
  { key: "placedAt", label: msg("Order date"), kind: "datetime" },
  { key: "products", label: msg("Products"), kind: "text" },
  { key: "upsell", label: msg("Upsell"), kind: "text" },
  { key: "sku", label: msg("SKU"), kind: "text" },
  { key: "quantity", label: msg("Quantity"), kind: "number" },
  { key: "unitPrice", label: msg("Unit price"), kind: "money" },
  { key: "codAmount", label: msg("COD amount"), kind: "money" },
  { key: "shippingFee", label: msg("Delivery fee"), kind: "money" },
  { key: "returnFee", label: msg("Return fee"), kind: "money" },
  { key: "trackingId", label: msg("Tracking number"), kind: "text" },
  { key: "store", label: msg("Store"), kind: "text" },
  { key: "source", label: msg("Source"), kind: "text" },
  { key: "adId", label: msg("Ad ID"), kind: "text" },
  { key: "adName", label: msg("Ad name"), kind: "text" },
  { key: "utmCampaign", label: msg("UTM campaign"), kind: "text" },
  { key: "utmSource", label: msg("UTM source"), kind: "text" },
  { key: "dispatchedAt", label: msg("Dispatched"), kind: "datetime" },
  { key: "deliveredAt", label: msg("Delivered"), kind: "datetime" },
  { key: "returnedAt", label: msg("Returned"), kind: "datetime" },
] as const satisfies readonly { key: string; label: string; kind: ExportColumnKind; customer?: boolean }[];

export type ExportColumnKey = (typeof EXPORT_COLUMNS)[number]["key"];
export const EXPORT_COLUMN_KEYS = EXPORT_COLUMNS.map((c) => c.key) as [ExportColumnKey, ...ExportColumnKey[]];
export const isCustomerColumn = (key: ExportColumnKey) => !!(EXPORT_COLUMNS.find((c) => c.key === key) as { customer?: boolean } | undefined)?.customer;

export const COLUMN_PRESETS: { key: string; label: string; columns: ExportColumnKey[] }[] = [
  { key: "essentials", label: msg("Essentials"), columns: ["orderNumber", "placedAt", "customerName", "phone", "wilaya", "city", "products", "quantity", "codAmount", "status", "trackingId"] },
  { key: "delivery", label: msg("Delivery follow-up"), columns: ["orderNumber", "customerName", "phone", "phone2", "address", "city", "wilaya", "deliveryType", "trackingId", "status", "statusAt", "codAmount", "shippingFee", "deliveredAt", "returnedAt"] },
  { key: "ads", label: msg("Ads and profit"), columns: ["orderNumber", "placedAt", "status", "statusGroup", "products", "quantity", "codAmount", "adId", "adName", "utmCampaign", "utmSource"] },
  { key: "all", label: msg("Everything"), columns: [...EXPORT_COLUMN_KEYS] },
];

export const EXPORT_FORMATS = ["xlsx", "csv", "print"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** More rows than this go to a file, not the printable page. */
export const PRINT_ROW_LIMIT = 5000;
/** The most orders one export reads. */
export const EXPORT_ORDER_LIMIT = 50_000;

/** "mdm-orders_2026-09-01_to_2026-09-30.xlsx"; the date range is in the name so files sort and don't overwrite each other. */
export function exportFileName(opts: { from?: string; to?: string; scope: "mdm" | "all"; layout: "orders" | "lines"; format: "xlsx" | "csv" }, today: string): string {
  const base = `${opts.scope === "mdm" ? "mdm-orders" : "orders"}${opts.layout === "lines" ? "-by-product" : ""}`;
  const range = opts.from && opts.to ? (opts.from === opts.to ? opts.from : `${opts.from}_to_${opts.to}`) : opts.from ? `from_${opts.from}` : opts.to ? `until_${opts.to}` : `all-dates_${today}`;
  return `${base}_${range}.${opts.format}`;
}
