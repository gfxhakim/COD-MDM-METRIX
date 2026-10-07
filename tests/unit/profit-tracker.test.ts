import { describe, expect, it } from "vitest";
import { computeMetrics, ZERO_TOTALS } from "@/domain/economics";
import { actualBreakdown, planOverridesSchema, seedFor, stockPotential, stockProjection, type ProductData, type ProjectionInput } from "@/domain/profitTracker";

const base: ProjectionInput = {
  units: 100,
  salePrice: 290000,
  unitCost: 100000,
  unitsPerOrder: 1,
  confirmationRate: 0.8,
  shippingRate: 1,
  deliveryRate: 0.5,
  returnRate: null,
  lostRate: 0,
  cpa: 50000,
  forwardShippingFee: 40000,
  rtoFee: 20000,
  callCenterFee: 10000,
  callCenterBasis: "CONFIRMED_ORDER",
  packagingFee: 0,
  extraFeePerDelivered: 0,
  otherCosts: 0,
};

describe("profit tracker: before ads", () => {
  it("counts every unit sold at its price", () => {
    const r = stockPotential({ units: 240, salePrice: 290000, unitCost: 120000, unitsPerOrder: 1, feesPerOrder: 50000, includeFees: false });
    expect(r).toMatchObject({ revenue: 240 * 290000, purchaseCost: 240 * 120000, benefit: 240 * 170000, benefitPerUnit: 170000, fees: 0, benefitAfterFees: 240 * 170000 });
    expect(r.margin).toBeCloseTo(170 / 290);
  });

  it("can also take off each order's fees, two units per order", () => {
    const r = stockPotential({ units: 240, salePrice: 290000, unitCost: 120000, unitsPerOrder: 2, feesPerOrder: 50000, includeFees: true });
    expect(r.orders).toBe(120);
    expect(r.fees).toBe(120 * 50000);
    expect(r.benefitAfterFees).toBe(240 * 170000 - 120 * 50000);
  });
});

describe("profit tracker: with ads, rates and fees", () => {
  it("works out the orders needed and every cost (hand computed)", () => {
    const r = stockProjection(base);
    if (!r.ok) throw new Error(r.reason);
    // 100 units at a 50% delivery rate: 200 shipped, 200 confirmed (100% shipped), 250 placed (80% confirmed).
    expect(r.flow).toMatchObject({ leads: 250, confirmed: 200, shipped: 200, delivered: 100, returned: 100, lost: 0 });
    expect(r.returnRateUsed).toBe(0.5);
    expect(r.adSpend).toBe(250 * 50000);
    expect(r.potential).toBe(100 * 190000);
    const gap = Object.fromEntries(r.gap.map((g) => [g.key, g.amount]));
    expect(gap).toEqual({ adSpend: 12_500_000, deliveryFees: 4_000_000, returnShipping: 4_000_000, returnFees: 2_000_000, callCenter: 2_000_000 });
    expect(r.missing).toBe(24_500_000);
    expect(r.benefit).toBe(19_000_000 - 24_500_000);
    // The same benefit, counted from the money side.
    expect(r.revenue - r.purchaseCost - 12_500_000 - 4_000_000 - 4_000_000 - 2_000_000 - 2_000_000).toBe(r.benefit);
    expect(r.benefitBeforeAds).toBe(7_000_000);
    expect(r.breakevenCpa).toBe(28000);
    expect(r.breakevenCpaDelivered).toBe(70000);
    expect(r.gap[0].key).toBe("adSpend");
  });

  it("charges lost parcels' goods and stops counting stock once it is delivered or lost", () => {
    const r = stockProjection({ ...base, units: 70, deliveryRate: 0.6, lostRate: 0.1, packagingFee: 3000, extraFeePerDelivered: 7000, otherCosts: 123456, callCenterBasis: "PLACED_LEAD" });
    if (!r.ok) throw new Error(r.reason);
    expect(r.flow.shipped).toBeCloseTo(100);
    expect(r.flow.delivered).toBeCloseTo(60);
    expect(r.flow.lost).toBeCloseTo(10);
    expect(r.flow.returned).toBeCloseTo(30);
    expect(r.flow.leads).toBeCloseTo(125);
    const gap = Object.fromEntries(r.gap.map((g) => [g.key, g.amount]));
    expect(gap.lostParcels).toBe(10 * 290000);
    expect(gap.packaging).toBe(100 * 3000);
    expect(gap.extraFees).toBe(60 * 7000);
    expect(gap.otherCosts).toBe(123456);
    expect(gap.callCenter).toBe(125 * 10000);
    expect(r.gap.reduce((a, g) => a + g.amount, 0)).toBe(r.missing);
    expect(r.potential - r.missing).toBe(r.benefit);
    expect(r.revenue).toBe(60 * 290000);
  });

  it("says why it can't count", () => {
    expect(stockProjection({ ...base, units: 0 })).toMatchObject({ ok: false });
    expect(stockProjection({ ...base, deliveryRate: 0 })).toMatchObject({ ok: false, reason: expect.stringContaining("never sells") });
    expect(stockProjection({ ...base, confirmationRate: 0 })).toMatchObject({ ok: false });
    expect(stockProjection({ ...base, returnRate: 0.6 })).toMatchObject({ ok: false, reason: expect.stringContaining("100%") });
  });
});

