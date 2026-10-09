import { describe, expect, it } from "vitest";
import { mdmWords } from "@/domain/mdmAccount";
import { ACCOUNT_REQUESTS, createLiveAccountReader, parseArrivals, parseCapital, parseFees, parsePayoutBreakdown, parsePayouts, parsePrices, parseStock, parseWallet } from "@/server/mdm/live-account";
import type { MdmRequest } from "@/server/mdm/live";
import { MdmError } from "@/server/mdm/types";

// Shapes from MDM's OpenAPI document, with made-up values. Nobody real is in here.
const page = (list: unknown[], more = false) => ({ pagination: { page: 1, perPage: 100, total: list.length, hasMore: more, nextPage: more ? 2 : null }, list });

describe("MDM account responses", () => {
  it("read the wallet in minor units, split as MDM splits it", () => {
    const w = parseWallet({
      currency: "DZD", ready: 3400, notReady: 1200.5, paid: 150000, inUsd: { ready: 13, notReady: 4, paid: 600 },
      details: { gross: { notReady: 3900, ready: 3900, paid: 195000 }, refunds: { ready: 0, paid: 0 }, taxes: { notReady: 0, ready: 0, paid: 0 }, sourcing: { ready: 0, paid: 0, inUsd: {}, inEuro: {} }, addedCustomCharges: { ready: 500, paid: 0 }, deducedCustomCharges: { ready: 0, paid: 1000 } },
    });
    expect(w).toEqual({
      currency: "DZD", onHold: 120050, ready: 340000, paid: 15000000,
      details: { gross: { onHold: 390000, ready: 390000, paid: 19500000 }, refunds: { ready: 0, paid: 0 }, taxes: { onHold: 0, ready: 0, paid: 0 }, sourcing: { ready: 0, paid: 0 }, addedCharges: { ready: 50000, paid: 0 }, deductedCharges: { ready: 0, paid: 100000 } },
    });
    expect(() => parseWallet({ currency: "DZD" })).toThrow();
  });

  it("keep only the IDs from account lines, never the people or customers in them", () => {
    const res = parseFees(page([
      {
        trackingId: "L-1", sellerId: "S-1", entityId: "LP-1", type: "COD", subType: null, amount: 3900, grossAmount: 3900, totalTaxes: 0, currency: "DZD", status: "ready", paymentId: null,
        seller: { trackingId: "S-1", firstName: "Placeholder", lastName: "Seller" }, createdBy: { trackingId: "U-1", firstName: "Staff", lastName: "Member" }, notes: "free text",
        parcel: { trackingId: "LP-1", orderId: "MO-1", destinationAddress: { name: "Placeholder Customer", phone: "0550000000" } },
        createdAt: "2026-09-15T10:00:00.000Z", updatedAt: "2026-09-16T10:00:00.000Z",
      },
      { trackingId: "L-2", type: "CALL_CENTER", amount: "-100", currency: "DZD", status: "pending", lead: { trackingId: "MO-2", phone: "0550000001" }, createdAt: "2026-09-15T10:00:00.000Z" },
      { trackingId: "L-3", type: "COD", amount: "lots", createdAt: "2026-09-15T10:00:00.000Z" },
    ], true));
    expect(res).toMatchObject({ nextCursor: "2", unreadable: 1 });
    expect(res.items[0]).toEqual({
      id: "L-1", sellerId: "S-1", entityId: "LP-1", type: "COD", subType: null, amount: 390000, grossAmount: 390000, taxes: 0, currency: "DZD", status: "ready", payoutId: null,
      parcelTrackingId: "LP-1", orderTrackingId: "MO-1", createdAt: new Date("2026-09-15T10:00:00.000Z"), updatedAt: new Date("2026-09-16T10:00:00.000Z"),
    });
    expect(res.items[1]).toMatchObject({ amount: -10000, orderTrackingId: "MO-2", parcelTrackingId: null, updatedAt: new Date("2026-09-15T10:00:00.000Z") });
    expect(JSON.stringify(res)).not.toMatch(/Placeholder|Staff|0550|free text/);
  });

  it("read payouts and what they are made of", () => {
    const res = parsePayouts(page([
      { trackingId: "P-1", seller: { trackingId: "S-1", firstName: "Placeholder" }, currency: "DZD", amount: 15000, status: "confirmed", createdConfirmed: false, stores: [{ trackingId: "ST-1", name: "Main store" }], evidences: ["file-1"], createdAt: "2026-09-01T10:00:00.000Z", updatedAt: "2026-09-02T10:00:00.000Z" },
      { trackingId: "P-2", currency: "DZD", amount: 3400, status: "pending", createdAt: "2026-09-20T10:00:00.000Z" },
    ]));
    expect(res.items.map((p) => [p.id, p.amount, p.status, p.confirmed, p.sellerId, p.storeNames])).toEqual([["P-1", 1500000, "confirmed", true, "S-1", ["Main store"]], ["P-2", 340000, "pending", false, null, []]]);
    expect(res.nextCursor).toBeNull();
    expect(JSON.stringify(res)).not.toMatch(/Placeholder|file-1/);
    expect(parsePayoutBreakdown({ currency: "DZD", items: [{ type: "COD", count: 5, total: 19500, grossTotal: 19500 }, { type: "", total: 1 }], taxes: [{ type: "VAT", count: 5, total: -100 }] })).toEqual({
      currency: "DZD", items: [{ type: "COD", count: 5, total: 1950000, grossTotal: 1950000 }], taxes: [{ type: "VAT", count: 5, total: -10000 }],
    });
  });

  it("read the price list, stock, stock value and stock arrivals", () => {
    const prices = parsePrices({
      currency: "DZD",
      callCenter: { type: "standard", lead: 0, confirmed: 100, delivered: 0, upsellExtra: 50, currency: "DZD", changedBy: { firstName: "Staff" } },
      fulfillment: { type: "standard", dispatched: 50, delivered: 0, currency: "DZD", maxItems: 3, extraFeePerItem: 20 },
      shipping: { deliveryFees: [{ state: { id: "x", name: "Alger", code: "16" }, home: 400, stopdesk: 250, return: 200, exchange: 400 }, { state: {} }] },
      exchange: { usd: 245, euro: 0 },
    });
    expect(prices).toEqual({
      currency: "DZD",
      callCenter: { type: "standard", perLead: 0, perConfirmed: 10000, perDelivered: 0, upsellExtra: 5000 },
      fulfilment: { type: "standard", perDispatched: 5000, perDelivered: 0, maxItems: 3, extraPerItem: 2000 },
      delivery: [{ wilaya: "الجزائر", code: "16", home: 40000, stopDesk: 25000, return: 20000, exchange: 40000 }],
      usdRate: 245,
      euroRate: null,
    });
    // MDM may answer one stock row per warehouse.
    expect(parseStock(page([{ totalInbound: 100, available: 60, inDelivery: 10, lost: 2 }, { totalInbound: 50, available: 50, damaged: -3 }]))).toEqual({ totalInbound: 150, incoming: 0, available: 110, processing: 0, inDelivery: 10, delivered: 0, returning: 0, returned: 0, damaged: 0, discharged: 0, lost: 2 });
    expect(parseCapital({ totalInbound: { count: 150, capitalNative: 135000, capitalUsd: 550 }, available: { count: 110, capitalNative: 99000 } }, "DZD").buckets).toMatchObject({ totalInbound: { units: 150, value: 13500000 }, available: { units: 110, value: 9900000 }, lost: { units: 0, value: 0 } });
    expect(() => parseCapital({}, "DZD")).toThrow();
    expect(parseArrivals(page([{ trackingId: "A-1", status: "completed", operation: "inbound", products: [{ name: "Lamp", sku: "LMP", expectedQuantity: 100 }], expectedItems: [], receivedItems: [{ trackingId: "i1", damaged: false }, { trackingId: "i2", damaged: true }], notes: "free text", createdAt: "2026-08-01T09:00:00.000Z" }])).items).toEqual([
      { id: "A-1", status: "completed", operation: "inbound", products: [{ name: "Lamp", sku: "LMP", expected: 100 }], expectedUnits: 100, receivedUnits: 2, damagedUnits: 1, createdAt: new Date("2026-08-01T09:00:00.000Z"), updatedAt: new Date("2026-08-01T09:00:00.000Z") },
    ]);
  });

  it("only ever read: GETs, or POSTs to search endpoints, with IDs checked before they go in a path", () => {
    const q = { cursor: "3", updatedSince: new Date("2026-09-01T00:00:00Z"), pageSize: 500 };
    const all: MdmRequest[] = [
      ACCOUNT_REQUESTS.profile(), ACCOUNT_REQUESTS.wallet(), ACCOUNT_REQUESTS.payouts(q), ACCOUNT_REQUESTS.payoutBreakdown("P-1"), ACCOUNT_REQUESTS.fees(q), ACCOUNT_REQUESTS.prices("S-1"),
      ACCOUNT_REQUESTS.variants(q), ACCOUNT_REQUESTS.products(["PR-1"]), ACCOUNT_REQUESTS.stock({ productId: "PR-1", id: "V-1" }), ACCOUNT_REQUESTS.capital(), ACCOUNT_REQUESTS.arrivals(q),
    ];
    for (const r of all) expect(r.method === "GET" || r.path.endsWith("/search")).toBe(true);
    expect(ACCOUNT_REQUESTS.fees(q).body).toEqual({ filters: { updatedAt: { start: "2026-09-01T00:00:00.000Z" } }, sortBy: { updatedAt: "ASC" }, pagination: { page: 3, perPage: 100 } });
    expect(() => ACCOUNT_REQUESTS.prices("../admin")).toThrow(MdmError);
    expect(() => ACCOUNT_REQUESTS.stock({ productId: "PR-1", id: "V 1" })).toThrow(MdmError);
  });

  it("name variants after their product, and still list them when product names can't be read", async () => {
    const variants = page([{ trackingId: "V-1", productId: "PR-1", name: "Black", sku: "LMP-B", currency: "DZD", pricing: { selling: 3900 }, archived: false }]);
    const calls: string[] = [];
    const reader = createLiveAccountReader(async (req) => {
      calls.push(req.path);
      if (req.path === "/api/v2/products/search") return page([{ trackingId: "PR-1", name: "Lamp", currency: "DZD", pricing: { selling: 3900, purchasing: 900 } }]);
      return variants;
    });
    expect((await reader.variants({ cursor: null, updatedSince: null, pageSize: 100 })).items).toEqual([{ id: "V-1", productId: "PR-1", productName: "Lamp", variantName: "Black", sku: "LMP-B", sellingPrice: 390000, purchasePrice: 90000, currency: "DZD", archived: false }]);
    // Names are remembered for the next page.
    await reader.variants({ cursor: "2", updatedSince: null, pageSize: 100 });
    expect(calls.filter((c) => c === "/api/v2/products/search")).toHaveLength(1);

    const refused = createLiveAccountReader(async (req) => {
      if (req.path === "/api/v2/products/search") throw new MdmError("MDM refused access", "AUTH");
      return variants;
    });
    expect((await refused.variants({ cursor: null, updatedSince: null, pageSize: 100 })).items[0]).toMatchObject({ productName: "Black", purchasePrice: null });
    await expect(createLiveAccountReader(async () => ({ nope: true })).wallet()).rejects.toMatchObject({ kind: "BAD_RESPONSE" });
  });

  it("turn MDM's words into plain ones", () => {
    expect(mdmWords("DELIVERY_FEE")).toBe("Delivery fee");
    expect(mdmWords("callCenterLead")).toBe("Call center lead");
    expect(mdmWords("COD")).toBe("COD");
    expect(mdmWords("cod_fee")).toBe("COD fee");
    expect(mdmWords(null)).toBe("");
  });
});
