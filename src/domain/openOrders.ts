/**
 * Orders that aren't finished yet, and what they should still bring. Pure functions only; money in
 * integer minor units, rates in [0, 1].
 *
 * An order placed in the days picked has already cost its ads and, depending on the call center
 * basis, its call. Until its parcel is delivered or comes back, the real profit counts nothing for
 * it, so the newest days always look like a loss. The Profit tracker adds what these orders should
 * still bring at the product's own rates:
 *
 *   on the road   d × (cash − goods) − shipping − packaging − q × return fee      q = 1 − d − L
 *   preparing     s × (the same, for an order that hasn't left yet)
 *   waiting       c × (s × (the same) − its call, when calls are paid per confirmed order)
 *
 * c = confirmation, s = shipping, d = delivery and L = lost rates (d and L of finished parcels).
 * Goods count only when delivered: a returned parcel's pieces go back to stock, as in
 * src/domain/economics.ts, so real and expected profit add up the same way.
 */
import { isInTransit, isShipped, type CostResolver, type CostTerms, type OrderFact } from "@/domain/economics";
import type { EconomicsDefaults } from "@/domain/settings";

/** Orders not answered by the call center count as waiting for this many days, then as not confirmed. */
export const WAITING_DAYS = 7;
const DAY_MS = 86_400_000;

export const OPEN_STAGES = ["road", "preparing", "waiting"] as const;
export type OpenStage = (typeof OPEN_STAGES)[number];

/** What a group of open orders is worth before rates: their cash if delivered and what sending them costs. */
export type OpenSums = { orders: number; cash: number; goods: number; shipping: number; packaging: number; returnFee: number; calls: number };
export type OpenOrders = Record<OpenStage, OpenSums>;

const ZERO: OpenSums = Object.freeze({ orders: 0, cash: 0, goods: 0, shipping: 0, packaging: 0, returnFee: 0, calls: 0 });
export const noOpenOrders = (): OpenOrders => ({ road: { ...ZERO }, preparing: { ...ZERO }, waiting: { ...ZERO } });

/** An order's own fields the stage needs, on top of the facts every report reads. */
export type OpenOrderFact = OrderFact & { canceled?: boolean; codAmount?: number };

/**
 * Where an order not finished yet stands, or null once it is finished (delivered, returned, lost,
 * exchanged), canceled, or waited longer than WAITING_DAYS for the call center.
 */
export function openStage(order: OpenOrderFact, now: Date): OpenStage | null {
  const shipped = order.parcels.filter(isShipped);
  if (shipped.length) {
    // Delivered wins over a parcel still on the road (an exchange sent after a delivery), as in economics.
    if (shipped.some((p) => p.status === "DELIVERED")) return null;
    return shipped.some(isInTransit) ? "road" : null;
  }
  if (order.canceled) return null;
  if (order.confirmed) return "preparing";
  return now.getTime() - order.placedAt.getTime() <= WAITING_DAYS * DAY_MS ? "waiting" : null;
}

/** One open order's stage and amounts, or null when it isn't open. */
export function openOrder(order: OpenOrderFact, resolveCost: CostResolver, defaults: EconomicsDefaults, now: Date): { stage: OpenStage; sums: OpenSums } | null {
  const stage = openStage(order, now);
  if (!stage) return null;
  const terms: CostTerms = resolveCost(order.productId, order.placedAt) ?? {
    salePrice: 0, sourcingCost: 0, forwardShippingFee: defaults.forwardShippingFee, rtoFee: defaults.rtoFee, callCenterFee: defaults.callCenterFee, packagingFee: defaults.packagingFee,
  };
  let goods = 0;
  for (const line of order.lines) {
    const lineTerms = line.productId === order.productId ? terms : resolveCost(line.productId, order.placedAt);
    goods += line.quantity * (lineTerms?.sourcingCost ?? 0);
  }
  const sums: OpenSums = { ...ZERO, orders: 1, goods };
  if (stage === "road") {
    for (const p of order.parcels.filter(isInTransit)) {
      sums.cash += p.codAmount;
      sums.shipping += p.shippingFee ?? terms.forwardShippingFee;
      sums.packaging += terms.packagingFee;
      sums.returnFee += p.returnFee ?? terms.rtoFee;
    }
  } else {
    // Not sent yet: the order's own amount, else what its parcel would collect.
    const parcelCash = order.parcels.filter((p) => p.status !== "CANCELED").reduce((a, p) => Math.max(a, p.codAmount), 0);
    sums.cash = order.codAmount && order.codAmount > 0 ? order.codAmount : parcelCash;
    sums.shipping = terms.forwardShippingFee;
    sums.packaging = terms.packagingFee;
    sums.returnFee = terms.rtoFee;
    // Paid per confirmed order: a waiting order only costs its call if it is confirmed.
    if (stage === "waiting" && defaults.callCenterBasis === "CONFIRMED_ORDER") sums.calls = terms.callCenterFee;
  }
  return { stage, sums };
}

export function addOpen(into: OpenOrders, stage: OpenStage, s: OpenSums) {
  const t = into[stage];
  t.orders += s.orders;
  t.cash += s.cash;
  t.goods += s.goods;
  t.shipping += s.shipping;
  t.packaging += s.packaging;
  t.returnFee += s.returnFee;
  t.calls += s.calls;
}

export type ExpectRates = { confirmation: number; shipping: number; delivery: number; lost: number };

/** What one shipped group should leave once its parcels finish. */
function onceShipped(s: OpenSums, r: ExpectRates) {
  const q = Math.max(0, 1 - r.delivery - r.lost);
  return r.delivery * (s.cash - s.goods) - s.shipping - s.packaging - q * s.returnFee;
}

/** What the open orders should still bring, by stage, at these rates. */
export function expectedProfit(open: OpenOrders, r: ExpectRates) {
  const road = Math.round(onceShipped(open.road, r));
  const preparing = Math.round(r.shipping * onceShipped(open.preparing, r));
  const waiting = Math.round(r.confirmation * (r.shipping * onceShipped(open.waiting, r) - open.waiting.calls));
  return { road, preparing, waiting, total: road + preparing + waiting };
}

/** What the orders' parcels should still collect, by stage: their cash at these rates. */
export function expectedCash(open: OpenOrders, r: ExpectRates) {
  return Math.round(r.delivery * (open.road.cash + r.shipping * (open.preparing.cash + r.confirmation * open.waiting.cash)));
}

export type RateCounts = { placed: number; confirmed: number; shipped: number; finished: number; delivered: number; lost: number };

/**
 * Rates from orders whose answer is known: orders still waiting for the call center are left out of
 * the confirmation rate, and confirmed orders not sent yet out of the shipping rate. Null parts have
 * nothing to read from.
 */
export function settledRates(c: RateCounts, open: OpenOrders) {
  const decided = c.placed - open.waiting.orders;
  const sendable = c.confirmed - open.preparing.orders;
  return {
    confirmation: decided > 0 ? Math.min(1, c.confirmed / decided) : null,
    shipping: sendable > 0 ? Math.min(1, c.shipped / sendable) : null,
    delivery: c.finished > 0 ? c.delivered / c.finished : null,
    lost: c.finished > 0 ? c.lost / c.finished : null,
  };
}
