import { count, date, isObj, money, obj, str, type Obj } from "./parse";
import {
  CAPITAL_BUCKETS,
  MdmError,
  STOCK_COUNTS,
  type MdmAccountReader,
  type MdmArrival,
  type MdmCapital,
  type MdmDeliveryPrice,
  type MdmFeeLine,
  type MdmList,
  type MdmListQuery,
  type MdmPayoutBreakdown,
  type MdmPayoutRecord,
  type MdmPriceList,
  type MdmStockCounts,
  type MdmVariant,
  type MdmWallet,
  type MdmWalletAmounts,
} from "./types";
import type { MdmRequest } from "./live";

/**
 * The seller's money and stock at MDM, read from the endpoints MDM's OpenAPI document lists
 * for sellers (all accept the `x-api-key` header):
 *
 * - Wallet: `GET /api/finance/seller-payments/wallets/summary` (GetSellerWalletsSummaryResponse:
 *   `ready`, `notReady`, `paid`, and `details` split into gross, taxes, refunds, sourcing and charges).
 * - Payouts: `POST /api/finance/seller-payments/search` (GetPaymentsResponse), and what each is made
 *   of: `GET /api/finance/seller-payments/{trackingId}/summary` (GetPaymentSummaryResponse).
 * - Account lines (money collected and fees, per parcel): `POST /api/finance/seller-payments/line-items/search`.
 * - Price list: `GET /api/sellers/{sellerId}/service-fees` (call center, fulfilment, delivery per wilaya).
 * - Stock: `POST /api/v2/products/variants/search`, `POST /api/v2/products/search` for product names,
 *   `GET /api/v2/products/{productId}/variants/{variantId}/stocks`, and the stock value from
 *   `GET /api/v2/products/capital-summary`.
 * - Stock arrivals: `POST /api/fulfilment/inventory/checkins/search`.
 *
 * Like the rest of the live adapter these only read: GETs, and POSTs to `/search` endpoints.
 * Names of people (sellers, MDM staff) and anything about customers in these responses are
 * never read. Money units are assumed to match parcels (major units, e.g. 2500 = 2 500 DZD).
 */

const PAGE_MAX = 100;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

function safeId(id: string, what: string) {
  if (!ID.test(id)) throw new MdmError(`Unexpected MDM ${what} ID`, "BAD_RESPONSE");
  return id;
}

const pagination = (q: Pick<MdmListQuery, "cursor" | "pageSize">) => {
  const page = q.cursor ? Number(q.cursor) : 1;
  return { page: Number.isInteger(page) && page > 0 ? page : 1, perPage: Math.min(Math.max(q.pageSize, 1), PAGE_MAX) };
};
const changedSince = (q: MdmListQuery) => (q.updatedSince ? { updatedAt: { start: q.updatedSince.toISOString() } } : {});

export const ACCOUNT_REQUESTS = {
  profile: (): MdmRequest => ({ method: "GET", path: "/api/auth/me" }),
  wallet: (): MdmRequest => ({ method: "GET", path: "/api/finance/seller-payments/wallets/summary" }),
  payouts: (q: MdmListQuery): MdmRequest => ({ method: "POST", path: "/api/finance/seller-payments/search", body: { filters: changedSince(q), sortBy: { updatedAt: "ASC" }, pagination: pagination(q) } }),
  payoutBreakdown: (id: string): MdmRequest => ({ method: "GET", path: `/api/finance/seller-payments/${safeId(id, "payout")}/summary` }),
  fees: (q: MdmListQuery): MdmRequest => ({ method: "POST", path: "/api/finance/seller-payments/line-items/search", body: { filters: changedSince(q), sortBy: { updatedAt: "ASC" }, pagination: pagination(q) } }),
  prices: (sellerId: string): MdmRequest => ({ method: "GET", path: `/api/sellers/${safeId(sellerId, "seller")}/service-fees` }),
  variants: (q: MdmListQuery): MdmRequest => ({ method: "POST", path: "/api/v2/products/variants/search", body: { filters: {}, sortBy: { createdAt: "DESC" }, pagination: pagination(q) } }),
  products: (ids: string[]): MdmRequest => ({ method: "POST", path: "/api/v2/products/search", body: { filters: { trackingId: ids }, pagination: { page: 1, perPage: Math.min(ids.length, PAGE_MAX) } } }),
  stock: (v: { productId: string; id: string }): MdmRequest => ({ method: "GET", path: `/api/v2/products/${safeId(v.productId, "product")}/variants/${safeId(v.id, "variant")}/stocks` }),
  capital: (): MdmRequest => ({ method: "GET", path: "/api/v2/products/capital-summary" }),
  arrivals: (q: MdmListQuery): MdmRequest => ({ method: "POST", path: "/api/fulfilment/inventory/checkins/search", body: { filters: {}, sortBy: { createdAt: "DESC" }, pagination: pagination(q) } }),
};

