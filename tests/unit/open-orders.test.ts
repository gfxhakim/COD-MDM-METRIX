import { describe, expect, it } from "vitest";
import type { CostTerms, OrderFact, ParcelFact } from "@/domain/economics";
import { addOpen, expectedCash, expectedProfit, noOpenOrders, openOrder, openStage, settledRates, WAITING_DAYS, type OpenOrderFact } from "@/domain/openOrders";
import { orderProfit } from "@/domain/orderProfit";
import { economicsDefaultsSchema } from "@/domain/settings";

/** Buy 1, get 1 free at 2900 DZD: 2 pieces of 500, delivery 400, packaging 50, return 200, call 100. */
const terms: CostTerms = { salePrice: 290000, sourcingCost: 50000, forwardShippingFee: 40000, rtoFee: 20000, callCenterFee: 10000, packagingFee: 5000 };
const defaults = economicsDefaultsSchema.parse({ callCenterBasis: "CONFIRMED_ORDER" });
const resolve = () => terms;
const now = new Date("2026-10-16T12:00:00Z");
const parcel = (status: ParcelFact["status"], extra: Partial<ParcelFact> = {}): ParcelFact => ({ status, codAmount: 290000, shippingFee: null, returnFee: null, dispatched: status !== "PENDING" && status !== "CANCELED", ...extra });
const order = (parcels: ParcelFact[], extra: Partial<OpenOrderFact> = {}): OpenOrderFact => ({
  id: "o", placedAt: new Date("2026-10-14T10:00:00Z"), confirmed: true, callAttempts: null, productId: "p", creativeId: "c", wilaya: "Oran",
  lines: [{ productId: "p", quantity: 2 }], parcels, remittedCash: 0, canceled: false, codAmount: 290000, ...extra,
});

describe("orders not finished yet", () => {
  it("tells where an order stands, and leaves finished, canceled and long-waiting ones out", () => {
    expect(openStage(order([parcel("SHIPPED")]), now)).toBe("road");
    expect(openStage(order([parcel("UNKNOWN", { dispatched: true })]), now)).toBe("road");
    // A copy sent after a return is on the road again; one sent after a delivery isn't open.
    expect(openStage(order([parcel("RETURNED"), parcel("SHIPPED", { followUp: true })]), now)).toBe("road");
    expect(openStage(order([parcel("DELIVERED"), parcel("SHIPPED", { followUp: true })]), now)).toBeNull();
    for (const s of ["DELIVERED", "RETURNED", "LOST", "EXCHANGED"] as const) expect(openStage(order([parcel(s)]), now)).toBeNull();
    expect(openStage(order([parcel("CONFIRMED", { dispatched: false })]), now)).toBe("preparing");
    expect(openStage(order([], { confirmed: false }), now)).toBe("waiting");
    expect(openStage(order([], { confirmed: false, canceled: true }), now)).toBeNull();
    expect(openStage(order([], { confirmed: false, placedAt: new Date(now.getTime() - (WAITING_DAYS + 1) * 86_400_000) }), now)).toBeNull();
  });

  it("adds up what each open order would collect and cost", () => {
    const road = openOrder(order([parcel("SHIPPED", { shippingFee: 45000 })]), resolve, defaults, now);
    expect(road).toEqual({ stage: "road", sums: { orders: 1, cash: 290000, goods: 100000, shipping: 45000, packaging: 5000, returnFee: 20000, calls: 0 } });
    // Waiting: its call is paid only once it is confirmed, so it is still to come.
    const waiting = openOrder(order([], { confirmed: false, codAmount: 310000 }), resolve, defaults, now);
    expect(waiting).toEqual({ stage: "waiting", sums: { orders: 1, cash: 310000, goods: 100000, shipping: 40000, packaging: 5000, returnFee: 20000, calls: 10000 } });
    const perLead = openOrder(order([], { confirmed: false }), resolve, economicsDefaultsSchema.parse({ callCenterBasis: "PLACED_LEAD" }), now);
    expect(perLead?.sums.calls).toBe(0);
  });

  it("expects each stage at the rates: shipped first, then sent, then confirmed", () => {
    const open = noOpenOrders();
    const add = (o: OrderFact) => {
      const r = openOrder(o, resolve, defaults, now);
      if (r) addOpen(open, r.stage, r.sums);
    };
    add(order([parcel("SHIPPED")]));
    add(order([parcel("CONFIRMED", { dispatched: false })]));
    add(order([], { confirmed: false }));
    const rates = { confirmation: 0.8, shipping: 0.9, delivery: 0.75, lost: 0.05 };
    const shipped = 0.75 * (290000 - 100000) - 40000 - 5000 - 0.2 * 20000;
    const e = expectedProfit(open, rates);
    expect(e.road).toBe(Math.round(shipped));
    expect(e.preparing).toBe(Math.round(0.9 * shipped));
    expect(e.waiting).toBe(Math.round(0.8 * (0.9 * shipped - 10000)));
    expect(e.total).toBe(e.road + e.preparing + e.waiting);
    expect(expectedCash(open, rates)).toBe(Math.round(0.75 * 290000 * (1 + 0.9 + 0.9 * 0.8)));
  });

  it("matches one delivered order's profit for a fresh order, ads aside", () => {
    // A fresh order should bring what one delivered order earns × the share of orders delivered.
    const open = noOpenOrders();
    const r = openOrder(order([], { confirmed: false }), resolve, defaults, now)!;
    addOpen(open, r.stage, r.sums);
    const rates = { confirmation: 0.7, shipping: 0.95, delivery: 0.65, lost: 0 };
    const one = orderProfit({ price: 290000, pieces: 2, costPerPiece: 50000, deliveryFee: 40000, packagingFee: 5000, returnFee: 20000, callCenterFee: 10000, callCenterBasis: "CONFIRMED_ORDER", otherFees: 0, confirmationRate: 0.7, shippingRate: 0.95, deliveryRate: 0.65, lostRate: 0, adCostPerOrder: 0 });
    if (!one.ok) throw new Error(one.reason);
    expect(expectedProfit(open, rates).total).toBeCloseTo(one.profit / one.ordersPerDelivered, -1);
  });

  it("reads rates only from orders whose answer is known", () => {
    const open = noOpenOrders();
    open.waiting.orders = 20;
    open.preparing.orders = 5;
    expect(settledRates({ placed: 100, confirmed: 60, shipped: 52, finished: 40, delivered: 30, lost: 2 }, open)).toEqual({ confirmation: 0.75, shipping: 52 / 55, delivery: 0.75, lost: 0.05 });
    expect(settledRates({ placed: 0, confirmed: 0, shipped: 0, finished: 0, delivered: 0, lost: 0 }, noOpenOrders())).toEqual({ confirmation: null, shipping: null, delivery: null, lost: null });
  });
});
