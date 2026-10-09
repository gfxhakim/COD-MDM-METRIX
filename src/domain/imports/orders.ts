import type { OrderStatus } from "@prisma/client";
import { normalizeCreativeKey, normalizeReference } from "@/lib/normalize";
import type { ParsedCsv } from "./csv";
import { cell, currencyOf, int, money, RowError, type Mapping, type RowIssue } from "./common";
import { parseDate, type DateFormat } from "./dates";
import { wilayaName } from "../wilayas";

export type ProductRef = { id: string; sku: string; name: string; salePrice: number | null };

export type ImportedOrderLine = { productId: string | null; sku: string | null; productName: string | null; quantity: number; unitPrice: number };
export type ImportedOrder = {
  line: number;
  lines: number[];
  externalOrderId: string;
  orderNumber: string;
  normalizedOrderNumber: string;
  placedAt: Date;
  status: OrderStatus;
  codAmount: number;
  currency: string;
  phone: string | null;
  customerRef: string | null;
  wilaya: string | null;
  city: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  creativeKey: string | null;
  tags: string | null;
  notes: string | null;
  callAttempts: number | null;
  items: ImportedOrderLine[];
};

const CONFIRMED = /^(confirm|confirmé|confirme|validated|validé|valide|approved|shipped|expédi|expedi|delivered|livr|fulfilled|dispatched)/i;
const CANCELED = /^(cancel|annul|refus|rejected|fake|faux|doublon|duplicate|void)/i;
const PENDING = /^(pending|en attente|attente|new|nouveau|nouvelle|open|no answer|injoignable|pas de réponse|unconfirmed|non confirm|rappel|callback|)$/i;

export function parseOrderStatus(raw: string): { status: OrderStatus; recognized: boolean } {
  const v = raw.trim();
  if (CANCELED.test(v)) return { status: "CANCELED", recognized: true };
  if (CONFIRMED.test(v)) return { status: "CONFIRMED", recognized: true };
  if (PENDING.test(v)) return { status: "PENDING", recognized: true };
  return { status: "PENDING", recognized: false };
}

/** Read utm_* parameters from a landing URL or a bare query string. */
export function utmFromUrl(raw: string): Record<"utmSource" | "utmMedium" | "utmCampaign" | "utmContent", string | null> {
  const empty = { utmSource: null, utmMedium: null, utmCampaign: null, utmContent: null };
  if (!raw) return empty;
  const q = raw.includes("?") ? raw.slice(raw.indexOf("?") + 1) : raw.includes("=") ? raw : "";
  if (!q) return empty;
  const p = new URLSearchParams(q.split("#")[0]);
  const g = (k: string) => p.get(k)?.trim() || null;
  return { utmSource: g("utm_source"), utmMedium: g("utm_medium"), utmCampaign: g("utm_campaign"), utmContent: g("utm_content") };
}

export type OrderValidation = { orders: ImportedOrder[]; issues: RowIssue[]; warnings: RowIssue[] };

/**
 * Validate and group order rows. Shopify-style exports repeat the order on one row per
 * line item; rows sharing an order ID/number become one order with several lines.
 * If any row of an order is invalid, the whole order is rejected.
 */
