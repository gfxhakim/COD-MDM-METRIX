import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]) }));

import { normalizeProviderStatus, statusKey } from "@/domain/statusMapping";
import { createLiveAdapter, LIVE_SCHEMA, mapMdmParcel, mdmRequest } from "@/server/mdm/live";
import { redactPayload } from "@/server/mdm/redact";

/**
 * Contract tests for the live MDM Express adapter. The OpenAPI document has no
 * examples, so these payloads are built field by field from its schemas
 * (GetMyProfileResponse, GetParcelsResponse/Parcel, GetOrdersResponse/Order,
 * GetParcelsMetadataResponse). Placeholder values only; no real data or key.
 */
const KEY = "placeholder-test-key-0001";
const BASE = "https://api.mdm.express";

const person = { firstName: "Courier", lastName: "Placeholder", phones: ["0550000000"] };
function parcel(i: number, over: Record<string, unknown> = {}) {
  return {
    trackingId: `MDM-P-${i}`,
    orderId: `MDM-O-${i}`,
    shippingId: null,
    company: "mdm",
    type: "delivery",
    subType: null,
    paymentMethod: "cod",
    currency: "DZD",
    client: { firstName: "Amina", lastName: "Placeholder", phone: "0551111111", phone2: null },
    fees: { zoneId: 1, subZoneId: null, shipping: 600, return: 250, partialReturn: 0, refund: 0, exchange: 0, overweight: 0, deliveryTotal: 600 },
    pricing: { productsPrice: 3400, declaredValue: 3400, totalToPayFromClient: 4000, totalToPayToClient: 3400, customDeliveryFee: null },
    statusHistory: [
      { date: "2026-09-02T09:00:00.000Z", createdAt: "2026-09-02T09:00:01.000Z", notes: "left at door of 12 rue X", status: "delivered", responsible: person, meta: null },
      { date: "2026-09-01T08:00:00.000Z", createdAt: "2026-09-01T08:00:01.000Z", notes: null, status: "outForDelivery", responsible: person, meta: null },
    ],
    destinationAddress: { cityName: "Bab Ezzouar", cityCode: "1603", stateName: "Alger", stateCode: "16", stateId: 16, countryCode: "DZ", streetAddress: "12 rue X", gps: { lat: 36.7, lng: 3.2 } },
    seller: { firstName: "Seller", lastName: "Name" },
    store: { trackingId: "STORE-1", name: "My store" },
    status: "delivered",
    statusDate: "2026-09-02T09:00:00.000Z",
    createdAt: "2026-08-31T10:00:00.000Z",
    updatedAt: "2026-09-02T09:00:05.000Z",
    ...over,
  };
}
const pagination = (page: number, hasMore: boolean, total: number) => ({ page, perPage: 2, total, totalPages: Math.ceil(total / 2), hasMore, firstPage: 1, lastPage: Math.ceil(total / 2), nextPage: hasMore ? page + 1 : null, prevPage: page > 1 ? page - 1 : null });

