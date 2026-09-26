/**
 * COD economics engine. Pure functions only: no database, no React.
 *
 * Conventions
 * - Money is integer minor units. Rates are plain numbers in [0, 1] or null when the
 *   denominator is zero ("Not enough data"), never NaN or Infinity.
 * - Orders and parcels are counted separately: one order can have several parcels.
 * - Observed carrier fees on a parcel win over cost-version assumptions.
 */
import type { NormalizedStatus } from "@prisma/client";
import type { EconomicsDefaults } from "@/domain/settings";

export type CostTerms = {
  salePrice: number;
  sourcingCost: number;
  forwardShippingFee: number;
  rtoFee: number;
  callCenterFee: number;
  packagingFee: number;
};

export type ParcelFact = {
  status: NormalizedStatus;
  codAmount: number;
  shippingFee: number | null;
  returnFee: number | null;
  dispatched: boolean;
};

export type LineFact = { productId: string | null; quantity: number };

export type OrderFact = {
  id: string;
  placedAt: Date;
  confirmed: boolean;
  callAttempts: number | null;
  productId: string | null;
  creativeId: string | null;
  wilaya: string | null;
  lines: LineFact[];
  parcels: ParcelFact[];
  /** Gross COD actually remitted for this order (REMITTED ± ADJUSTMENT cash events). */
  remittedCash: number;
};

/** Resolves the cost version in effect for a product at a date. */
export type CostResolver = (productId: string | null, at: Date) => CostTerms | null;

export type Counts = {
  placed: number;
  confirmed: number;
  shipped: number;
  delivered: number;
  returned: number;
  lost: number;
  exchanged: number;
  inTransit: number;
  unknownStatus: number;
  deliveredUnits: number;
  /** Orders with at least one delivered parcel (used for overhead allocation). */
  deliveredOrders: number;
  missingCostOrders: number;
};

export type MoneyTotals = {
  deliveredRevenue: number;
  remittedCash: number;
  cashInTransit: number;
  cogs: number;
  outboundShipping: number;
  rtoCost: number;
  /** Forward shipping + RTO fee + packaging burned on returned parcels. */
  rtoLoss: number;
  callCenterCost: number;
  packagingCost: number;
};

export type Totals = Counts & MoneyTotals;

export const ZERO_TOTALS: Totals = Object.freeze({
  placed: 0, confirmed: 0, shipped: 0, delivered: 0, returned: 0, lost: 0, exchanged: 0, inTransit: 0, unknownStatus: 0,
  deliveredUnits: 0, deliveredOrders: 0, missingCostOrders: 0,
  deliveredRevenue: 0, remittedCash: 0, cashInTransit: 0, cogs: 0, outboundShipping: 0, rtoCost: 0, rtoLoss: 0, callCenterCost: 0, packagingCost: 0,
});

// ───────────── Parcel classification ─────────────

const CARRIER_FLOW: ReadonlySet<NormalizedStatus> = new Set(["SHIPPED", "DELIVERED", "RETURNED", "LOST", "EXCHANGED"]);

/** Shipped = entered the carrier flow. An UNKNOWN status counts only if the parcel was dispatched. */
export function isShipped(p: Pick<ParcelFact, "status" | "dispatched">): boolean {
  return CARRIER_FLOW.has(p.status) || (p.status === "UNKNOWN" && p.dispatched);
}

/** Shipped and not yet in a terminal state: SHIPPED, or UNKNOWN after dispatch. */
export function isInTransit(p: Pick<ParcelFact, "status" | "dispatched">): boolean {
  return p.status === "SHIPPED" || (p.status === "UNKNOWN" && p.dispatched);
}

// ───────────── Safe arithmetic ─────────────

export function safeRate(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

/** Money ÷ count, rounded to minor units. Null when the count is zero. */
export function perUnit(amount: number, count: number): number | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return Math.round(amount / count);
}

// ───────────── Per-order economics ─────────────

function fallbackTerms(d: EconomicsDefaults): CostTerms {
  return { salePrice: 0, sourcingCost: 0, forwardShippingFee: d.forwardShippingFee, rtoFee: d.rtoFee, callCenterFee: d.callCenterFee, packagingFee: d.packagingFee };
}

/**
 * Economics of one order. Partial delivery: delivered units per line are
 * quantity × (delivered parcels ÷ non-canceled parcels), rounded, because parcels
 * do not say which lines they contain.
 */
