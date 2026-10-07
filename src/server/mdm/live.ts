import { normalizeProviderStatus } from "@/domain/statusMapping";
import { createLiveAccountReader } from "./live-account";
import { isObj, money, obj, str, date } from "./parse";
import { assertPublicHost, validateMdmBaseUrl } from "./url";
import { MdmError, type MdmAdapter, type MdmDateRange, type MdmOrder, type MdmOrderFilters, type MdmOrderQuery, type MdmOrdersPage, type MdmPage, type MdmParcel, type MdmParcelQuery, type MdmUtm } from "./types";

/**
 * Live MDM Express adapter.
 *
 * Everything that depends on MDM's API contract lives in `LIVE_SCHEMA` below.
 * It was written from MDM's OpenAPI document (uploaded by the workspace owner),
 * not guessed from endpoint names:
 *
 * - Auth: security scheme `ApiKey`, an API key in the `x-api-key` header.
 * - Read-only test: `GET /api/auth/me` (GetMyProfileResponse).
 * - Parcels: `POST /api/v2/shipping/parcels/search` with GetParcelsRequest
 *   `{ filters, sortBy, pagination: { page, perPage } }`, answering
 *   GetParcelsResponse `{ pagination: { page, nextPage, hasMore, total, … }, list: Parcel[] }`.
 * - Merchant reference: a Parcel only carries `orderId` (MDM's own order tracking
 *   ID). The merchant's order ID is `Order.externalId`, read in one batched
 *   `POST /api/v2/orders/search` per page with `filters.trackingId`.
 *
 * - Orders: `POST /api/v2/orders/search` (GetOrdersRequest, same filters/sort/pagination
 *   shape) answering GetOrdersResponse `{ pagination, list: Order[] }`. Order.utm holds the
 *   UTM tags; when it is empty, `GET /api/v2/orders/{trackingId}/status-history` is read once
 *   and the landing URL the store wrote into the first note is parsed for utm_content.
 *
 * - Custom syncs narrow both searches with the user's choices: orders by `createdAt`,
 *   `statusDate`, `isStopDesk`, `trackingId` or `externalId`; parcels by `orderId`. The
 *   sync checks every record itself too, so a filter MDM refuses or ignores only makes
 *   the read longer (see src/server/mdm/custom.ts).
 *
 * - The seller's account (wallet, payouts, fees, price list, stock, stock arrivals): see
 *   src/server/mdm/live-account.ts.
 *
 * Search endpoints use POST but only read. The client refuses any POST whose
 * path does not end in `/search`, so it cannot create or change anything at MDM.
 *
 * Not stated by the schema, so verified on the first real connection: money units
 * (assumed major units of the parcel's currency, e.g. 2500 = 2 500 DZD) and the
 * exact status strings (read from `/api/v2/shipping/parcels/metadata` during the test).
 */
export type MdmRequest = { method: "GET" | "POST"; path: string; query?: Record<string, string>; body?: unknown };

export type LiveParcel = MdmParcel & { mdmOrderId: string | null };

export type LiveSchema = {
  /** Set the auth header(s) on an outbound request. Never log the headers. */
  applyAuth(headers: Headers, credential: string): void;
  /** A cheap read that proves the credential works and changes nothing. */
  testRequest(): MdmRequest;
  accountLabel(body: unknown): string | null;
  /** Optional read of the provider's status vocabulary, used to flag unmapped statuses after a test. */
  statusesRequest?(): MdmRequest;
  parseStatuses?(body: unknown): string[];
  parcelsRequest(q: MdmParcelQuery): MdmRequest;
  parseParcelsPage(body: unknown): { items: LiveParcel[]; nextCursor: string | null; total?: number | null };
  /** Optional batched lookup of the merchant's order reference for a page of parcels. */
  ordersRequest?(mdmOrderIds: string[]): MdmRequest;
  parseOrderRefs?(body: unknown): Map<string, string>;
  /** Optional: orders created or changed since a date (and matching the search filters), one page at a time. */
  orderSearchRequest?(q: MdmOrderQuery): MdmRequest;
  parseOrdersPage?(body: unknown): MdmOrdersPage;
  /** Optional: one order's status history, where stores leave the landing URL. */
  orderHistoryRequest?(trackingId: string): MdmRequest;
  parseOrderHistory?(body: unknown): MdmUtm | null;
};

export const LIVE_ADAPTER_UNAVAILABLE =
  "The live MDM Express adapter is not configured: its API schema (authentication, pagination, parcel search and response fields) has not been verified. No request was sent to MDM.";

// ---------------------------------------------------------------- parsing helpers