// ---------------------------------------------------------------- parsers

/** `{ pagination, list }` pages, as every MDM search answers. One odd record never holds up the rest. */
function readList<T>(body: unknown, what: string, map: (raw: unknown) => T): MdmList<T> {
  const b = obj(body, what);
  if (!Array.isArray(b.list)) throw new Error(`${what}.list is missing`);
  const pg = isObj(b.pagination) ? b.pagination : {};
  const next = typeof pg.nextPage === "number" ? pg.nextPage : pg.hasMore === true && typeof pg.page === "number" ? pg.page + 1 : null;
  const items: T[] = [];
  let unreadable = 0;
  for (const raw of b.list) {
    try {
      items.push(map(raw));
    } catch {
      unreadable++;
    }
  }
  return { items, unreadable, nextCursor: next != null && b.list.length > 0 ? String(next) : null, total: typeof pg.total === "number" ? pg.total : null };
}

const currencyOf = (v: unknown, fallback = "DZD") => (str(v) ?? fallback).toUpperCase();

function amounts(v: unknown, currency: string): Partial<MdmWalletAmounts> | undefined {
  if (!isObj(v)) return undefined;
  const out: Partial<MdmWalletAmounts> = {};
  const onHold = money(v.notReady, currency);
  const ready = money(v.ready, currency);
  const paid = money(v.paid, currency);
  if (onHold !== null) out.onHold = onHold;
  if (ready !== null) out.ready = ready;
  if (paid !== null) out.paid = paid;
  return Object.keys(out).length ? out : undefined;
}

export function parseWallet(body: unknown): MdmWallet {
  const b = obj(body, "wallet");
  const currency = currencyOf(b.currency);
  const top = amounts(b, currency);
  if (!top) throw new Error("wallet has no amounts");
  const d = isObj(b.details) ? b.details : {};
  const details: MdmWallet["details"] = {};
  const parts = { gross: d.gross, taxes: d.taxes, refunds: d.refunds, sourcing: d.sourcing, addedCharges: d.addedCustomCharges, deductedCharges: d.deducedCustomCharges };
  for (const [k, v] of Object.entries(parts)) {
    const a = amounts(v, currency);
    if (a) details[k as keyof typeof parts] = a;
  }
  return { currency, onHold: top.onHold ?? 0, ready: top.ready ?? 0, paid: top.paid ?? 0, details };
}

const PAID_WORDS = /^(confirmed|paid|completed|done|received|success(ful)?)$/i;

function mapPayout(raw: unknown): MdmPayoutRecord {
  const p = obj(raw, "payout");
  const id = str(p.trackingId);
  const currency = currencyOf(p.currency);
  const amount = money(p.amount, currency);
  const createdAt = date(p.createdAt);
  if (!id || amount === null || !createdAt) throw new Error("payout without ID, amount or date");
  const status = str(p.status) ?? "unknown";
  return {
    id,
    amount,
    currency,
    status,
    confirmed: PAID_WORDS.test(status),
    sellerId: isObj(p.seller) ? str(p.seller.trackingId) : null,
    storeNames: (Array.isArray(p.stores) ? p.stores : []).map((s) => (isObj(s) ? str(s.name) : null)).filter((n): n is string => !!n),
    createdAt,
    updatedAt: date(p.updatedAt) ?? createdAt,
  };
}
export const parsePayouts = (body: unknown) => readList(body, "payouts", mapPayout);

export function parsePayoutBreakdown(body: unknown): MdmPayoutBreakdown {
  const b = obj(body, "payout summary");
  const currency = currencyOf(b.currency);
  const items = (Array.isArray(b.items) ? b.items : []).filter(isObj).flatMap((i) => {
    const type = str(i.type);
    const total = money(i.total, currency);
    return type && total !== null ? [{ type, count: count(i.count), total, grossTotal: money(i.grossTotal, currency) }] : [];
  });
  const taxes = (Array.isArray(b.taxes) ? b.taxes : []).filter(isObj).flatMap((t) => {
    const type = str(t.type);
    const total = money(t.total, currency);
    return type && total !== null ? [{ type, count: count(t.count), total }] : [];
  });
  return { currency, items, taxes };
}

