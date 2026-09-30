import type { NormalizedStatus, OrderSource, Prisma } from "@prisma/client";
import {
  EXPORT_COLUMNS,
  EXPORT_ORDER_LIMIT,
  exportFileName,
  isCustomerColumn,
  PRINT_ROW_LIMIT,
  STATUS_GROUPS,
  statusGroupLabel,
  statusGroupOf,
  type ExportColumnKey,
  type ExportFormat,
  type StatusGroupKey,
} from "@/domain/orderExport";
import { parseExchangeRates } from "@/domain/settings";
import { normalizeProviderStatus, providerStatusLabel, statusKey } from "@/domain/statusMapping";
import { toDelimited } from "@/lib/csv";
import { convertWithRates, currencyExponent } from "@/lib/money";
import { audit } from "@/server/audit";
import { canSeeCustomers, openCustomer, type Customer } from "@/server/customers";
import { db } from "@/server/db";
import { InputError } from "@/server/errors";
import { workspaceStatusOverrides } from "@/server/mdm/statuses";
import { rateLimit } from "@/server/rateLimit";
import { orderWhere } from "@/server/repositories/orders";
import type { WorkspaceContext } from "@/server/tenancy";
import { buildXlsx, type XCell, type XColumn } from "./xlsx";

export type ExportFilters = {
  /** Days as YYYY-MM-DD, inclusive, in the workspace's time zone. */
  from?: string;
  to?: string;
  /** Filter on the order date, or on the date of the order's latest status. */
  dateField: "placed" | "status";
  /** Orders MDM knows (synced from MDM, or with an MDM parcel), or every order. */
  scope: "mdm" | "all";
  search?: string;
  wilaya?: string;
  productId?: string;
  creativeId?: string;
  source?: OrderSource;
};

export type ExportOptions = ExportFilters & {
  /** Status keys to keep (as statusKey gives them); leave out for every status. */
  statuses?: string[];
  format: ExportFormat;
  csvDelimiter: "," | ";";
  layout: "orders" | "lines";
  columns: ExportColumnKey[];
  /** Amounts in this currency, with the Settings rates. Defaults to the report currency. */
  currency?: string;
  totals: boolean;
};

// ---------------------------------------------------------------- time zone

function zoneOffsetMs(at: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - Math.floor(at.getTime() / 1000) * 1000;
  } catch {
    return 0;
  }
}

/** The instant a local day starts in `timeZone`. */
export function dayStart(day: string, timeZone: string): Date {
  const guess = Date.parse(`${day}T00:00:00Z`);
  return new Date(guess - zoneOffsetMs(new Date(guess), timeZone));
}

const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

function dayRange(f: ExportFilters, timeZone: string) {
  return { from: f.from ? dayStart(f.from, timeZone) : undefined, to: f.to ? new Date(dayStart(nextDay(f.to), timeZone).getTime() - 1) : undefined };
}

// ---------------------------------------------------------------- status

type StatusOrder = {
  status: "PENDING" | "CONFIRMED" | "CANCELED";
  placedAt: Date;
  confirmedAt: Date | null;
  canceledAt: Date | null;
  mdmStatus: string | null;
  mdmStatusAt: Date | null;
  parcels: { providerStatus: string | null; normalizedStatus: NormalizedStatus; lastProviderUpdateAt: Date | null; updatedAt: Date }[];
};

export type ResolvedStatus = { key: string; label: string; group: StatusGroupKey; at: Date };

const APP_NORMALIZED = { PENDING: "PENDING", CONFIRMED: "CONFIRMED", CANCELED: "CANCELED" } as const;

/**
 * An order's current status in MDM's own words: its latest parcel's status, or MDM's status
 * for the order when that is newer (or there is no parcel). Orders MDM never sent fall back
 * to the app's pending, confirmed or cancelled.
 */
