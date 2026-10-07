/**
 * Profit tracker: what one product's stock should earn. Pure functions only: no database, no React.
 *
 * Two calculations for the same stock, money in integer minor units:
 *
 * 1. Before ads and rates: every unit sells at the sale price.
 *      benefit = units × (P − C)
 *
 * 2. With ad spend, rates and every fee. Stock leaves for good when a parcel is delivered or lost;
 *    a returned parcel comes back to stock and is sent again. So selling `units` units takes
 *      shipped   = units ÷ (u × (D + L))       u = units per order
 *      confirmed = shipped ÷ shipping rate
 *      leads     = confirmed ÷ confirmation rate       (orders placed)
 *    and
 *      benefit = delivered units × P − units × C − leads × CPA − shipped × (S + G) − returned × R
 *                − call center − delivered × X − other costs
 *
 * The difference between the two, by cause, is the "missing benefit": its parts add up exactly.
 */
import { z } from "zod";

const money = z.number().int().min(0).max(1_000_000_000_00);
const prob = z.number().min(0).max(1);

export type CallCenterBasis = "PLACED_LEAD" | "CONFIRMED_ORDER";

/** Where the stock count comes from. */
export const STOCK_SOURCES = ["MDM_AVAILABLE", "MDM_WITH_INCOMING", "MDM_RECEIVED", "TYPED"] as const;
export type StockSource = (typeof STOCK_SOURCES)[number];
export const STOCK_SOURCE_LABEL: Record<StockSource, string> = {
  MDM_AVAILABLE: "Available at MDM",
  MDM_WITH_INCOMING: "Available + on the way",
  MDM_RECEIVED: "Everything MDM received",
  TYPED: "A number I type",
};

/** Values someone typed over the ones read from the data, saved per product. Missing = read from the data. */
export const planOverridesSchema = z
  .object({
    salePrice: money,
    unitCost: money,
    unitsPerOrder: z.number().min(1).max(100),
    confirmationRate: prob,
    shippingRate: prob,
    deliveryRate: prob,
    returnRate: prob,
    lostRate: prob,
    cpa: money,
    forwardShippingFee: money,
    rtoFee: money,
    callCenterFee: money,
    packagingFee: money,
    extraFeePerDelivered: money,
    otherCosts: money,
    callCenterBasis: z.enum(["PLACED_LEAD", "CONFIRMED_ORDER"]),
    /** Calculation 1 also takes off each order's delivery, packaging and call center fees. */
    includeFees: z.boolean(),
  })
  .partial()
  .strict();
export type PlanOverrides = z.infer<typeof planOverridesSchema>;

export const profitPlanSchema = z.object({
  stockSource: z.enum(STOCK_SOURCES),
  stockUnits: z.number().int().min(0).max(10_000_000).nullable(),
  overrides: planOverridesSchema,
});
export type ProfitPlan = z.infer<typeof profitPlanSchema>;

// ───────────── Calculation 1: before ads and rates ─────────────

export type PotentialInput = {
  units: number;
  salePrice: number;
  unitCost: number;
  unitsPerOrder: number;
  /** Per order, when `includeFees`: delivery, packaging, call center and other fees, as if every order were delivered. */
  feesPerOrder: number;
  includeFees: boolean;
};

export type PotentialResult = {
  units: number;
  revenue: number;
  purchaseCost: number;
  /** units × (P − C). */
  benefit: number;
  benefitPerUnit: number;
  /** (P − C) ÷ P, null without a price. */
  margin: number | null;
  orders: number;
  fees: number;
  /** benefit − fees: every order delivered, no ads. Equal to `benefit` when fees are left out. */
  benefitAfterFees: number;
};