type Call = { url: string; method: string; headers: Headers; body: unknown };
function stubMdm(routes: Record<string, (body: unknown) => Response | unknown>) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: URL, init: RequestInit) => {
    const u = new URL(String(url));
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: String(url), method: String(init.method), headers: init.headers as Headers, body });
    const handler = routes[`${init.method} ${u.pathname}`];
    if (!handler) return new Response("not found", { status: 404 });
    const out = handler(body);
    return out instanceof Response ? out : new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
  }));
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("MDM live contract", () => {
  it("is enabled and authenticates with the x-api-key header only", async () => {
    expect(LIVE_SCHEMA).not.toBeNull();
    const calls = stubMdm({
      "GET /api/auth/me": () => ({ trackingId: "ACC-42", role: "seller", firstName: "Owner", lastName: "Name", email: "owner@example.test", phones: ["0550000000"], usernames: [] }),
      "GET /api/v2/shipping/parcels/metadata": () => ({ statuses: ["delivered", "outForDelivery", "postponed"], types: [], subTypes: [], paymentMethods: [], dimensionsUnit: "cm", weightUnit: "kg" }),
    });
    const res = await createLiveAdapter({ baseUrl: BASE, credential: KEY }).testConnection();
    // Only the account ID and role; the profile's names, email and phones are not surfaced.
    expect(res.accountLabel).toBe("MDM account ACC-42 (seller)");
    expect(JSON.stringify(res)).not.toMatch(/Owner|example\.test|0550000000/);
    expect(res.providerStatuses).toEqual(["delivered", "outForDelivery", "postponed"]);
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual(["GET /api/auth/me", "GET /api/v2/shipping/parcels/metadata"]);
    for (const c of calls) {
      expect(c.headers.get("x-api-key")).toBe(KEY);
      expect(c.headers.get("authorization")).toBeNull();
      expect(c.url).not.toContain(KEY);
    }
  });

  it("still connects when the key cannot read the status list", async () => {
    stubMdm({ "GET /api/auth/me": () => ({ trackingId: "ACC-42" }), "GET /api/v2/shipping/parcels/metadata": () => new Response("", { status: 403 }) });
    const res = await createLiveAdapter({ baseUrl: BASE, credential: KEY }).testConnection();
    expect(res).toEqual({ accountLabel: "MDM account ACC-42", providerStatuses: undefined });
  });

  it("maps a rejected key to an auth error", async () => {
    stubMdm({ "GET /api/auth/me": () => new Response("", { status: 401 }) });
    await expect(createLiveAdapter({ baseUrl: BASE, credential: KEY }).testConnection()).rejects.toMatchObject({ kind: "AUTH" });
  });

  it("searches parcels incrementally, sorted by update time, one page at a time", async () => {
    const calls = stubMdm({
      "POST /api/v2/shipping/parcels/search": (b) => {
        const page = (b as { pagination: { page: number } }).pagination.page;
        return page === 1 ? { pagination: pagination(1, true, 3), list: [parcel(1), parcel(2)] } : { pagination: pagination(2, false, 3), list: [parcel(3)] };
      },
      "POST /api/v2/orders/search": () => ({ pagination: pagination(1, false, 1), list: [{ trackingId: "MDM-O-1", externalId: "#1001", client: person }] }),
    });
    const a = createLiveAdapter({ baseUrl: BASE, credential: KEY });
    const since = new Date("2026-09-01T00:00:00.000Z");
    const p1 = await a.listParcels({ cursor: null, updatedSince: since, pageSize: 2 });
    expect(calls[0].body).toEqual({ filters: { updatedAt: { start: "2026-09-01T00:00:00.000Z" } }, sortBy: { updatedAt: "ASC" }, pagination: { page: 1, perPage: 2 } });
    expect(calls[0].headers.get("content-type")).toBe("application/json");
    expect(p1).toMatchObject({ nextCursor: "2", total: 3 });
    expect(p1.items.map((p) => p.trackingId)).toEqual(["MDM-P-1", "MDM-P-2"]);

    // One batched order lookup per page, by MDM order tracking ID.
    expect(calls[1].body).toEqual({ filters: { trackingId: ["MDM-O-1", "MDM-O-2"] }, pagination: { page: 1, perPage: 2 } });
    expect(p1.items[0]).toMatchObject({ reference: "#1001", sourceOrderId: "#1001" });
    expect(p1.items[1]).toMatchObject({ reference: null, sourceOrderId: null });
    expect(p1.items[0]).not.toHaveProperty("mdmOrderId");

    const p2 = await a.listParcels({ cursor: "2", updatedSince: null, pageSize: 2 });
    expect(calls[2].body).toMatchObject({ filters: {}, pagination: { page: 2, perPage: 2 } });
    expect(p2.nextCursor).toBeNull();
  });

  it("caps the page size and never asks for a page below 1", () => {
    const r = LIVE_SCHEMA!.parcelsRequest({ cursor: "0", updatedSince: null, pageSize: 5000 });
    expect(r.body).toMatchObject({ pagination: { page: 1, perPage: 100 } });
  });

  it("syncs parcels without references when the key has no order access", async () => {
    stubMdm({
      "POST /api/v2/shipping/parcels/search": () => ({ pagination: pagination(1, false, 1), list: [parcel(1)] }),
      "POST /api/v2/orders/search": () => new Response("", { status: 403 }),
    });
    const p = await createLiveAdapter({ baseUrl: BASE, credential: KEY }).listParcels({ cursor: null, updatedSince: null, pageSize: 2 });
    expect(p.items[0]).toMatchObject({ trackingId: "MDM-P-1", reference: null });
  });

  it("retries the page when the order lookup is rate limited", async () => {
    stubMdm({
      "POST /api/v2/shipping/parcels/search": () => ({ pagination: pagination(1, false, 1), list: [parcel(1)] }),
      "POST /api/v2/orders/search": () => new Response("", { status: 429, headers: { "retry-after": "3" } }),
    });
    await expect(createLiveAdapter({ baseUrl: BASE, credential: KEY }).listParcels({ cursor: null, updatedSince: null, pageSize: 2 })).rejects.toMatchObject({ kind: "RATE_LIMIT", retryAfterMs: 3000 });
  });

  it("rejects a response that does not match GetParcelsResponse", async () => {
    stubMdm({ "POST /api/v2/shipping/parcels/search": () => ({ data: [] }) });
    await expect(createLiveAdapter({ baseUrl: BASE, credential: KEY }).listParcels({ cursor: null, updatedSince: null, pageSize: 2 })).rejects.toMatchObject({ kind: "BAD_RESPONSE" });
  });

  it("refuses any POST that is not a search", async () => {
    const calls = stubMdm({});
    await expect(mdmRequest(BASE, KEY, LIVE_SCHEMA!, { method: "POST", path: "/api/v2/shipping/parcels", body: {} })).rejects.toMatchObject({ kind: "CONFIG" });
    await expect(mdmRequest(BASE, KEY, LIVE_SCHEMA!, { method: "DELETE" as "GET", path: "/api/v2/orders/search" })).rejects.toMatchObject({ kind: "CONFIG" });
    expect(calls).toHaveLength(0);
  });
});