describe("profit tracker: real orders", () => {
  it("goes from the benefit at the sale price to the true net profit", () => {
    const totals = { ...ZERO_TOTALS, deliveredUnits: 3, deliveredRevenue: 3 * 300000, cogs: 3 * 100000, outboundShipping: 200000, rtoCost: 30000, callCenterCost: 40000, packagingCost: 5000 };
    const m = computeMetrics(totals, 250000, 60000, "DELIVERED");
    const a = actualBreakdown({ ...totals, adSpend: 250000, overhead: 60000 }, 290000);
    expect(a.expected).toBe(3 * 290000 - 300000);
    expect(a.parts[0]).toEqual({ key: "priceGap", amount: 30000 });
    expect(a.profit).toBe(m.trueNetProfit);
    expect(a.missing).toBe(a.expected - a.profit);
  });
});

describe("profit tracker: starting values", () => {
  const product: ProductData = {
    cost: { salePrice: 290000, sourcingCost: 110000, forwardShippingFee: 45000, rtoFee: 20000, callCenterFee: 9000, packagingFee: 2000 },
    stock: { read: true, available: 80, incoming: 20, received: 300, sellingPrice: 300000, purchasePrice: 100000 },
    observed: { enough: true, confirmationRate: 0.7, shippingRate: 0.9, deliveryRate: 0.65, lostRate: 0.01, unitsPerOrder: 1.2, cpa: 61000, avgShippingFee: 48000, avgReturnFee: 21000 },
    plan: null,
  };
  const defaults = { forwardShippingFee: 60000, rtoFee: 25000, callCenterFee: 12000, packagingFee: 0, callCenterBasis: "CONFIRMED_ORDER" as const };

  it("reads real orders first when there are enough, then product details", () => {
    const s = seedFor(product, defaults);
    expect(s.stockSource).toBe("MDM_AVAILABLE");
    expect(s.units).toBe(80);
    expect(s.inputs).toMatchObject({ salePrice: 290000, unitCost: 110000, deliveryRate: 0.65, cpa: 61000, forwardShippingFee: 48000, rtoFee: 21000, callCenterFee: 9000, returnRate: null });
    expect(s.sources).toMatchObject({ salePrice: "product", deliveryRate: "orders", forwardShippingFee: "orders", callCenterFee: "product" });
  });

  it("falls back to product details, MDM prices and defaults", () => {
    const s = seedFor({ ...product, cost: null, observed: { ...product.observed, enough: false }, stock: { ...product.stock, read: false } }, defaults);
    expect(s.stockSource).toBe("TYPED");
    expect(s.units).toBe(100);
    expect(s.inputs).toMatchObject({ salePrice: 300000, unitCost: 100000, deliveryRate: 0.6, forwardShippingFee: 60000, cpa: 61000 });
    expect(s.sources).toMatchObject({ salePrice: "mdm", deliveryRate: "default", forwardShippingFee: "default" });
  });

  it("uses what was saved for the product over the data", () => {
    const s = seedFor({ ...product, plan: { stockSource: "MDM_WITH_INCOMING", stockUnits: null, overrides: { deliveryRate: 0.5, returnRate: 0.45, salePrice: 310000 } } }, defaults);
    expect(s.units).toBe(100);
    expect(s.inputs).toMatchObject({ deliveryRate: 0.5, returnRate: 0.45, salePrice: 310000, cpa: 61000 });
    expect(s.sources).toMatchObject({ deliveryRate: "you", returnRate: "you", salePrice: "you" });
  });

  it("keeps rates read from orders between 0 and 100%", () => {
    const s = seedFor({ ...product, observed: { ...product.observed, shippingRate: 1.25 } }, defaults);
    expect(s.inputs.shippingRate).toBe(1);
  });

  it("refuses unknown values in a saved plan", () => {
    expect(planOverridesSchema.safeParse({ deliveryRate: 1.5 }).success).toBe(false);
    expect(planOverridesSchema.safeParse({ mdmApiKey: "x" }).success).toBe(false);
  });
});