export function validateOrders(
  csv: ParsedCsv,
  mapping: Mapping,
  opts: { dateFormat: Exclude<DateFormat, "AUTO">; currency: string; products: readonly ProductRef[] },
): OrderValidation {
  const bySku = new Map(opts.products.map((p) => [p.sku.toLowerCase(), p]));
  const byName = new Map(opts.products.map((p) => [p.name.toLowerCase(), p]));
  const groups = new Map<string, ParsedCsv["rows"]>();
  const issues: RowIssue[] = [];
  const warnings: RowIssue[] = [];

  for (const row of csv.rows) {
    // Group by order number: Shopify repeats it on every line item but fills the ID on the first row only.
    const key = cell(row, mapping, "orderNumber") || cell(row, mapping, "externalOrderId");
    if (!key) {
      issues.push({ line: row.line, field: "orderNumber", message: "Missing order number" });
      continue;
    }
    const g = groups.get(key);
    if (g) g.push(row);
    else groups.set(key, [row]);
  }

  const orders: ImportedOrder[] = [];
  for (const [key, rows] of groups) {
    const first = (k: string) => rows.map((r) => cell(r, mapping, k)).find(Boolean) ?? "";
    const rowIssues: RowIssue[] = [];
    const guard = <T,>(line: number, fn: () => T): T | undefined => {
      try {
        return fn();
      } catch (e) {
        if (e instanceof RowError) rowIssues.push({ line, field: e.field, message: e.message });
        else throw e;
        return undefined;
      }
    };
    const line0 = rows[0].line;
    const orderNumber = first("orderNumber") || key;
    const dateRaw = first("placedAt");
    const placedAt = dateRaw ? parseDate(dateRaw, opts.dateFormat) : null;
    if (!dateRaw) rowIssues.push({ line: line0, field: "placedAt", message: "Missing created date" });
    else if (!placedAt) rowIssues.push({ line: line0, field: "placedAt", message: `Invalid date "${dateRaw}"` });
    const currency = guard(line0, () => currencyOf(first("currency"), opts.currency)) ?? opts.currency;
    if (currency !== opts.currency) rowIssues.push({ line: line0, field: "currency", message: `Order is in ${currency}; this workspace uses ${opts.currency}` });

    const items: ImportedOrderLine[] = [];
    for (const r of rows) {
      const sku = cell(r, mapping, "sku") || null;
      const name = cell(r, mapping, "productName") || null;
      if (!sku && !name) {
        if (rows.length === 1) rowIssues.push({ line: r.line, field: "sku", message: "No SKU or product name" });
        continue;
      }
      const product = (sku && bySku.get(sku.toLowerCase())) || (name && byName.get(name.toLowerCase())) || null;
      if (!product) warnings.push({ line: r.line, field: "sku", message: `Unknown product "${sku ?? name}": imported without costs (COGS counted as 0)` });
      const qRaw = cell(r, mapping, "quantity");
      const quantity = qRaw ? guard(r.line, () => int(qRaw, "quantity", { min: 1, max: 1000 })) : 1;
      const pRaw = cell(r, mapping, "unitPrice");
      const unitPrice = pRaw ? guard(r.line, () => money(pRaw, currency, "unitPrice")) : product?.salePrice ?? 0;
      if (quantity === undefined || unitPrice === undefined) continue;
      items.push({ productId: product?.id ?? null, sku: sku ?? product?.sku ?? null, productName: name ?? product?.name ?? null, quantity, unitPrice });
    }

    const totalRaw = first("total");
    const total = totalRaw ? guard(line0, () => money(totalRaw, currency, "total")) : items.reduce((a, l) => a + l.quantity * l.unitPrice, 0);
    const statusRaw = first("status");
    const { status, recognized } = parseOrderStatus(statusRaw);
    if (!recognized) warnings.push({ line: line0, field: "status", message: `Unrecognized status "${statusRaw}" imported as pending` });
    const callRaw = first("callAttempts");
    const callAttempts = callRaw ? guard(line0, () => int(callRaw, "callAttempts", { max: 100 })) ?? null : null;

    if (rowIssues.length || !placedAt || total === undefined) {
      issues.push(...rowIssues);
      continue;
    }
    const fromUrl = utmFromUrl(first("landingUrl"));
    const utm = {
      utmSource: first("utmSource") || fromUrl.utmSource,
      utmMedium: first("utmMedium") || fromUrl.utmMedium,
      utmCampaign: first("utmCampaign") || fromUrl.utmCampaign,
      utmContent: first("utmContent") || fromUrl.utmContent,
    };
    orders.push({
      line: line0,
      lines: rows.map((r) => r.line),
      externalOrderId: first("externalOrderId") || orderNumber,
      orderNumber,
      normalizedOrderNumber: normalizeReference(orderNumber),
      placedAt,
      status,
      codAmount: total,
      currency,
      phone: first("phone") || null,
      customerRef: first("customerId") || null,
      wilaya: wilayaName(first("wilaya")),
      city: first("city") || null,
      ...utm,
      creativeKey: normalizeCreativeKey(utm.utmContent) || null,
      tags: first("tags") || null,
      notes: first("notes") || null,
      callAttempts,
      items,
    });
  }
  return { orders, issues, warnings };
}
