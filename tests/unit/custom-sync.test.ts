import { describe, expect, it } from "vitest";
import { customSyncInput, describeCustomSync, matchesCustomSync, parseOrderIds, readCustomFilters, type CustomSyncCandidate, type CustomSyncFilters } from "@/domain/customSync";
import { rangeDays, shortDay } from "@/lib/dateRanges";
import { customOrderPlan, readStep, writeStep } from "@/server/mdm/custom";
import { LIVE_SCHEMA } from "@/server/mdm/live";

const base: CustomSyncFilters = { dateField: "placed", ad: "any", parcels: true };
const candidate: CustomSyncCandidate = {
  trackingId: "MO-1", externalId: "#1001", placedAt: new Date("2026-09-10T09:00:00Z"), statusAt: new Date("2026-09-14T09:00:00Z"),
  statuses: [{ key: "delivered", group: "delivered" }, { key: "out_for_delivery", group: "carrier" }],
  wilaya: "Béjaïa", deliveryType: "STOP_DESK", storeName: "Main store", productNames: ["Lampe LED"], hasAd: true,
};
const match = (f: Partial<CustomSyncFilters>, o: Partial<CustomSyncCandidate> = {}) => matchesCustomSync({ ...base, ...f }, { ...candidate, ...o });

describe("custom sync choices", () => {
  it("match on dates, statuses (MDM's or the app's), names, delivery, ad ID and order numbers", () => {
    expect(match({})).toBe(true);
    expect(match({ fromAt: "2026-09-10T09:00:00.000Z", toAt: "2026-09-10T09:00:00.000Z" })).toBe(true);
    expect(match({ fromAt: "2026-09-11T00:00:00.000Z" })).toBe(false);
    expect(match({ dateField: "status", fromAt: "2026-09-11T00:00:00.000Z" })).toBe(true);
    // No status date: the order date stands in.
    expect(match({ dateField: "status", toAt: "2026-09-12T00:00:00.000Z" }, { statusAt: null })).toBe(true);
    expect(match({ groups: ["carrier"] })).toBe(true);
    expect(match({ groups: ["returns"], statuses: ["out_for_delivery"] })).toBe(true);
    expect(match({ groups: ["returns"], statuses: ["returned"] })).toBe(false);
    expect(match({ wilayas: ["Oran", "bejaia"], stores: ["MAIN STORE"], products: ["lampe  led"] })).toBe(true);
    expect(match({ wilayas: ["Oran"] })).toBe(false);
    expect(match({ wilayas: ["Oran"] }, { wilaya: null })).toBe(false);
    expect(match({ deliveryType: "HOME" })).toBe(false);
    expect(match({ ad: "with" })).toBe(true);
    expect(match({ ad: "without" })).toBe(false);
    expect(match({ orderIds: ["1001"] })).toBe(true);
    expect(match({ orderIds: ["mo-1"] })).toBe(true);
    expect(match({ orderIds: ["ES-9"], mdmOrderIds: ["MO-1"] })).toBe(true);
    expect(match({ orderIds: ["ES-9"] })).toBe(false);
  });

  it("are checked and described in plain words", () => {
    expect(customSyncInput.safeParse({ from: "2026-09-30", to: "2026-09-01" }).success).toBe(false);
    expect(customSyncInput.safeParse({ from: "30/09/2026" }).success).toBe(false);
    expect(customSyncInput.parse({})).toEqual({ dateField: "placed", ad: "any", parcels: true });
    expect(parseOrderIds(" MO-1, #1002;MO-1\n 1003 ")).toEqual(["MO-1", "#1002", "1003"]);
    expect(describeCustomSync({ ...base, from: "2026-09-01", to: "2026-09-30" })).toEqual(["Placed 1 Sep 2026 to 30 Sep 2026"]);
    expect(describeCustomSync({ ...base, dateField: "status", from: "2026-10-04", to: "2026-10-04", groups: ["delivered", "returns"], statuses: ["out_for_delivery", "postponed"], wilayas: ["Oran"], deliveryType: "STOP_DESK", ad: "without", orderIds: ["MO-1", "MO-2"], parcels: false }))
      .toEqual(["Status changed on 4 Oct 2026", "Delivered, Returns +2 more", "Oran", "Stop desk", "No ad ID", "2 orders", "Orders only"]);
    expect(describeCustomSync({ ...base, stores: ["A", "B", "C"], orderIds: ["MO-7"] })).toEqual(["All dates", "3 stores", "Order MO-7"]);
    // Stored choices are read back; anything else is refused.
    expect(readCustomFilters({ ...base, fromAt: "2026-08-31T23:00:00.000Z", fallbackOrders: true })).toMatchObject({ fallbackOrders: true });
    expect(readCustomFilters(null)).toBeNull();
    expect(readCustomFilters({ dateField: "yesterday" })).toBeNull();
  });

  it("turn quick ranges into days", () => {
    expect(rangeDays("lastMonth", "2026-10-04", { from: "", to: "" })).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(rangeDays("7d", "2026-10-04", { from: "", to: "" })).toEqual({ from: "2026-09-28", to: "2026-10-04" });
    expect(shortDay("2026-09-01")).toBe("1 Sep 2026");
  });
});