export function resolveStatus(o: StatusOrder, overrides: Record<string, NormalizedStatus>): ResolvedStatus {
  const parcel = o.parcels
    .filter((p) => p.providerStatus)
    .sort((a, b) => (b.lastProviderUpdateAt ?? b.updatedAt).getTime() - (a.lastProviderUpdateAt ?? a.updatedAt).getTime())[0];
  const parcelAt = parcel ? (parcel.lastProviderUpdateAt ?? parcel.updatedAt) : null;
  if (parcel && parcelAt && (!o.mdmStatus || !o.mdmStatusAt || parcelAt >= o.mdmStatusAt)) {
    const key = statusKey(parcel.providerStatus!);
    const normalized = parcel.normalizedStatus !== "UNKNOWN" ? parcel.normalizedStatus : normalizeProviderStatus(key, overrides);
    return { key, label: providerStatusLabel(key), group: statusGroupOf(normalized), at: parcelAt };
  }
  if (o.mdmStatus) {
    const key = statusKey(o.mdmStatus);
    const mapped = normalizeProviderStatus(key, overrides);
    return { key, label: providerStatusLabel(key), group: statusGroupOf(mapped === "UNKNOWN" ? APP_NORMALIZED[o.status] : mapped), at: o.mdmStatusAt ?? o.placedAt };
  }
  const key = o.status === "CANCELED" ? "cancelled" : o.status.toLowerCase();
  return { key, label: providerStatusLabel(key), group: statusGroupOf(APP_NORMALIZED[o.status]), at: o.canceledAt ?? o.confirmedAt ?? o.placedAt };
}

// ---------------------------------------------------------------- loading

const statusSelect = {
  status: true,
  placedAt: true,
  confirmedAt: true,
  canceledAt: true,
  mdmStatus: true,
  mdmStatusAt: true,
  parcels: { select: { providerStatus: true, normalizedStatus: true, lastProviderUpdateAt: true, updatedAt: true } },
} as const satisfies Prisma.OrderSelect;

function exportWhere(ctx: WorkspaceContext, f: ExportFilters, range: { from?: Date; to?: Date }): Prisma.OrderWhereInput {
  const and: Prisma.OrderWhereInput[] = [orderWhere(ctx, { search: f.search, wilaya: f.wilaya, productId: f.productId, creativeId: f.creativeId, source: f.source })];
  if (f.scope === "mdm") and.push({ OR: [{ source: "MDM_EXPRESS" }, { mdmOrderId: { not: null } }, { parcels: { some: { provider: "MDM_EXPRESS" } } }] });
  if (range.from && f.dateField === "placed") and.push({ placedAt: { gte: range.from } });
  // A status never comes before its order, so this bound also holds when filtering on the status date.
  if (range.to) and.push({ placedAt: { lte: range.to } });
  return { AND: and };
}

const inRange = (at: Date, range: { from?: Date; to?: Date }) => (!range.from || at >= range.from) && (!range.to || at <= range.to);

async function workspaceFor(ctx: WorkspaceContext) {
  return db.workspace.findUniqueOrThrow({ where: { id: ctx.workspaceId }, select: { name: true, timezone: true, currency: true, reportCurrency: true, exchangeRates: true } });
}

/** How many orders the filters match, by status group and MDM status, before picking statuses. */
export async function orderExportPreview(ctx: WorkspaceContext, f: ExportFilters) {
  const ws = await workspaceFor(ctx);
  const range = dayRange(f, ws.timezone);
  const where = exportWhere(ctx, f, range);
  const count = await db.order.count({ where });
  if (count > EXPORT_ORDER_LIMIT) return { total: count, lines: null, tooMany: true, groups: [] };
  const [orders, overrides] = await Promise.all([
    db.order.findMany({ where, select: { ...statusSelect, _count: { select: { lines: true } } } }),
    workspaceStatusOverrides(ctx.workspaceId),
  ]);
  const byGroup = new Map<StatusGroupKey, Map<string, { label: string; count: number; lines: number }>>();
  let total = 0;
  let lines = 0;
  for (const o of orders) {
    const s = resolveStatus(o, overrides);
    if (f.dateField === "status" && !inRange(s.at, range)) continue;
    const g = byGroup.get(s.group) ?? new Map();
    byGroup.set(s.group, g);
    const e = g.get(s.key) ?? { label: s.label, count: 0, lines: 0 };
    e.count++;
    e.lines += Math.max(1, o._count.lines);
    g.set(s.key, e);
    total++;
    lines += Math.max(1, o._count.lines);
  }
  return {
    total,
    lines,
    tooMany: false,
    groups: STATUS_GROUPS.map((g) => {
      const statuses = [...(byGroup.get(g.key)?.entries() ?? [])].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.count - a.count);
      return { key: g.key, label: g.label, hint: g.hint, count: statuses.reduce((a, s) => a + s.count, 0), lines: statuses.reduce((a, s) => a + s.lines, 0), statuses };
    }),
  };
}