/** First time the history reaches a normalized state (history is sorted by date first). */
function firstAt(events: { status: string; at: Date }[], target: string): Date | null {
  return events.find((e) => normalizeProviderStatus(e.status) === target)?.at ?? null;
}

export function mapMdmParcel(raw: unknown): LiveParcel {
  const p = obj(raw, "parcel");
  const trackingId = str(p.trackingId);
  if (!trackingId) throw new Error("parcel without trackingId");
  const currency = (str(p.currency) ?? "DZD").toUpperCase();
  const fees = isObj(p.fees) ? p.fees : {};
  const pricing = isObj(p.pricing) ? p.pricing : {};
  const dest = isObj(p.destinationAddress) ? p.destinationAddress : {};
  const events = (Array.isArray(p.statusHistory) ? p.statusHistory : [])
    .filter(isObj)
    .map((h) => ({ status: str(h.status), at: date(h.date) ?? date(h.createdAt) }))
    .filter((e): e is { status: string; at: Date } => !!e.status && !!e.at)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  const status = str(p.status);
  return {
    trackingId,
    mdmOrderId: str(p.orderId),
    reference: null,
    sourceOrderId: null,
    status,
    statusAt: date(p.statusDate) ?? events.at(-1)?.at ?? date(p.updatedAt),
    codAmount: money(pricing.totalToPayFromClient, currency),
    currency,
    shippingFee: money(fees.shipping, currency),
    returnFee: money(fees.return, currency),
    wilaya: str(dest.stateName) ?? str(dest.stateCode),
    dispatchedAt: firstAt(events, "SHIPPED"),
    deliveredAt: firstAt(events, "DELIVERED"),
    returnedAt: firstAt(events, "RETURNED"),
    events,
    raw: p,
  };
}

/** Ad platforms' unfilled URL macros, e.g. "{{ad.id}}", are not content IDs. */
const utmValue = (v: unknown): string | null => {
  const s = str(v);
  return s && !/\{\{.*\}\}|^\{.*\}$/.test(s) ? s.slice(0, 200) : null;
};

/**
 * Read an MDM order: what the reports need, plus the customer's name, phones and street
 * address, which the sync stores encrypted. The IP and GPS position are never copied.
 */
export function mapMdmOrder(raw: unknown): MdmOrder {
  const o = obj(raw, "order");
  const trackingId = str(o.trackingId);
  if (!trackingId) throw new Error("order without trackingId");
  const currency = (str(o.currency) ?? "DZD").toUpperCase();
  const placedAt = date(o.createdAt) ?? date(o.updatedAt) ?? date(o.statusDate);
  if (!placedAt) throw new Error(`order ${trackingId} has no creation date`);
  const utm = isObj(o.utm) ? o.utm : {};
  const client = isObj(o.client) ? o.client : {};
  const dest = isObj(o.destination) ? o.destination : {};
  const store = isObj(o.store) ? o.store : {};
  const name = [str(client.firstName), str(client.lastName)].filter(Boolean).join(" ") || null;
  const products = (Array.isArray(o.products) ? o.products : []).filter(isObj).map((p) => {
    const q = typeof p.quantity === "number" && Number.isFinite(p.quantity) ? Math.round(p.quantity) : 1;
    return { ref: str(p.trackingId), variantOf: str(p.variantOf), name: str(p.name), quantity: Math.min(Math.max(q, 1), 1000), unitPrice: money(p.price, currency) };
  });
  return {
    trackingId,
    externalId: str(o.externalId),
    status: str(o.status),
    statusAt: date(o.statusDate),
    confirmed: typeof o.confirmed === "boolean" ? o.confirmed : null,
    placedAt,
    total: money(o.totalPrice, currency),
    currency,
    phone: str(client.phone),
    customer: { name, phone2: str(client.phone2), address: str(dest.streetAddress) },
    deliveryType: typeof o.isStopDesk === "boolean" ? (o.isStopDesk ? "STOP_DESK" : "HOME") : null,
    storeName: str(store.name),
    wilaya: str(dest.stateName) ?? str(dest.stateCode),
    city: str(dest.cityName),
    utm: { source: utmValue(utm.source), medium: utmValue(utm.medium), campaign: utmValue(utm.campaign), content: utmValue(utm.content) },
    products,
    upsell: typeof o.upsell === "boolean" ? o.upsell : null,
  };
}

/**
 * UTM tags in free text, e.g. a status-history note holding the landing URL
 * (`…?utm_source=facebook&utm_content=1234&ad_id=1234`, possibly JSON-escaped).
 * Falls back to `ad_id` when there is no utm_content. Nothing else in the text is kept.
 */