describe("custom sync requests to MDM", () => {
  it("narrow MDM's order search by days and delivery, or look orders up by ID", () => {
    const f = { ...base, dateField: "status" as const, fromAt: "2026-08-31T23:00:00.000Z", toAt: "2026-09-30T22:59:59.999Z", deliveryType: "HOME" as const };
    const plan = customOrderPlan(f);
    expect(plan).toEqual({ updatedSince: null, passes: [{ statusDate: { start: new Date(f.fromAt), end: new Date(f.toAt) }, isStopDesk: false }] });
    const body = LIVE_SCHEMA!.orderSearchRequest!({ cursor: null, updatedSince: null, pageSize: 100, filters: plan.passes[0] }).body;
    expect(body).toEqual({ filters: { statusDate: { start: f.fromAt, end: f.toAt }, isStopDesk: false }, sortBy: { createdAt: "ASC" }, pagination: { page: 1, perPage: 100 } });
    // Refused filters: orders changed since the start day.
    expect(customOrderPlan({ ...f, fallbackOrders: true })).toEqual({ updatedSince: new Date(f.fromAt), passes: [{}] });
    expect(customOrderPlan({ ...base, orderIds: ["#1002"], mdmOrderIds: ["MO-2"] }).passes).toEqual([{ trackingIds: ["MO-2", "#1002", "1002"] }, { externalIds: ["#1002", "1002"] }]);
    const byId = LIVE_SCHEMA!.orderSearchRequest!({ cursor: "2", updatedSince: null, pageSize: 100, filters: { externalIds: ["1002"] } }).body;
    expect(byId).toMatchObject({ filters: { externalId: ["1002"] }, pagination: { page: 2 } });
    // The regular sync's request is unchanged.
    expect(LIVE_SCHEMA!.orderSearchRequest!({ cursor: null, updatedSince: null, pageSize: 100 }).body).toEqual({ filters: {}, sortBy: { updatedAt: "ASC" }, pagination: { page: 1, perPage: 100 } });
  });

  it("ask for parcels by MDM order, and resume where they stopped", () => {
    const r = LIVE_SCHEMA!.parcelsRequest({ cursor: null, updatedSince: null, pageSize: 100, mdmOrderIds: ["MO-1", "MO-2"] });
    expect(r.body).toEqual({ filters: { orderId: ["MO-1", "MO-2"] }, sortBy: { createdAt: "ASC" }, pagination: { page: 1, perPage: 100 } });
    expect(readStep(writeStep(3, "2"))).toEqual({ step: 3, page: "2" });
    expect(readStep(null)).toEqual({ step: 0, page: null });
    expect(readStep("7")).toEqual({ step: 0, page: null });
  });
});