const exportSelect = {
  ...statusSelect,
  id: true,
  orderNumber: true,
  mdmOrderId: true,
  source: true,
  customerEncrypted: true,
  deliveryType: true,
  storeName: true,
  wilaya: true,
  city: true,
  codAmount: true,
  currency: true,
  utmSource: true,
  utmCampaign: true,
  utmContent: true,
  lines: { select: { productName: true, sku: true, quantity: true, unitPrice: true, currency: true, product: { select: { name: true, sku: true } } }, orderBy: [{ productName: "asc" }, { id: "asc" }] },
  attribution: { select: { creative: { select: { externalCreativeId: true, name: true } } } },
  parcels: {
    select: { trackingId: true, providerStatus: true, normalizedStatus: true, lastProviderUpdateAt: true, updatedAt: true, shippingFee: true, returnFee: true, currency: true, dispatchedAt: true, deliveredAt: true, returnedAt: true },
    orderBy: { createdAt: "asc" },
  },
} as const satisfies Prisma.OrderSelect;

type ExportOrder = Prisma.OrderGetPayload<{ select: typeof exportSelect }>;

const SOURCE_LABEL: Record<OrderSource, string> = { MDM_EXPRESS: "MDM Express", EASYSELL: "EasySell", SHOPIFY: "Shopify", MANUAL: "Manual", OTHER: "Other" };

const earliest = (ds: (Date | null)[]) => ds.filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

type Row = Partial<Record<ExportColumnKey, XCell>>;

// ---------------------------------------------------------------- export