export function utmFromText(text: string): MdmUtm | null {
  const t = text.replace(/\\u0026/gi, "&").replace(/&amp;/gi, "&").replace(/\\\//g, "/");
  const found: Record<string, string> = {};
  for (const m of t.matchAll(/(?:^|[?&\s"'(,;])(utm_source|utm_medium|utm_campaign|utm_content|ad_id)=([^&\s"'<>,;)}\]]+)/gi)) {
    const k = m[1].toLowerCase();
    if (k in found) continue;
    let v = m[2].replace(/\+/g, " ");
    try {
      v = decodeURIComponent(v);
    } catch {
      // keep the raw value
    }
    const clean = utmValue(v);
    if (clean) found[k] = clean;
  }
  const content = found.utm_content ?? found.ad_id ?? null;
  if (!content && !found.utm_source && !found.utm_campaign) return null;
  return { source: found.utm_source ?? null, medium: found.utm_medium ?? null, campaign: found.utm_campaign ?? null, content };
}

// ---------------------------------------------------------------- the MDM contract

const SEARCH_PAGE_MAX = 100;

const dateRange = (r: MdmDateRange) => ({ ...(r.start ? { start: r.start.toISOString() } : {}), ...(r.end ? { end: r.end.toISOString() } : {}) });

/** GetOrdersRequestFilters: date ranges are DateRangeDto `{ start, end }`; lists match any of their values. */
function orderFilters(f: MdmOrderFilters | undefined) {
  if (!f) return {};
  return {
    ...(f.createdAt ? { createdAt: dateRange(f.createdAt) } : {}),
    ...(f.statusDate ? { statusDate: dateRange(f.statusDate) } : {}),
    ...(f.isStopDesk !== undefined ? { isStopDesk: f.isStopDesk } : {}),
    ...(f.trackingIds?.length ? { trackingId: f.trackingIds } : {}),
    ...(f.externalIds?.length ? { externalId: f.externalIds } : {}),
    ...(f.upsell !== undefined ? { upsell: f.upsell } : {}),
  };
}

export const LIVE_SCHEMA: LiveSchema | null = {
  applyAuth(headers, credential) {
    headers.set("x-api-key", credential);
  },
  testRequest: () => ({ method: "GET", path: "/api/auth/me" }),
  accountLabel(body) {
    // The profile also holds names, email and phones; only the account ID and role are shown.
    if (!isObj(body)) return null;
    const id = str(body.trackingId);
    const role = str(body.role);
    return id ? `MDM account ${id}${role ? ` (${role})` : ""}` : null;
  },
  statusesRequest: () => ({ method: "GET", path: "/api/v2/shipping/parcels/metadata" }),
  parseStatuses(body) {
    const b = obj(body, "metadata");
    return Array.isArray(b.statuses) ? b.statuses.filter((s): s is string => typeof s === "string") : [];
  },
  parcelsRequest({ cursor, updatedSince, pageSize, mdmOrderIds }) {
    const page = cursor ? Number(cursor) : 1;
    return {
      method: "POST",
      path: "/api/v2/shipping/parcels/search",
      body: {
        filters: { ...(updatedSince ? { updatedAt: { start: updatedSince.toISOString() } } : {}), ...(mdmOrderIds?.length ? { orderId: mdmOrderIds } : {}) },
        sortBy: mdmOrderIds?.length ? { createdAt: "ASC" } : { updatedAt: "ASC" },
        pagination: { page: Number.isInteger(page) && page > 0 ? page : 1, perPage: Math.min(pageSize, SEARCH_PAGE_MAX) },
      },
    };
  },
  parseParcelsPage(body) {
    const b = obj(body, "response");
    if (!Array.isArray(b.list)) throw new Error("response.list is missing");
    const pg = obj(b.pagination, "response.pagination");
    const next = typeof pg.nextPage === "number" ? pg.nextPage : pg.hasMore === true && typeof pg.page === "number" ? pg.page + 1 : null;
    return {
      items: b.list.map(mapMdmParcel),
      nextCursor: next != null && b.list.length > 0 ? String(next) : null,
      total: typeof pg.total === "number" ? pg.total : null,
    };
  },
  ordersRequest: (ids) => ({
    method: "POST",
    path: "/api/v2/orders/search",
    body: { filters: { trackingId: ids }, pagination: { page: 1, perPage: ids.length } },
  }),
  parseOrderRefs(body) {
    const b = obj(body, "orders response");
    const out = new Map<string, string>();
    for (const o of Array.isArray(b.list) ? b.list : []) {
      if (!isObj(o)) continue;
      const id = str(o.trackingId);
      const ext = str(o.externalId);
      if (id && ext) out.set(id, ext);
    }
    return out;
  },
  orderSearchRequest({ cursor, updatedSince, pageSize, filters }) {
    const page = cursor ? Number(cursor) : 1;
    const picked = orderFilters(filters);
    return {
      method: "POST",
      path: "/api/v2/orders/search",
      body: {
        filters: { ...(updatedSince ? { updatedAt: { start: updatedSince.toISOString() } } : {}), ...picked },
        // A filtered read pages by creation date, which never changes while it runs.
        sortBy: !updatedSince && Object.keys(picked).length ? { createdAt: "ASC" } : { updatedAt: "ASC" },
        pagination: { page: Number.isInteger(page) && page > 0 ? page : 1, perPage: Math.min(pageSize, SEARCH_PAGE_MAX) },
      },
    };
  },
  parseOrdersPage(body) {
    const b = obj(body, "orders response");
    if (!Array.isArray(b.list)) throw new Error("orders response.list is missing");
    const pg = obj(b.pagination, "orders response.pagination");
    const next = typeof pg.nextPage === "number" ? pg.nextPage : pg.hasMore === true && typeof pg.page === "number" ? pg.page + 1 : null;
    // One odd order never holds up the others (or the parcels after them).
    const items: MdmOrder[] = [];
    const unreadable: string[] = [];
    for (const raw of b.list) {
      try {
        items.push(mapMdmOrder(raw));
      } catch {
        unreadable.push((isObj(raw) && str(raw.trackingId)) || "?");
      }
    }
    return { items, unreadable, nextCursor: next != null && b.list.length > 0 ? String(next) : null, total: typeof pg.total === "number" ? pg.total : null };
  },
  orderHistoryRequest(trackingId) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(trackingId)) throw new MdmError("Unexpected MDM order ID", "BAD_RESPONSE");
    return { method: "GET", path: `/api/v2/orders/${trackingId}/status-history` };
  },
  parseOrderHistory(body) {
    const b = obj(body, "status history");
    const items = (Array.isArray(b.list) ? b.list : []).filter(isObj);
    // Oldest first: the store's note on the new order carries the landing URL.
    items.sort((x, y) => (date(x.date)?.getTime() ?? 0) - (date(y.date)?.getTime() ?? 0));
    for (const h of items) {
      const found = typeof h.notes === "string" ? utmFromText(h.notes) : null;
      if (found?.content) return found;
    }
    return null;
  },
};

// ---------------------------------------------------------------- hardened HTTP client

const TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 10 * 1024 * 1024;

function retryAfterMs(res: Response): number | undefined {
  const h = res.headers.get("retry-after");
  if (!h) return undefined;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.min(secs * 1000, 120_000);
  const at = Date.parse(h);
  return Number.isFinite(at) ? Math.max(0, Math.min(at - Date.now(), 120_000)) : undefined;
}

/**
 * Hardened read-only request: SSRF checks, timeout, no redirects, body cap, typed
 * errors. GET, or POST to a `/search` endpoint only. The credential only goes in headers.
 */
export async function mdmRequest(baseUrl: string, credential: string, schema: LiveSchema, req: MdmRequest, signal?: AbortSignal): Promise<unknown> {
  const base = validateMdmBaseUrl(baseUrl);
  const url = new URL(base + (req.path.startsWith("/") ? req.path : `/${req.path}`));
  if (url.origin !== new URL(base).origin) throw new MdmError("Refusing to call a different host", "CONFIG");
  if (req.method === "POST" && !/\/search$/.test(url.pathname)) throw new MdmError("Refusing a write request to MDM", "CONFIG");
  if (req.method !== "GET" && req.method !== "POST") throw new MdmError("Refusing a write request to MDM", "CONFIG");
  for (const [k, v] of Object.entries(req.query ?? {})) url.searchParams.set(k, v);
  try {
    await assertPublicHost(url.hostname);
  } catch (e) {
    throw new MdmError((e as Error).message, "CONFIG");
  }
  const headers = new Headers({ accept: "application/json", "user-agent": "cod-flow-tracker/1.0" });
  if (req.method === "POST") headers.set("content-type", "application/json");
  schema.applyAuth(headers, credential);
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: req.method,
      headers,
      body: req.method === "POST" ? JSON.stringify(req.body ?? {}) : undefined,
      redirect: "error",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      cache: "no-store",
    });
  } catch {
    throw new MdmError("Could not reach MDM Express (network error or timeout)", "NETWORK");
  }
  if (res.status === 401 || res.status === 403) throw new MdmError(res.status === 403 ? "MDM refused access: the API key lacks a permission this read needs" : "MDM rejected the credential", "AUTH");
  if (res.status === 429) throw new MdmError("MDM rate limit reached", "RATE_LIMIT", retryAfterMs(res));
  if (res.status >= 500) throw new MdmError(`MDM server error (${res.status})`, "SERVER", retryAfterMs(res));
  if (!res.ok) throw new MdmError(`MDM returned ${res.status}`, "BAD_RESPONSE");
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_BODY_BYTES) throw new MdmError("MDM response too large", "BAD_RESPONSE");
  const text = await res.text();
  if (text.length > MAX_BODY_BYTES) throw new MdmError("MDM response too large", "BAD_RESPONSE");
  try {
    return JSON.parse(text);
  } catch {
    throw new MdmError("MDM returned a response that is not JSON", "BAD_RESPONSE");
  }
}

