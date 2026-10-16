import { describe, expect, it } from "vitest";
import { adCostPerDelivered, AFTER_KEYS, BEFORE_KEYS, orderProfit, type OrderProfitInput } from "@/domain/orderProfit";

/** Buy 1, get 1 free at 2900 DZD; a piece costs 500. 80% confirmed, all shipped, 60% delivered. */
const base: OrderProfitInput = {
  price: 290000,
  pieces: 2,
  costPerPiece: 50000,
  deliveryFee: 40000,
  packagingFee: 5000,
  returnFee: 20000,
  callCenterFee: 10000,
  callCenterBasis: "PLACED_LEAD",
  otherFees: 0,
  confirmationRate: 0.8,
  shippingRate: 1,
  deliveryRate: 0.6,
  lostRate: 0,
  adCostPerOrder: 30000,
};

describe("one delivered order, step by step", () => {
  it("counts every piece of the offer, then what the orders that don't arrive cost", () => {
    const r = orderProfit(base);
    if (!r.ok) throw new Error(r.reason);
    expect(r.ordersPerDelivered).toBeCloseTo(1 / 0.48);
    expect(r.before).toEqual({ product: 100000, delivery: 45000, callCenter: 10000, otherFees: 0 });
    expect(r.beforeAds).toBe(135000);
    // 300 per order ÷ 80% ÷ 60%; 0.4 ÷ 0.6 parcels back per delivered order, each 450 + 200;
    // calls for the 1.08 orders placed that weren't delivered.
    expect(r.after).toEqual({ ads: 62500, returns: 43333, lost: 0, extraCalls: 10833 });
    expect(r.profit).toBe(135000 - 62500 - 43333 - 10833);
    expect(r.adCostPerConfirmed).toBe(37500);
    expect(r.adCostPerDelivered).toBe(62500);
    expect(r.breakevenAdCostPerOrder).toBe(Math.round((r.profit + r.after.ads) * 0.48));
    expect(r.margin).toBeCloseTo(r.profit / 290000);
    // The parts add up exactly.
    expect(base.price - BEFORE_KEYS.reduce((a, k) => a + r.before[k], 0) - AFTER_KEYS.reduce((a, k) => a + r.after[k], 0)).toBe(r.profit);
  });

  it("charges calls per confirmed order, and lost parcels their goods and delivery", () => {
    const r = orderProfit({ ...base, callCenterBasis: "CONFIRMED_ORDER", lostRate: 0.1 });
    if (!r.ok) throw new Error(r.reason);
    expect(r.after.extraCalls).toBe(Math.round(10000 * (1 / 0.6 - 1)));
    expect(r.after.lost).toBe(Math.round((0.1 / 0.6) * (100000 + 45000)));
    expect(r.after.returns).toBe(Math.round((0.3 / 0.6) * 65000));
  });

  it("leaves ads out when no campaign is linked, and refuses rates that send nothing", () => {
    const r = orderProfit({ ...base, adCostPerOrder: null });
    expect(r.ok && r.after.ads).toBe(0);
    expect(r.ok && r.adCostPerDelivered).toBeNull();
    expect(orderProfit({ ...base, confirmationRate: 0 })).toMatchObject({ ok: false });
    expect(orderProfit({ ...base, deliveryRate: 0 })).toMatchObject({ ok: false });
    expect(orderProfit({ ...base, deliveryRate: 0.8, lostRate: 0.3 })).toMatchObject({ ok: false });
  });

  it("turns a campaign's cost per order into a cost per delivered order", () => {
    expect(adCostPerDelivered(30000, { confirmationRate: 0.8, shippingRate: 1, deliveryRate: 0.6 })).toBe(62500);
    expect(adCostPerDelivered(30000, { confirmationRate: 0.8, shippingRate: 1.2, deliveryRate: 0.6 })).toBe(62500);
    expect(adCostPerDelivered(30000, { confirmationRate: null, shippingRate: 1, deliveryRate: 0.6 })).toBeNull();
    expect(adCostPerDelivered(null, { confirmationRate: 0.8, shippingRate: 1, deliveryRate: 0.6 })).toBeNull();
  });
});