export function stockPotential(i: PotentialInput): PotentialResult {
  const units = Math.max(0, Math.round(i.units));
  const revenue = units * i.salePrice;
  const purchaseCost = units * i.unitCost;
  const benefit = revenue - purchaseCost;
  const orders = units / Math.max(1, i.unitsPerOrder);
  const fees = i.includeFees ? Math.round(orders * i.feesPerOrder) : 0;
  return {
    units,
    revenue,
    purchaseCost,
    benefit,
    benefitPerUnit: i.salePrice - i.unitCost,
    margin: i.salePrice > 0 ? (i.salePrice - i.unitCost) / i.salePrice : null,
    orders,
    fees,
    benefitAfterFees: benefit - fees,
  };
}

// ───────────── Calculation 2: with ad spend, rates and fees ─────────────

export type ProjectionInput = {
  units: number;
  salePrice: number;
  unitCost: number;
  unitsPerOrder: number;
  confirmationRate: number;
  /** Confirmed orders that are shipped (the rest are cancelled after confirmation). */
  shippingRate: number;
  deliveryRate: number;
  /** Null: every shipped parcel that is not delivered or lost comes back (1 − D − L). */
  returnRate: number | null;
  lostRate: number;
  /** Ad spend per order placed. */
  cpa: number;
  forwardShippingFee: number;
  rtoFee: number;
  callCenterFee: number;
  callCenterBasis: CallCenterBasis;
  packagingFee: number;
  /** Any other fee MDM charges per delivered order (COD fee, fulfilment…). */
  extraFeePerDelivered: number;
  /** A fixed amount for this stock (expenses, transport to MDM…). */
  otherCosts: number;
};

export const GAP_KEYS = ["adSpend", "deliveryFees", "returnShipping", "returnFees", "lostParcels", "callCenter", "packaging", "extraFees", "otherCosts"] as const;
export type GapKey = (typeof GAP_KEYS)[number];
export const GAP_LABEL: Record<GapKey, string> = {
  adSpend: "Ad spend",
  deliveryFees: "Delivery fees on delivered parcels",
  returnShipping: "Shipping paid on returned and lost parcels",
  returnFees: "Return fees",
  lostParcels: "Goods in lost parcels",
  callCenter: "Call center",
  packaging: "Packaging",
  extraFees: "Other MDM fees",
  otherCosts: "Other costs",
};

export type Flow = { leads: number; confirmed: number; shipped: number; delivered: number; returned: number; lost: number; deliveredUnits: number; lostUnits: number };

export type ProjectionResult =
  | { ok: false; reason: string }
  | {
      ok: true;
      flow: Flow;
      returnRateUsed: number;
      revenue: number;
      purchaseCost: number;
      adSpend: number;
      /** Calculation 1's benefit for the same stock: units × (P − C). */
      potential: number;
      /** What takes the benefit from `potential` down to `benefit`, biggest first. Adds up to `missing`. */
      gap: { key: GapKey; amount: number }[];
      missing: number;
      benefit: number;
      benefitBeforeAds: number;
      benefitPerUnit: number;
      /** Benefit ÷ ad spend. */
      poas: number | null;
      /** Benefit ÷ what the stock cost. */
      returnOnStock: number | null;
      /** The most an order placed can cost in ads before the stock loses money. */
      breakevenCpa: number;
      /** The same per delivered order. */
      breakevenCpaDelivered: number;
    };

export function validateProjection(i: ProjectionInput): string | null {
  if (!(i.units > 0)) return "Enter how many units of stock to count.";
  if (!(i.confirmationRate > 0)) return "With a 0% confirmation rate no order is ever sent.";
  if (!(i.shippingRate > 0)) return "With a 0% shipping rate no order is ever sent.";
  if (!(i.deliveryRate + i.lostRate > 0)) return "With a 0% delivery rate the stock never sells.";
  const q = i.returnRate ?? 0;
  if (i.deliveryRate + q + i.lostRate > 1.000001) return "Delivered + returned + lost can't be more than 100%.";
  return null;
}