function mapFee(raw: unknown): MdmFeeLine {
  const l = obj(raw, "line item");
  const id = str(l.trackingId);
  const type = str(l.type);
  const currency = currencyOf(l.currency ?? l.inputCurrency);
  const amount = money(l.amount, currency);
  const createdAt = date(l.createdAt);
  if (!id || !type || amount === null || !createdAt) throw new Error("line item without ID, type, amount or date");
  // Only the IDs are taken from the (deprecated) parcel and lead copies; they also hold customer details.
  const parcel: Obj = isObj(l.parcel) ? l.parcel : {};
  const lead: Obj = isObj(l.lead) ? l.lead : {};
  return {
    id,
    sellerId: str(l.sellerId),
    entityId: str(l.entityId),
    type,
    subType: str(l.subType),
    amount,
    grossAmount: money(l.grossAmount, currency),
    taxes: money(l.totalTaxes, currency),
    currency,
    status: str(l.status) ?? "unknown",
    payoutId: str(l.paymentId),
    parcelTrackingId: str(parcel.trackingId),
    orderTrackingId: str(parcel.orderId) ?? str(lead.trackingId),
    createdAt,
    updatedAt: date(l.updatedAt) ?? createdAt,
  };
}
export const parseFees = (body: unknown) => readList(body, "line items", mapFee);

export function parsePrices(body: unknown): MdmPriceList {
  const b = obj(body, "service fees");
  const currency = currencyOf(b.currency);
  const cc = isObj(b.callCenter) ? b.callCenter : null;
  const ccCur = cc ? currencyOf(cc.currency, currency) : currency;
  const ff = isObj(b.fulfillment) ? b.fulfillment : null;
  const ffCur = ff ? currencyOf(ff.currency, currency) : currency;
  const shipping = isObj(b.shipping) ? b.shipping : {};
  const delivery: MdmDeliveryPrice[] = (Array.isArray(shipping.deliveryFees) ? shipping.deliveryFees : []).filter(isObj).flatMap((f) => {
    const state = isObj(f.state) ? f.state : {};
    const wilaya = str(state.name) ?? str(state.code);
    return wilaya ? [{ wilaya, code: str(state.code), home: money(f.home, currency), stopDesk: money(f.stopdesk, currency), return: money(f.return, currency), exchange: money(f.exchange, currency) }] : [];
  });
  const ex = isObj(b.exchange) ? b.exchange : {};
  const rate = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
  return {
    currency,
    callCenter: cc ? { type: str(cc.type), perLead: money(cc.lead, ccCur), perConfirmed: money(cc.confirmed, ccCur), perDelivered: money(cc.delivered, ccCur), upsellExtra: money(cc.upsellExtra, ccCur) } : null,
    fulfilment: ff ? { type: str(ff.type), perDispatched: money(ff.dispatched, ffCur), perDelivered: money(ff.delivered, ffCur), maxItems: typeof ff.maxItems === "number" ? count(ff.maxItems) : null, extraPerItem: money(ff.extraFeePerItem, ffCur) } : null,
    delivery,
    usdRate: rate(ex.usd),
    euroRate: rate(ex.euro),
  };
}

function mapVariant(raw: unknown): Omit<MdmVariant, "productName"> & { productName: string | null } {
  const v = obj(raw, "variant");
  const id = str(v.trackingId);
  const productId = str(v.productId);
  if (!id || !productId) throw new Error("variant without ID");
  const currency = currencyOf(v.currency);
  const pricing = isObj(v.pricing) ? v.pricing : {};
  return { id, productId, productName: null, variantName: str(v.name), sku: str(v.sku), sellingPrice: money(pricing.selling, currency), purchasePrice: money(pricing.purchasing, currency), currency, archived: v.archived === true };
}
export const parseVariants = (body: unknown) => readList(body, "variants", mapVariant);

/** Product names (and prices, for variants without their own) by MDM product ID. */
export function parseProducts(body: unknown): Map<string, { name: string; sellingPrice: number | null; purchasePrice: number | null }> {
  const out = new Map<string, { name: string; sellingPrice: number | null; purchasePrice: number | null }>();
  for (const p of readList(body, "products", (raw) => obj(raw, "product")).items) {
    const id = str(p.trackingId);
    const name = str(p.name);
    if (!id || !name) continue;
    const currency = currencyOf(p.currency);
    const pricing = isObj(p.pricing) ? p.pricing : {};
    out.set(id, { name, sellingPrice: money(pricing.selling, currency), purchasePrice: money(pricing.purchasing, currency) });
  }
  return out;
}

/** MDM may split a variant's stock by warehouse; the counts are added up. */
export function parseStock(body: unknown): MdmStockCounts {
  const { items } = readList(body, "stocks", (raw) => obj(raw, "stock"));
  const out = Object.fromEntries(STOCK_COUNTS.map((k) => [k, 0])) as MdmStockCounts;
  for (const s of items) for (const k of STOCK_COUNTS) out[k] += Math.max(0, count(s[k]));
  return out;
}