export async function exportOrders(ctx: WorkspaceContext, opts: ExportOptions) {
  await rateLimit(`orders-export:${ctx.workspaceId}:${ctx.userId}`, 30, 600);
  const ws = await workspaceFor(ctx);
  const book = ws.currency;
  const to = opts.currency ?? ws.reportCurrency ?? book;
  const rates = parseExchangeRates(ws.exchangeRates) as Partial<Record<string, number>>;
  const range = dayRange(opts, ws.timezone);
  const where = exportWhere(ctx, opts, range);
  const matched = await db.order.count({ where });
  if (matched > EXPORT_ORDER_LIMIT) throw new InputError(`These filters match ${matched.toLocaleString("en-US")} orders; one export takes up to ${EXPORT_ORDER_LIMIT.toLocaleString("en-US")}. Pick a shorter date range.`);
  const [orders, overrides] = await Promise.all([db.order.findMany({ where, select: exportSelect, orderBy: [{ placedAt: "desc" }, { id: "desc" }] }), workspaceStatusOverrides(ctx.workspaceId)]);

  // Customer columns only for roles allowed to see customers.
  const seeCustomers = canSeeCustomers(ctx.role);
  const columns = opts.columns.filter((k, i, all) => all.indexOf(k) === i && (seeCustomers || !isCustomerColumn(k)));
  if (!columns.length) throw new InputError("Pick at least one column you can export.");
  const wanted = opts.statuses ? new Set(opts.statuses.map(statusKey)) : null;

  const exp = currencyExponent(to);
  const money = (minor: number | null | undefined, from: string): number | null => {
    if (minor === null || minor === undefined) return null;
    const v = convertWithRates(minor, from, to, book, rates);
    if (v === null) throw new InputError(`Add a ${from === to ? to : from === book ? to : from} rate in Settings > Economics & currencies to export in ${to}.`);
    return v / 10 ** exp;
  };
  const sum = (vals: (number | null)[]) => (vals.some((v) => v !== null) ? vals.reduce<number>((a, v) => a + (v ?? 0), 0) : null);

  const rows: Row[] = [];
  const totals = new Map<string, { group: StatusGroupKey; label: string; orders: number; quantity: number; cod: number }>();
  let orderCount = 0;
  for (const o of orders as ExportOrder[]) {
    const s = resolveStatus(o, overrides);
    if (opts.dateField === "status" && !inRange(s.at, range)) continue;
    if (wanted && !wanted.has(s.key)) continue;
    orderCount++;
    const customer: Customer | null = seeCustomers && columns.some(isCustomerColumn) ? openCustomer(o.customerEncrypted, ctx.workspaceId) : null;
    // The name on the order itself (as MDM or the store sent it), else the catalog's.
    const lineName = (l: ExportOrder["lines"][number]) => l.productName ?? l.product?.name ?? "Unknown product";
    const qty = o.lines.reduce((a, l) => a + l.quantity, 0);
    const cod = money(o.codAmount, o.currency) ?? 0;
    const t = totals.get(s.key) ?? { group: s.group, label: s.label, orders: 0, quantity: 0, cod: 0 };
    t.orders++;
    t.quantity += qty;
    t.cod += cod;
    totals.set(s.key, t);

    const base: Row = {
      orderNumber: o.orderNumber,
      mdmOrderId: o.mdmOrderId,
      customerName: customer?.name,
      phone: customer?.phone,
      phone2: customer?.phone2,
      address: customer?.address,
      city: o.city,
      wilaya: o.wilaya,
      deliveryType: o.deliveryType === "STOP_DESK" ? "Stop desk" : o.deliveryType === "HOME" ? "Home" : null,
      status: s.label,
      statusGroup: statusGroupLabel(s.group),
      statusAt: s.at,
      placedAt: o.placedAt,
      trackingId: o.parcels.map((p) => p.trackingId).join(", ") || null,
      store: o.storeName,
      source: SOURCE_LABEL[o.source],
      adId: o.attribution?.creative?.externalCreativeId ?? o.utmContent,
      adName: o.attribution?.creative?.name,
      utmCampaign: o.utmCampaign,
      utmSource: o.utmSource,
      dispatchedAt: earliest(o.parcels.map((p) => p.dispatchedAt)),
      deliveredAt: earliest(o.parcels.map((p) => p.deliveredAt)),
      returnedAt: earliest(o.parcels.map((p) => p.returnedAt)),
    };
    const orderMoney: Row = {
      codAmount: cod,
      shippingFee: sum(o.parcels.map((p) => money(p.shippingFee, p.currency))),
      returnFee: sum(o.parcels.map((p) => money(p.returnFee, p.currency))),
    };
    if (opts.layout === "lines" && o.lines.length) {
      // Order amounts sit on the order's first line only, so column sums stay right.
      o.lines.forEach((l, i) => rows.push({ ...base, ...(i === 0 ? orderMoney : {}), products: lineName(l), sku: l.product?.sku ?? l.sku, quantity: l.quantity, unitPrice: money(l.unitPrice, l.currency) }));
    } else {
      const skus = [...new Set(o.lines.map((l) => l.product?.sku ?? l.sku).filter(Boolean))];
      rows.push({
        ...base,
        ...orderMoney,
        products: o.lines.map((l) => `${lineName(l)} ×${l.quantity}`).join(", ") || null,
        sku: skus.join(", ") || null,
        quantity: o.lines.length ? qty : null,
        unitPrice: o.lines.length === 1 ? money(o.lines[0].unitPrice, o.lines[0].currency) : null,
      });
    }
  }

  const cols = columns.map((k) => EXPORT_COLUMNS.find((c) => c.key === k)!);
  const header = (c: (typeof cols)[number]) => (c.kind === "money" ? `${c.label} (${to})` : c.label);
  const totalRows = [...totals.values()].sort((a, b) => STATUS_GROUPS.findIndex((g) => g.key === a.group) - STATUS_GROUPS.findIndex((g) => g.key === b.group) || b.orders - a.orders);
  const grand = totalRows.reduce((a, t) => ({ orders: a.orders + t.orders, quantity: a.quantity + t.quantity, cod: a.cod + t.cod }), { orders: 0, quantity: 0, cod: 0 });
  const round = (v: number) => Math.round(v * 10 ** exp) / 10 ** exp;
  const totalsTable = {
    columns: [
      { header: "Status group", kind: "text" },
      { header: "MDM status", kind: "text" },
      { header: "Orders", kind: "number" },
      { header: "Quantity", kind: "number" },
      { header: `COD amount (${to})`, kind: "money" },
    ] as XColumn[],
    rows: [
      ...totalRows.map((t) => [statusGroupLabel(t.group), t.label, t.orders, t.quantity, round(t.cod)] as XCell[]),
      ["Total", "", grand.orders, grand.quantity, round(grand.cod)] as XCell[],
    ],
  };

  await audit(ctx, "report.exported", { type: "OrdersExport" }, { format: opts.format, layout: opts.layout, orders: orderCount, rows: rows.length, columns: columns.length, customerDetails: columns.some(isCustomerColumn) });

  const offset = (d: Date) => new Date(d.getTime() + zoneOffsetMs(d, ws.timezone));
  const today = offset(new Date()).toISOString().slice(0, 10);
  const table = rows.map((r) => columns.map((k) => r[k] ?? null));

  if (opts.format === "print") {
    if (rows.length > PRINT_ROW_LIMIT) throw new InputError(`The printable page takes up to ${PRINT_ROW_LIMIT.toLocaleString("en-US")} rows and these filters give ${rows.length.toLocaleString("en-US")}. Export to Excel instead, or pick fewer days.`);
    const decimals = table.some((r) => r.some((v, i) => cols[i].kind === "money" && typeof v === "number" && !Number.isInteger(v))) ? exp : 0;
    const fmtMoney = new Intl.NumberFormat("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    const fmtDate = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: ws.timezone, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
    const text = (v: XCell, kind: string) => (v === null || v === undefined ? "" : v instanceof Date ? fmtDate(v) : typeof v === "number" ? (kind === "money" ? fmtMoney.format(v) : v.toLocaleString("en-US")) : v);
    return {
      kind: "print" as const,
      workspace: ws.name,
      generatedAt: new Date(),
      orders: orderCount,
      headers: cols.map(header),
      align: cols.map((c) => (c.kind === "money" || c.kind === "number" ? "right" : "left") as "left" | "right"),
      rows: table.map((r) => r.map((v, i) => text(v, cols[i].kind))),
      totals: opts.totals ? { headers: totalsTable.columns.map((c) => c.header), rows: totalsTable.rows.map((r) => r.map((v, i) => text(v, totalsTable.columns[i].kind))) } : null,
    };
  }

  const filename = exportFileName({ from: opts.from, to: opts.to, scope: opts.scope, layout: opts.layout, format: opts.format }, today);
  if (opts.format === "xlsx") {
    const sheets = [{ name: opts.layout === "lines" ? "Order lines" : "Orders", columns: cols.map((c) => ({ header: header(c), kind: c.kind })), rows: table }];
    if (opts.totals) sheets.push({ name: "Totals by status", ...totalsTable, totalsRow: true } as (typeof sheets)[number]);
    const file = buildXlsx(sheets, offset);
    return { kind: "file" as const, filename, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", base64: file.toString("base64"), orders: orderCount, rows: rows.length };
  }

  const stamp = (v: XCell) => (v instanceof Date ? offset(v).toISOString().slice(0, 16).replace("T", " ") : v);
  const lines: (string | number | null | undefined)[][] = [cols.map(header), ...table.map((r) => r.map(stamp))];
  if (opts.totals) lines.push([], ["Totals by status"], totalsTable.columns.map((c) => c.header), ...totalsTable.rows.map((r) => r.map(stamp)));
  const csv = toDelimited(lines, opts.csvDelimiter);
  return { kind: "file" as const, filename, mime: "text/csv;charset=utf-8", base64: Buffer.from(csv, "utf8").toString("base64"), orders: orderCount, rows: rows.length };
}