// ---------------------------------------------------------------- adapter

export function createLiveAdapter(opts: { baseUrl: string; credential: string | null; schema?: LiveSchema | null }): MdmAdapter {
  const schema = opts.schema === undefined ? LIVE_SCHEMA : opts.schema;
  const ready = () => {
    if (!schema) throw new MdmError(LIVE_ADAPTER_UNAVAILABLE, "NOT_AVAILABLE");
    if (!opts.credential) throw new MdmError("No credential saved for this workspace", "CONFIG");
    return { s: schema, credential: opts.credential };
  };
  const shape = <T>(fn: () => T): T => {
    try {
      return fn();
    } catch (e) {
      throw new MdmError(`Unexpected MDM response shape: ${(e as Error).message}`, "BAD_RESPONSE");
    }
  };
  return {
    kind: "live",
    async testConnection(signal) {
      const { s, credential } = ready();
      const body = await mdmRequest(opts.baseUrl, credential, s, s.testRequest(), signal);
      let providerStatuses: string[] | undefined;
      if (s.statusesRequest && s.parseStatuses) {
        // Best effort: the credential already passed; a key without this permission still connects.
        try {
          const meta = await mdmRequest(opts.baseUrl, credential, s, s.statusesRequest(), signal);
          providerStatuses = s.parseStatuses(meta);
        } catch {
          providerStatuses = undefined;
        }
      }
      return { accountLabel: s.accountLabel(body), providerStatuses };
    },
    async listParcels(q, signal): Promise<MdmPage> {
      const { s, credential } = ready();
      const body = await mdmRequest(opts.baseUrl, credential, s, s.parcelsRequest(q), signal);
      const page = shape(() => s.parseParcelsPage(body));
      const orderIds = [...new Set(page.items.map((p) => p.mdmOrderId).filter((v): v is string => !!v))];
      let refs = new Map<string, string>();
      if (orderIds.length && s.ordersRequest && s.parseOrderRefs) {
        try {
          const ob = await mdmRequest(opts.baseUrl, credential, s, s.ordersRequest(orderIds), signal);
          refs = shape(() => s.parseOrderRefs!(ob));
        } catch (e) {
          // A key without order access still syncs parcels; they fall back to tracking-ID matching
          // or the unmatched queue. Rate limits and outages retry the whole page as usual.
          if (!(e instanceof MdmError && e.kind === "AUTH")) throw e;
        }
      }
      return {
        total: page.total,
        nextCursor: page.nextCursor,
        items: page.items.map((p) => {
          const ref = p.mdmOrderId ? (refs.get(p.mdmOrderId) ?? null) : null;
          return { ...p, reference: ref, sourceOrderId: ref };
        }),
      };
    },
    ...(schema?.orderSearchRequest && schema.parseOrdersPage
      ? {
          async listOrders(q, signal): Promise<MdmOrdersPage> {
            const { s, credential } = ready();
            const body = await mdmRequest(opts.baseUrl, credential, s, s.orderSearchRequest!(q), signal);
            return shape(() => s.parseOrdersPage!(body));
          },
        }
      : {}),
    // The seller's wallet, payouts, fees, prices and stock (src/server/mdm/live-account.ts).
    ...(schema
      ? {
          account: createLiveAccountReader((req, signal) => {
            const { s, credential } = ready();
            return mdmRequest(opts.baseUrl, credential, s, req, signal);
          }),
        }
      : {}),
    ...(schema?.orderHistoryRequest && schema.parseOrderHistory
      ? {
          async orderUtm(trackingId, signal): Promise<MdmUtm | null> {
            const { s, credential } = ready();
            const body = await mdmRequest(opts.baseUrl, credential, s, s.orderHistoryRequest!(trackingId), signal);
            return shape(() => s.parseOrderHistory!(body));
          },
        }
      : {}),
  };
}