export function parseCapital(body: unknown, currency: string): MdmCapital {
  const b = obj(body, "capital summary");
  let found = false;
  const buckets = Object.fromEntries(
    CAPITAL_BUCKETS.map((k) => {
      const v = isObj(b[k]) ? b[k] : null;
      if (v) found = true;
      return [k, { units: v ? count(v.count) : 0, value: (v ? money(v.capitalNative, currency) : null) ?? 0 }];
    }),
  ) as MdmCapital["buckets"];
  if (!found) throw new Error("capital summary has no buckets");
  return { currency, buckets };
}

function mapArrival(raw: unknown): MdmArrival {
  const c = obj(raw, "check-in");
  const id = str(c.trackingId);
  const createdAt = date(c.createdAt);
  if (!id || !createdAt) throw new Error("check-in without ID or date");
  const products = (Array.isArray(c.products) ? c.products : []).filter(isObj).map((p) => ({ name: str(p.name) ?? str(p.sku) ?? "Product", sku: str(p.sku), expected: Math.max(0, count(p.expectedQuantity)) }));
  const received = (Array.isArray(c.receivedItems) ? c.receivedItems : []).filter(isObj);
  const expected = products.reduce((a, p) => a + p.expected, 0);
  return {
    id,
    status: str(c.status) ?? "unknown",
    operation: str(c.operation),
    products,
    expectedUnits: expected || (Array.isArray(c.expectedItems) ? c.expectedItems.length : 0),
    receivedUnits: received.length,
    damagedUnits: received.filter((r) => r.damaged === true).length,
    createdAt,
    updatedAt: date(c.updatedAt) ?? createdAt,
  };
}
export const parseArrivals = (body: unknown) => readList(body, "check-ins", mapArrival);

// ---------------------------------------------------------------- reader

/** `call` sends one read to MDM with the workspace's credential (see createLiveAdapter). */
export function createLiveAccountReader(call: (req: MdmRequest, signal?: AbortSignal) => Promise<unknown>): MdmAccountReader {
  const shape = <T>(fn: () => T): T => {
    try {
      return fn();
    } catch (e) {
      throw new MdmError(`Unexpected MDM response shape: ${(e as Error).message}`, "BAD_RESPONSE");
    }
  };
  const names = new Map<string, { name: string; sellingPrice: number | null; purchasePrice: number | null }>();
  return {
    async profileId(signal) {
      const b = await call(ACCOUNT_REQUESTS.profile(), signal);
      return isObj(b) ? str(b.trackingId) : null;
    },
    async wallet(signal) {
      const b = await call(ACCOUNT_REQUESTS.wallet(), signal);
      return shape(() => parseWallet(b));
    },
    async payouts(q, signal) {
      const b = await call(ACCOUNT_REQUESTS.payouts(q), signal);
      return shape(() => parsePayouts(b));
    },
    async payoutBreakdown(id, signal) {
      const b = await call(ACCOUNT_REQUESTS.payoutBreakdown(id), signal);
      return shape(() => parsePayoutBreakdown(b));
    },
    async fees(q, signal) {
      const b = await call(ACCOUNT_REQUESTS.fees(q), signal);
      return shape(() => parseFees(b));
    },
    async prices(sellerId, signal) {
      const b = await call(ACCOUNT_REQUESTS.prices(sellerId), signal);
      return shape(() => parsePrices(b));
    },
    async variants(q, signal) {
      const b = await call(ACCOUNT_REQUESTS.variants(q), signal);
      const page = shape(() => parseVariants(b));
      const missing = [...new Set(page.items.map((v) => v.productId))].filter((id) => !names.has(id));
      if (missing.length) {
        try {
          const pb = await call(ACCOUNT_REQUESTS.products(missing), signal);
          for (const [id, p] of shape(() => parseProducts(pb))) names.set(id, p);
        } catch (e) {
          // Without product names the variants still show, under their own names.
          if (!(e instanceof MdmError) || e.retryable) throw e;
        }
      }
      return {
        ...page,
        items: page.items.map((v) => {
          const p = names.get(v.productId);
          return { ...v, productName: p?.name ?? v.variantName ?? v.sku ?? v.id, sellingPrice: v.sellingPrice ?? p?.sellingPrice ?? null, purchasePrice: v.purchasePrice ?? p?.purchasePrice ?? null };
        }),
      };
    },
    async stock(v, signal) {
      const b = await call(ACCOUNT_REQUESTS.stock(v), signal);
      return shape(() => parseStock(b));
    },
    async capital(currency, signal) {
      const b = await call(ACCOUNT_REQUESTS.capital(), signal);
      return shape(() => parseCapital(b, currency));
    },
    async arrivals(q, signal) {
      const b = await call(ACCOUNT_REQUESTS.arrivals(q), signal);
      return shape(() => parseArrivals(b));
    },
  };
}