export function orderEconomics(order: OrderFact, resolveCost: CostResolver, defaults: EconomicsDefaults): Totals {
  const primaryTerms = resolveCost(order.productId, order.placedAt);
  const terms = primaryTerms ?? fallbackTerms(defaults);
  let missingCost = primaryTerms === null && order.lines.length > 0;

  const t: Totals = { ...ZERO_TOTALS, placed: 1, confirmed: order.confirmed ? 1 : 0, remittedCash: order.remittedCash };
  let activeParcels = 0;
  for (const p of order.parcels) {
    if (p.status !== "CANCELED") activeParcels++;
    if (p.status === "UNKNOWN") t.unknownStatus++;
    if (!isShipped(p)) continue;
    const ship = p.shippingFee ?? terms.forwardShippingFee;
    t.shipped++;
    t.outboundShipping += ship;
    t.packagingCost += terms.packagingFee;
    if (p.status === "DELIVERED") {
      t.delivered++;
      t.deliveredRevenue += p.codAmount;
    } else if (p.status === "RETURNED") {
      const rto = p.returnFee ?? terms.rtoFee;
      t.returned++;
      t.rtoCost += rto;
      t.rtoLoss += ship + rto + terms.packagingFee;
    } else if (p.status === "LOST") {
      t.lost++;
    } else if (p.status === "EXCHANGED") {
      t.exchanged++;
    } else if (isInTransit(p)) {
      t.inTransit++;
      t.cashInTransit += p.codAmount;
    }
  }

  if (t.delivered > 0) {
    t.deliveredOrders = 1;
    const fraction = activeParcels > 0 ? t.delivered / activeParcels : 0;
    for (const line of order.lines) {
      const units = Math.round(line.quantity * fraction);
      const lineTerms = line.productId === order.productId ? primaryTerms : resolveCost(line.productId, order.placedAt);
      if (!lineTerms) missingCost = true;
      t.deliveredUnits += units;
      t.cogs += units * (lineTerms?.sourcingCost ?? 0);
    }
  }

  switch (defaults.callCenterBasis) {
    case "PLACED_LEAD":
      t.callCenterCost = terms.callCenterFee;
      break;
    case "CONFIRMED_ORDER":
      t.callCenterCost = order.confirmed ? terms.callCenterFee : 0;
      break;
    case "CALL_ATTEMPT":
      t.callCenterCost = terms.callCenterFee * Math.max(0, order.callAttempts ?? 1);
      break;
  }
  t.missingCostOrders = missingCost ? 1 : 0;
  return t;
}

export function addTotals(a: Totals, b: Totals): Totals {
  const out = { ...a };
  for (const k of Object.keys(ZERO_TOTALS) as (keyof Totals)[]) out[k] = a[k] + b[k];
  return out;
}

export function sumTotals(list: Iterable<Totals>): Totals {
  let acc: Totals = { ...ZERO_TOTALS };
  for (const t of list) acc = addTotals(acc, t);
  return acc;
}

// ───────────── Profit metrics ─────────────

export type RevenueView = "DELIVERED" | "REMITTED";

export type Metrics = Totals & {
  revenueView: RevenueView;
  /** Revenue used for profit under the selected view. */
  revenue: number;
  adSpend: number;
  allocatedOverhead: number;
  trueNetProfit: number;
  truePoas: number | null;
  confirmationRate: number | null;
  shippingRate: number | null;
  deliveryRate: number | null;
  returnRate: number | null;
  placedCpa: number | null;
  cpco: number | null;
  cpdo: number | null;
};

export function computeMetrics(totals: Totals, adSpend: number, allocatedOverhead: number, view: RevenueView): Metrics {
  const revenue = view === "DELIVERED" ? totals.deliveredRevenue : totals.remittedCash;
  const trueNetProfit =
    revenue - adSpend - totals.cogs - totals.outboundShipping - totals.rtoCost - totals.callCenterCost - totals.packagingCost - allocatedOverhead;
  return {
    ...totals,
    revenueView: view,
    revenue,
    adSpend,
    allocatedOverhead,
    trueNetProfit,
    truePoas: safeRate(trueNetProfit, adSpend),
    confirmationRate: safeRate(totals.confirmed, totals.placed),
    shippingRate: safeRate(totals.shipped, totals.confirmed),
    deliveryRate: safeRate(totals.delivered, totals.shipped),
    returnRate: safeRate(totals.returned, totals.shipped),
    placedCpa: perUnit(adSpend, totals.placed),
    cpco: perUnit(adSpend, totals.confirmed),
    cpdo: perUnit(adSpend, totals.delivered),
  };
}

// ───────────── Overhead allocation ─────────────

export type OverheadPolicy = EconomicsDefaults["overheadPolicy"];
export type AllocationGroup = { key: string; productId: string | null; deliveredOrders: number; deliveredRevenue: number };
export type ExpenseFact = { amount: number; allocation: "GLOBAL" | "PRODUCT"; productId: string | null };