describe("MDM parcel mapping", () => {
  it("maps Parcel fields to the sync shape", () => {
    const p = mapMdmParcel(parcel(7));
    expect(p).toMatchObject({
      trackingId: "MDM-P-7",
      mdmOrderId: "MDM-O-7",
      status: "delivered",
      statusAt: new Date("2026-09-02T09:00:00.000Z"),
      currency: "DZD",
      // Assumed major units (verified on the first real sync): 4000 DZD → 400000 minor.
      codAmount: 400_000,
      shippingFee: 60_000,
      returnFee: 25_000,
      wilaya: "Alger",
      dispatchedAt: new Date("2026-09-01T08:00:00.000Z"),
      deliveredAt: new Date("2026-09-02T09:00:00.000Z"),
      returnedAt: null,
    });
    // History is sorted oldest first.
    expect(p.events.map((e) => e.status)).toEqual(["outForDelivery", "delivered"]);
  });

  it("tolerates nullable and missing fields", () => {
    const p = mapMdmParcel({ trackingId: "X1", orderId: null, status: "incoming", statusHistory: [], fees: null, pricing: { totalToPayFromClient: null } });
    expect(p).toMatchObject({ trackingId: "X1", mdmOrderId: null, codAmount: null, shippingFee: null, wilaya: null, currency: "DZD", statusAt: null, events: [] });
    expect(() => mapMdmParcel({ status: "delivered" })).toThrow(/trackingId/);
  });

  it("redacts client, courier and address PII from the stored payload", () => {
    const stored = JSON.stringify(redactPayload(mapMdmParcel(parcel(1)).raw));
    for (const pii of ["Amina", "0551111111", "0550000000", "Courier", "12 rue X", "36.7", "Seller"]) expect(stored).not.toContain(pii);
    expect(stored).toContain("MDM-P-1");
  });
});

describe("MDM status vocabulary", () => {
  it("normalizes camelCase MDM statuses and leaves ambiguous ones for review", () => {
    expect(statusKey("outForDelivery")).toBe("out_for_delivery");
    expect(statusKey("held_at_hub")).toBe("held_at_hub");
    expect(normalizeProviderStatus("outForDelivery")).toBe("SHIPPED");
    expect(normalizeProviderStatus("readyForDelivery")).toBe("SHIPPED");
    expect(normalizeProviderStatus("delivered")).toBe("DELIVERED");
    expect(normalizeProviderStatus("returned")).toBe("RETURNED");
    expect(normalizeProviderStatus("lost")).toBe("LOST");
    for (const s of ["postponed", "deliveryFailed", "deliveryAttemptFailed", "deliveredPartially", "incoming"]) expect(normalizeProviderStatus(s)).toBe("UNKNOWN");
  });
});
