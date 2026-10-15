/**
 * One order, step by step: what a delivered order of a product earns before ads, and what it
 * really earns once ads, confirmations, returns and lost parcels are counted. Pure functions only;
 * money in integer minor units, rates in [0, 1].
 *
 * Of every order placed, c are confirmed and c × s shipped. Of the shipped parcels d are
 * delivered, L lost and the rest come back. So one delivered order takes 1 ÷ (c × s × d) orders
 * placed, and what the others cost (their ads, calls, returns and lost parcels) is carried by
 * the orders that are delivered. Every amount below is per delivered order, and they add up.
 */
import { msg } from "@/i18n/core";
import type { CallCenterBasis } from "./profitTracker";

export type OrderProfitInput = {
  /** What the customer pays for one order: the offer's price, without delivery. */
  price: number;
  /** Pieces one order sends (2 for "buy 1, get 1 free"). */
  pieces: number;
  costPerPiece: number;
  /** Per shipped parcel. */
  deliveryFee: number;
  /** Per shipped parcel. */
  packagingFee: number;
  /** Per returned parcel. */
  returnFee: number;
  callCenterFee: number;
  callCenterBasis: CallCenterBasis;
  /** Any other fee MDM takes per delivered order. */
  otherFees: number;
  confirmationRate: number;
  /** Confirmed orders that are shipped. */
  shippingRate: number;
  /** Shipped parcels delivered, of those that finished. */
  deliveryRate: number;
  /** Shipped parcels lost, of those that finished. */
  lostRate: number;
  /** Ad spend per order placed. Null when no ads count for the product. */
  adCostPerOrder: number | null;
};

/** What one delivered order costs before ads. */
export const BEFORE_KEYS = ["product", "delivery", "callCenter", "otherFees"] as const;
export type BeforeKey = (typeof BEFORE_KEYS)[number];
/** What the orders that don't arrive, and the ads, add to each delivered order. */
export const AFTER_KEYS = ["ads", "returns", "lost", "extraCalls"] as const;
export type AfterKey = (typeof AFTER_KEYS)[number];

export type OrderProfit =
  | { ok: false; reason: string }
  | {
      ok: true;
      /** Orders placed for one delivered order: 1 ÷ (c × s × d). */
      ordersPerDelivered: number;
      /** Shipped parcels that come back, of those that finished. */
      returnRate: number;
      before: Record<BeforeKey, number>;
      /** Price − the costs of the order itself. */
      beforeAds: number;
      after: Record<AfterKey, number>;
      /** What a delivered order really earns, after everything. */
      profit: number;
      /** Ad spend per confirmed order, and per delivered order. Null without ads. */
      adCostPerConfirmed: number | null;
      adCostPerDelivered: number | null;
      /** The most an order placed can cost in ads before delivered orders earn nothing. */
      breakevenAdCostPerOrder: number;
      /** Profit ÷ price, null without a price. */
      margin: number | null;
    };

/** Why the numbers can't give a profit, in English: the page shows it through `t()`. */
export function validateOrderProfit(i: OrderProfitInput): string | null {
  if (!(i.confirmationRate > 0)) return msg("With a 0% confirmation rate no order is ever sent.");
  if (!(i.shippingRate > 0)) return msg("With a 0% shipping rate no order is ever sent.");
  if (!(i.deliveryRate > 0)) return msg("With a 0% delivery rate no order is ever delivered.");
  if (i.deliveryRate + i.lostRate > 1.000001) return msg("Delivered + lost can't be more than 100%.");
  return null;
}

export function orderProfit(i: OrderProfitInput): OrderProfit {
  const reason = validateOrderProfit(i);
  if (reason) return { ok: false, reason };
  const c = i.confirmationRate;
  const s = i.shippingRate;
  const d = i.deliveryRate;
  const L = i.lostRate;
  const q = Math.max(0, 1 - d - L);
  const ordersPerDelivered = 1 / (c * s * d);
  const goods = Math.max(1, i.pieces) * i.costPerPiece;
  const parcel = i.deliveryFee + i.packagingFee;

  const before: Record<BeforeKey, number> = {
    product: goods,
    delivery: parcel,
    callCenter: i.callCenterFee,
    otherFees: i.otherFees,
  };
  const beforeAds = i.price - BEFORE_KEYS.reduce((a, k) => a + before[k], 0);

  // Calls paid per delivered order: one per order placed, or per order confirmed.
  const calls = i.callCenterBasis === "CONFIRMED_ORDER" ? 1 / (s * d) : ordersPerDelivered;
  const after: Record<AfterKey, number> = {
    ads: i.adCostPerOrder === null ? 0 : Math.round(i.adCostPerOrder * ordersPerDelivered),
    returns: Math.round((q / d) * (parcel + i.returnFee)),
    lost: Math.round((L / d) * (goods + parcel)),
    extraCalls: Math.round(i.callCenterFee * (calls - 1)),
  };
  const profit = beforeAds - AFTER_KEYS.reduce((a, k) => a + after[k], 0);
  const beforeAdsReal = profit + after.ads;
  return {
    ok: true,
    ordersPerDelivered,
    returnRate: q,
    before,
    beforeAds,
    after,
    profit,
    adCostPerConfirmed: i.adCostPerOrder === null ? null : Math.round(i.adCostPerOrder / c),
    adCostPerDelivered: i.adCostPerOrder === null ? null : after.ads,
    breakevenAdCostPerOrder: Math.round(beforeAdsReal / ordersPerDelivered),
    margin: i.price > 0 ? profit / i.price : null,
  };
}

/**
 * Ad spend per order placed ÷ confirmation rate ÷ shipping rate ÷ delivery rate: what ads cost
 * for each delivered order, for a campaign or a product. Null when a rate is missing or zero.
 */
export function adCostPerDelivered(adCostPerOrder: number | null, rates: { confirmationRate: number | null; shippingRate: number | null; deliveryRate: number | null }): number | null {
  const { confirmationRate: c, shippingRate: s, deliveryRate: d } = rates;
  if (adCostPerOrder === null || !c || !s || !d) return null;
  return Math.round(adCostPerOrder / (c * Math.min(1, s) * d));
}