/** Split `amount` across weights with the largest-remainder method so parts sum exactly. */
export function splitByWeight(amount: number, weights: readonly number[]): number[] | null {
  const total = weights.reduce((a, w) => a + Math.max(0, w), 0);
  if (total <= 0) return null;
  const raw = weights.map((w) => (amount * Math.max(0, w)) / total);
  const parts = raw.map((r) => Math.floor(r));
  let rest = amount - parts.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; rest > 0 && k < order.length; k++, rest--) parts[order[k].i]++;
  return parts;
}

/**
 * Allocates expenses to groups (products, creatives, wilayas…).
 * Global expenses follow the policy; product expenses go to that product's groups
 * (split by the same weight, or evenly by delivered orders when the policy is NONE).
 * Whatever cannot be allocated is returned as `unallocated`.
 */
export function allocateOverhead(groups: readonly AllocationGroup[], expenses: readonly ExpenseFact[], policy: OverheadPolicy) {
  const allocated = new Map<string, number>(groups.map((g) => [g.key, 0]));
  let unallocated = 0;
  const weightOf = (g: AllocationGroup, p: OverheadPolicy) => (p === "BY_REVENUE" ? g.deliveredRevenue : g.deliveredOrders);
  const add = (subset: readonly AllocationGroup[], amount: number, p: OverheadPolicy) => {
    const parts = splitByWeight(amount, subset.map((g) => weightOf(g, p)));
    if (!parts) {
      unallocated += amount;
      return;
    }
    subset.forEach((g, i) => allocated.set(g.key, (allocated.get(g.key) ?? 0) + parts[i]));
  };
  const globalTotal = expenses.filter((e) => e.allocation === "GLOBAL").reduce((a, e) => a + e.amount, 0);
  if (globalTotal) {
    if (policy === "NONE") unallocated += globalTotal;
    else add(groups, globalTotal, policy);
  }
  const byProduct = new Map<string, number>();
  for (const e of expenses) {
    if (e.allocation !== "PRODUCT") continue;
    if (!e.productId) unallocated += e.amount;
    else byProduct.set(e.productId, (byProduct.get(e.productId) ?? 0) + e.amount);
  }
  for (const [productId, amount] of byProduct) {
    const subset = groups.filter((g) => g.productId === productId);
    if (subset.length === 0) unallocated += amount;
    else add(subset, amount, policy === "NONE" ? "BY_DELIVERED_ORDERS" : policy);
  }
  return { allocated, unallocated };
}

// ───────────── Creative verdict ─────────────

export type Verdict = "KILL" | "BAD_TRAFFIC" | "SCALE" | "WATCH" | "INSUFFICIENT_DATA";

export type VerdictInput = Pick<Metrics, "placed" | "shipped" | "adSpend" | "trueNetProfit" | "truePoas" | "placedCpa" | "deliveryRate" | "returnRate">;
export type VerdictThresholdsInput = {
  minSampleOrders: number;
  targetPoas: number;
  minDeliveryRate: number;
  maxRtoRate: number;
  acceptablePlacedCpa: number;
  minShippedForRates: number;
};

/**
 * Precedence:
 *   1. KILL          true net profit < 0, once there is a sample OR the spend alone could have bought one
 *   2. BAD_TRAFFIC   placed CPA acceptable but delivery rate too low or RTO too high (enough shipped parcels)
 *   3. SCALE         true POAS ≥ target and sample size met
 *   4. INSUFFICIENT_DATA sample below threshold
 *   5. WATCH         otherwise
 */
export function creativeVerdict(m: VerdictInput, t: VerdictThresholdsInput): Verdict {
  const sampleMet = m.placed >= t.minSampleOrders;
  const spentEnoughForSample = m.adSpend >= t.minSampleOrders * t.acceptablePlacedCpa && m.adSpend > 0;
  if (m.trueNetProfit < 0 && (sampleMet || spentEnoughForSample)) return "KILL";
  const cpaOk = m.placedCpa !== null && m.placedCpa <= t.acceptablePlacedCpa;
  const ratesKnown = m.shipped >= t.minShippedForRates;
  const badDelivery = m.deliveryRate !== null && m.deliveryRate < t.minDeliveryRate;
  const badRto = m.returnRate !== null && m.returnRate > t.maxRtoRate;
  if (cpaOk && ratesKnown && (badDelivery || badRto)) return "BAD_TRAFFIC";
  if (sampleMet && m.truePoas !== null && m.truePoas >= t.targetPoas) return "SCALE";
  if (!sampleMet) return "INSUFFICIENT_DATA";
  return "WATCH";
}