export function stockProjection(i: ProjectionInput): ProjectionResult {
  const reason = validateProjection(i);
  if (reason) return { ok: false, reason };
  const u = Math.max(1, i.unitsPerOrder);
  const d = i.deliveryRate;
  const L = i.lostRate;
  const q = i.returnRate ?? Math.max(0, 1 - d - L);

  const shipped = i.units / (u * (d + L));
  const confirmed = shipped / i.shippingRate;
  const leads = confirmed / i.confirmationRate;
  const delivered = shipped * d;
  const returned = shipped * q;
  const lost = shipped * L;
  const flow: Flow = { leads, confirmed, shipped, delivered, returned, lost, deliveredUnits: delivered * u, lostUnits: lost * u };

  const parts: Record<GapKey, number> = {
    adSpend: Math.round(leads * i.cpa),
    deliveryFees: Math.round(delivered * i.forwardShippingFee),
    returnShipping: Math.round((returned + lost) * i.forwardShippingFee),
    returnFees: Math.round(returned * i.rtoFee),
    lostParcels: Math.round(flow.lostUnits * i.salePrice),
    callCenter: Math.round((i.callCenterBasis === "PLACED_LEAD" ? leads : confirmed) * i.callCenterFee),
    packaging: Math.round(shipped * i.packagingFee),
    extraFees: Math.round(delivered * i.extraFeePerDelivered),
    otherCosts: Math.round(i.otherCosts),
  };
  const potential = Math.round(i.units) * (i.salePrice - i.unitCost);
  const missing = GAP_KEYS.reduce((a, k) => a + parts[k], 0);
  const benefit = potential - missing;
  const benefitBeforeAds = benefit + parts.adSpend;
  const purchaseCost = Math.round(i.units) * i.unitCost;
  return {
    ok: true,
    flow,
    returnRateUsed: q,
    revenue: Math.round(i.units) * i.salePrice - parts.lostParcels,
    purchaseCost,
    adSpend: parts.adSpend,
    potential,
    gap: GAP_KEYS.map((key) => ({ key, amount: parts[key] })).filter((g) => g.amount !== 0).sort((a, b) => b.amount - a.amount),
    missing,
    benefit,
    benefitBeforeAds,
    benefitPerUnit: Math.round(benefit / i.units),
    poas: parts.adSpend > 0 ? benefit / parts.adSpend : null,
    returnOnStock: purchaseCost > 0 ? benefit / purchaseCost : null,
    breakevenCpa: Math.round(benefitBeforeAds / leads),
    breakevenCpaDelivered: Math.round(benefitBeforeAds / delivered),
  };
}

// ───────────── Real orders so far ─────────────

export type ActualInput = {
  deliveredUnits: number;
  deliveredRevenue: number;
  cogs: number;
  adSpend: number;
  outboundShipping: number;
  rtoCost: number;
  callCenterCost: number;
  packagingCost: number;
  overhead: number;
};

export const ACTUAL_KEYS = ["priceGap", "adSpend", "deliveryFees", "returnFees", "callCenter", "packaging", "expenses"] as const;
export type ActualKey = (typeof ACTUAL_KEYS)[number];
export const ACTUAL_LABEL: Record<ActualKey, string> = {
  priceGap: "Collected vs your sale price",
  adSpend: "Ad spend",
  deliveryFees: "Delivery fees",
  returnFees: "Return fees",
  callCenter: "Call center",
  packaging: "Packaging",
  expenses: "Expenses for this product",
};

/**
 * The real orders of a period, from the benefit the delivered units should have made at today's
 * sale price down to the true net profit. `priceGap` is signed: positive when parcels collected more
 * than the sale price (delivery paid by the customer, upsells), negative when less (discounts).
 * Every other part is a cost.
 */
