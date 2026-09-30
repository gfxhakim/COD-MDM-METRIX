import type { NormalizedStatus } from "@prisma/client";

/**
 * Order export: status groups, columns and presets. Shared by the export panel and the server,
 * so both always agree on what a column or a group means.
 */

/** The owner's own reading of MDM statuses (2026-09-28), in the order an order moves through them. */
export const STATUS_GROUPS = [
  { key: "not_confirmed", label: "Not confirmed yet", hint: "Pending, not answered, call later", normalized: ["PENDING"] },
  { key: "cancelled", label: "Cancelled", hint: "Before or after confirmation", normalized: ["CANCELED"] },
  { key: "confirmed", label: "Confirmed", hint: "Preparing, packaged", normalized: ["CONFIRMED"] },
  { key: "carrier", label: "With the carrier", hint: "Dispatched to out for delivery, postponed", normalized: ["SHIPPED"] },
  { key: "delivered", label: "Delivered", hint: "Delivered and paid", normalized: ["DELIVERED"] },
  { key: "returns", label: "Returns", hint: "Delivery failed, returning, returned", normalized: ["RETURNED"] },
  { key: "other", label: "Lost, exchanged or unknown", hint: "Statuses with no mapping yet", normalized: ["LOST", "EXCHANGED", "UNKNOWN"] },
] as const satisfies readonly { key: string; label: string; hint: string; normalized: readonly NormalizedStatus[] }[];

export type StatusGroupKey = (typeof STATUS_GROUPS)[number]["key"];

export function statusGroupOf(normalized: NormalizedStatus): StatusGroupKey {
  return STATUS_GROUPS.find((g) => (g.normalized as readonly NormalizedStatus[]).includes(normalized))?.key ?? "other";
}

export const statusGroupLabel = (key: StatusGroupKey) => STATUS_GROUPS.find((g) => g.key === key)!.label;

export type ExportColumnKind = "text" | "number" | "money" | "datetime";

export const EXPORT_COLUMNS = [
  { key: "orderNumber", label: "Order number", kind: "text" },
  { key: "mdmOrderId", label: "MDM order ID", kind: "text" },
  { key: "customerName", label: "Customer name", kind: "text", customer: true },
  { key: "phone", label: "Phone", kind: "text", customer: true },
  { key: "phone2", label: "Second phone", kind: "text", customer: true },
  { key: "address", label: "Address", kind: "text", customer: true },
  { key: "city", label: "Commune", kind: "text" },
  { key: "wilaya", label: "Wilaya", kind: "text" },
  { key: "deliveryType", label: "Delivery", kind: "text" },
  { key: "status", label: "MDM status", kind: "text" },
  { key: "statusGroup", label: "Status group", kind: "text" },
  { key: "statusAt", label: "Status date", kind: "datetime" },
  { key: "placedAt", label: "Order date", kind: "datetime" },
  { key: "products", label: "Products", kind: "text" },
  { key: "sku", label: "SKU", kind: "text" },
  { key: "quantity", label: "Quantity", kind: "number" },
  { key: "unitPrice", label: "Unit price", kind: "money" },
  { key: "codAmount", label: "COD amount", kind: "money" },
  { key: "shippingFee", label: "Delivery fee", kind: "money" },
  { key: "returnFee", label: "Return fee", kind: "money" },
  { key: "trackingId", label: "Tracking number", kind: "text" },
  { key: "store", label: "Store", kind: "text" },
  { key: "source", label: "Source", kind: "text" },
  { key: "adId", label: "Ad ID", kind: "text" },
  { key: "adName", label: "Ad name", kind: "text" },
  { key: "utmCampaign", label: "UTM campaign", kind: "text" },
  { key: "utmSource", label: "UTM source", kind: "text" },
  { key: "dispatchedAt", label: "Dispatched", kind: "datetime" },
  { key: "deliveredAt", label: "Delivered", kind: "datetime" },
  { key: "returnedAt", label: "Returned", kind: "datetime" },
] as const satisfies readonly { key: string; label: string; kind: ExportColumnKind; customer?: boolean }[];

export type ExportColumnKey = (typeof EXPORT_COLUMNS)[number]["key"];
export const EXPORT_COLUMN_KEYS = EXPORT_COLUMNS.map((c) => c.key) as [ExportColumnKey, ...ExportColumnKey[]];
export const isCustomerColumn = (key: ExportColumnKey) => !!(EXPORT_COLUMNS.find((c) => c.key === key) as { customer?: boolean } | undefined)?.customer;

export const COLUMN_PRESETS: { key: string; label: string; columns: ExportColumnKey[] }[] = [
  { key: "essentials", label: "Essentials", columns: ["orderNumber", "placedAt", "customerName", "phone", "wilaya", "city", "products", "quantity", "codAmount", "status", "trackingId"] },
  { key: "delivery", label: "Delivery follow-up", columns: ["orderNumber", "customerName", "phone", "phone2", "address", "city", "wilaya", "deliveryType", "trackingId", "status", "statusAt", "codAmount", "shippingFee", "deliveredAt", "returnedAt"] },
  { key: "ads", label: "Ads and profit", columns: ["orderNumber", "placedAt", "status", "statusGroup", "products", "quantity", "codAmount", "adId", "adName", "utmCampaign", "utmSource"] },
  { key: "all", label: "Everything", columns: [...EXPORT_COLUMN_KEYS] },
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