export function actualBreakdown(a: ActualInput, salePrice: number | null) {
  const atPrice = salePrice === null ? a.deliveredRevenue : a.deliveredUnits * salePrice;
  const expected = atPrice - a.cogs;
  const parts: Record<ActualKey, number> = {
    priceGap: a.deliveredRevenue - atPrice,
    adSpend: a.adSpend,
    deliveryFees: a.outboundShipping,
    returnFees: a.rtoCost,
    callCenter: a.callCenterCost,
    packaging: a.packagingCost,
    expenses: a.overhead,
  };
  const profit = expected + parts.priceGap - parts.adSpend - parts.deliveryFees - parts.returnFees - parts.callCenter - parts.packaging - parts.expenses;
  return {
    expected,
    parts: ACTUAL_KEYS.map((key) => ({ key, amount: key === "priceGap" ? parts[key] : -parts[key] })).filter((p) => p.amount !== 0),
    profit,
    missing: expected - profit,
  };
}

// ───────────── Starting values for one product ─────────────

/** A rate to the nearest 0.1%. */
export const roundRate = (v: number) => Math.round(v * 1000) / 1000;

export type FieldSource = "you" | "orders" | "product" | "mdm" | "default";

export type ProductData = {
  cost: { salePrice: number; sourcingCost: number; forwardShippingFee: number; rtoFee: number; callCenterFee: number; packagingFee: number } | null;
  stock: { read: boolean; available: number; incoming: number; received: number; sellingPrice: number | null; purchasePrice: number | null };
  observed: {
    enough: boolean;
    confirmationRate: number | null;
    shippingRate: number | null;
    deliveryRate: number | null;
    lostRate: number | null;
    unitsPerOrder: number | null;
    cpa: number | null;
    avgShippingFee: number | null;
    avgReturnFee: number | null;
  };
  plan: ProfitPlan | null;
};

export type Defaults = { forwardShippingFee: number; rtoFee: number; callCenterFee: number; packagingFee: number; callCenterBasis: CallCenterBasis };

/** When there are no orders to read rates from. */
export const FALLBACK_RATES = { confirmationRate: 0.75, shippingRate: 0.95, deliveryRate: 0.6, lostRate: 0 } as const;
/** Units counted when MDM has no stock for the product and nobody typed a number. */
export const EXAMPLE_UNITS = 100;

export type Seed = {
  stockSource: StockSource;
  units: number;
  includeFees: boolean;
  inputs: Omit<ProjectionInput, "units">;
  sources: Partial<Record<keyof ProjectionInput, FieldSource>>;
};

export function stockUnitsFor(source: StockSource, stock: ProductData["stock"], typed: number | null): number {
  switch (source) {
    case "MDM_AVAILABLE": return stock.available;
    case "MDM_WITH_INCOMING": return stock.available + stock.incoming;
    case "MDM_RECEIVED": return stock.received;
    case "TYPED": return typed ?? EXAMPLE_UNITS;
  }
}

/**
 * The numbers both calculations start from for one product: what someone saved for it, else the
 * product's real orders (when there are enough), its product details, MDM's stock prices, and the
 * workspace defaults, in that order.
 */
export function seedFor(p: ProductData, d: Defaults): Seed {
  const o = p.plan?.overrides ?? {};
  const sources: Seed["sources"] = {};
  const pick = <K extends keyof ProjectionInput>(key: K, options: [FieldSource, ProjectionInput[K] | null | undefined][]): ProjectionInput[K] => {
    for (const [source, value] of options) {
      if (value !== null && value !== undefined) {
        sources[key] = source;
        return value;
      }
    }
    throw new Error(`No value for ${String(key)}`);
  };
  // Rates are shown and typed to 0.1%, so the ones read from orders are rounded the same way: the
  // products table and the calculator then give the same numbers. Orders shipped without a
  // confirmation (or split into several parcels) can put the shipping rate over 100%: it stops there.
  const r = (v: number | null) => (v === null ? null : roundRate(Math.min(1, Math.max(0, v))));
  const seen = p.observed.enough
    ? { ...p.observed, confirmationRate: r(p.observed.confirmationRate), shippingRate: r(p.observed.shippingRate), deliveryRate: r(p.observed.deliveryRate), lostRate: r(p.observed.lostRate) }
    : null;
  if (o.returnRate !== undefined) sources.returnRate = "you";
  const stockSource = p.plan?.stockSource ?? (p.stock.read ? "MDM_AVAILABLE" : "TYPED");
  return {
    stockSource,
    units: stockUnitsFor(stockSource, p.stock, p.plan?.stockUnits ?? null),
    includeFees: o.includeFees ?? false,
    sources,
    inputs: {
      salePrice: pick("salePrice", [["you", o.salePrice], ["product", p.cost?.salePrice], ["mdm", p.stock.sellingPrice], ["default", 0]]),
      unitCost: pick("unitCost", [["you", o.unitCost], ["product", p.cost?.sourcingCost], ["mdm", p.stock.purchasePrice], ["default", 0]]),
      unitsPerOrder: pick("unitsPerOrder", [["you", o.unitsPerOrder], ["orders", p.observed.unitsPerOrder], ["default", 1]]),
      confirmationRate: pick("confirmationRate", [["you", o.confirmationRate], ["orders", seen?.confirmationRate], ["default", FALLBACK_RATES.confirmationRate]]),
      shippingRate: pick("shippingRate", [["you", o.shippingRate], ["orders", seen?.shippingRate], ["default", FALLBACK_RATES.shippingRate]]),
      deliveryRate: pick("deliveryRate", [["you", o.deliveryRate], ["orders", seen?.deliveryRate], ["default", FALLBACK_RATES.deliveryRate]]),
      returnRate: o.returnRate ?? null,
      lostRate: pick("lostRate", [["you", o.lostRate], ["orders", seen?.lostRate], ["default", FALLBACK_RATES.lostRate]]),
      cpa: pick("cpa", [["you", o.cpa], ["orders", p.observed.cpa], ["default", 0]]),
      forwardShippingFee: pick("forwardShippingFee", [["you", o.forwardShippingFee], ["orders", seen?.avgShippingFee], ["product", p.cost?.forwardShippingFee], ["default", d.forwardShippingFee]]),
      rtoFee: pick("rtoFee", [["you", o.rtoFee], ["orders", seen?.avgReturnFee], ["product", p.cost?.rtoFee], ["default", d.rtoFee]]),
      callCenterFee: pick("callCenterFee", [["you", o.callCenterFee], ["product", p.cost?.callCenterFee], ["default", d.callCenterFee]]),
      callCenterBasis: pick("callCenterBasis", [["you", o.callCenterBasis], ["default", d.callCenterBasis]]),
      packagingFee: pick("packagingFee", [["you", o.packagingFee], ["product", p.cost?.packagingFee], ["default", d.packagingFee]]),
      extraFeePerDelivered: pick("extraFeePerDelivered", [["you", o.extraFeePerDelivered], ["default", 0]]),
      otherCosts: pick("otherCosts", [["you", o.otherCosts], ["default", 0]]),
    },
  };
}

/** Delivery, packaging, call center and other fees for one order delivered at the first try. */
export const feesPerOrder = (i: Pick<ProjectionInput, "forwardShippingFee" | "packagingFee" | "callCenterFee" | "extraFeePerDelivered">) =>
  i.forwardShippingFee + i.packagingFee + i.callCenterFee + i.extraFeePerDelivered;

/** Both calculations for one product with its starting values: what the products table shows. */
export function productSummary(p: ProductData, d: Defaults) {
  const seed = seedFor(p, d);
  const potential = stockPotential({ units: seed.units, salePrice: seed.inputs.salePrice, unitCost: seed.inputs.unitCost, unitsPerOrder: seed.inputs.unitsPerOrder, feesPerOrder: feesPerOrder(seed.inputs), includeFees: seed.includeFees });
  const projection = stockProjection({ ...seed.inputs, units: seed.units });
  return { seed, potential, projection };
}
