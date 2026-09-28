import { describe, expect, it } from "vitest";
import {
  allocateOverhead,
  computeMetrics,
  creativeVerdict,
  isShipped,
  orderEconomics,
  perUnit,
  safeRate,
  splitByWeight,
  sumTotals,
  ZERO_TOTALS,
  type CostTerms,
  type OrderFact,
  type ParcelFact,
} from "@/domain/economics";
import { economicsDefaultsSchema } from "@/domain/settings";

const terms: CostTerms = { salePrice: 390000, sourcingCost: 90000, forwardShippingFee: 60000, rtoFee: 25000, callCenterFee: 12000, packagingFee: 5000 };
const defaults = economicsDefaultsSchema.parse({ callCenterBasis: "CONFIRMED_ORDER" });
const resolve = () => terms;
const parcel = (status: ParcelFact["status"], extra: Partial<ParcelFact> = {}): ParcelFact => ({ status, codAmount: 390000, shippingFee: null, returnFee: null, dispatched: status !== "PENDING" && status !== "CANCELED", ...extra });
const order = (parcels: ParcelFact[], extra: Partial<OrderFact> = {}): OrderFact => ({
  id: "o", placedAt: new Date("2026-09-01"), confirmed: true, callAttempts: null, productId: "p", creativeId: "c", wilaya: "Oran",
  lines: [{ productId: "p", quantity: 1 }], parcels, remittedCash: 0, ...extra,
});

describe("zero-denominator safety", () => {
  it("returns null instead of NaN/Infinity", () => {
    expect(safeRate(0, 0)).toBeNull();
    expect(safeRate(5, 0)).toBeNull();
    expect(safeRate(1, 4)).toBe(0.25);
    expect(perUnit(1000, 0)).toBeNull();
    expect(perUnit(1000, 3)).toBe(333);
    const m = computeMetrics({ ...ZERO_TOTALS }, 0, 0, "DELIVERED");
    for (const k of ["confirmationRate", "shippingRate", "deliveryRate", "returnRate", "truePoas", "placedCpa", "cpco", "cpdo"] as const) expect(m[k]).toBeNull();
    expect(m.trueNetProfit).toBe(0);
  });
});

describe("parcel classification", () => {
  it("counts unknown statuses as shipped only after dispatch and never as delivered/returned", () => {
    expect(isShipped({ status: "UNKNOWN", dispatched: false })).toBe(false);
    expect(isShipped({ status: "UNKNOWN", dispatched: true })).toBe(true);
    const t = orderEconomics(order([parcel("UNKNOWN", { dispatched: true })]), resolve, defaults);
    expect(t).toMatchObject({ shipped: 1, delivered: 0, returned: 0, inTransit: 1, unknownStatus: 1, cashInTransit: 390000, deliveredRevenue: 0 });
  });

  it("counts nothing for a parcel still with the carrier until it is delivered or returned", () => {
    const t = orderEconomics(order([parcel("SHIPPED")]), resolve, defaults);
    expect(t).toMatchObject({ confirmed: 1, shipped: 1, inTransit: 1, cashInTransit: 390000, outboundShipping: 0, packagingCost: 0, rtoCost: 0, deliveredRevenue: 0, cogs: 0 });
    expect(computeMetrics(t, 0, 0, "DELIVERED")).toMatchObject({ finished: 0, deliveryRate: null, returnRate: null });
  });
});

describe("per-order economics", () => {
  it("delivered order: revenue, COGS, shipping, packaging, call center", () => {
    const t = orderEconomics(order([parcel("DELIVERED")]), resolve, defaults);
    expect(t).toMatchObject({ placed: 1, confirmed: 1, shipped: 1, delivered: 1, deliveredRevenue: 390000, cogs: 90000, outboundShipping: 60000, packagingCost: 5000, callCenterCost: 12000, rtoCost: 0, deliveredUnits: 1 });
  });

  it("RTO: fee and loss, no revenue, no COGS (goods return to stock)", () => {
    const t = orderEconomics(order([parcel("RETURNED")]), resolve, defaults);
    expect(t).toMatchObject({ returned: 1, deliveredRevenue: 0, cogs: 0, rtoCost: 25000, outboundShipping: 60000, rtoLoss: 60000 + 25000 + 5000 });
  });

  it("prefers observed carrier fees over cost-version assumptions", () => {
    const t = orderEconomics(order([parcel("RETURNED", { shippingFee: 45000, returnFee: 20000 })]), resolve, defaults);
    expect(t.outboundShipping).toBe(45000);
    expect(t.rtoCost).toBe(20000);
  });

  it("multi-parcel partial delivery: counts parcels separately and prorates delivered units", () => {
    const o = order([parcel("DELIVERED", { codAmount: 195000 }), parcel("RETURNED", { codAmount: 195000 })], { lines: [{ productId: "p", quantity: 2 }] });
    const t = orderEconomics(o, resolve, defaults);
    expect(t).toMatchObject({ placed: 1, shipped: 2, delivered: 1, returned: 1, deliveredUnits: 1, cogs: 90000, deliveredRevenue: 195000, outboundShipping: 120000, packagingCost: 10000, deliveredOrders: 1 });
  });

  it("ignores canceled parcels when prorating", () => {
    const o = order([parcel("CANCELED"), parcel("DELIVERED")], { lines: [{ productId: "p", quantity: 2 }] });
    const t = orderEconomics(o, resolve, defaults);
    expect(t.shipped).toBe(1);
    expect(t.deliveredUnits).toBe(2);
  });

  it("uses the cost version in effect on the order date", () => {
    const resolver = (_: string | null, at: Date) => ({ ...terms, sourcingCost: at < new Date("2026-06-01") ? 80000 : 100000 });
    expect(orderEconomics(order([parcel("DELIVERED")], { placedAt: new Date("2026-05-01") }), resolver, defaults).cogs).toBe(80000);
    expect(orderEconomics(order([parcel("DELIVERED")], { placedAt: new Date("2026-07-01") }), resolver, defaults).cogs).toBe(100000);
  });

  it("falls back to workspace default fees and flags missing cost versions", () => {
    const t = orderEconomics(order([parcel("DELIVERED")]), () => null, defaults);
    expect(t.missingCostOrders).toBe(1);
    expect(t.cogs).toBe(0);
    expect(t.outboundShipping).toBe(defaults.forwardShippingFee);
  });

  it("supports every call-center cost basis", () => {
    const pending = order([], { confirmed: false, callAttempts: 3 });
    expect(orderEconomics(pending, resolve, { ...defaults, callCenterBasis: "PLACED_LEAD" }).callCenterCost).toBe(12000);
    expect(orderEconomics(pending, resolve, { ...defaults, callCenterBasis: "CONFIRMED_ORDER" }).callCenterCost).toBe(0);
    expect(orderEconomics(pending, resolve, { ...defaults, callCenterBasis: "CALL_ATTEMPT" }).callCenterCost).toBe(36000);
  });
});

describe("profit metrics", () => {
  const totals = sumTotals([
    orderEconomics(order([parcel("DELIVERED")], { remittedCash: 390000 }), resolve, defaults),
    orderEconomics(order([parcel("DELIVERED")]), resolve, defaults),
    orderEconomics(order([parcel("RETURNED")]), resolve, defaults),
    orderEconomics(order([parcel("SHIPPED")]), resolve, defaults),
    orderEconomics(order([], { confirmed: false }), resolve, defaults),
  ]);

  it("computes the spec formulas", () => {
    const m = computeMetrics(totals, 200000, 10000, "DELIVERED");
    expect(m).toMatchObject({ placed: 5, confirmed: 4, shipped: 4, finished: 3, delivered: 2, returned: 1, inTransit: 1, cashInTransit: 390000 });
    expect(m.confirmationRate).toBe(0.8);
    expect(m.shippingRate).toBe(1);
    // The parcel still in transit is left out of the rates and of the costs.
    expect(m.deliveryRate).toBeCloseTo(2 / 3);
    expect(m.returnRate).toBeCloseTo(1 / 3);
    // revenue 780000 − ads 200000 − cogs 180000 − ship 180000 − rto 25000 − call 48000 − pack 15000 − overhead 10000
    expect(m.trueNetProfit).toBe(122000);
    expect(m.truePoas).toBeCloseTo(0.61);
    expect(m.placedCpa).toBe(40000);
    expect(m.cpco).toBe(50000);
    expect(m.cpdo).toBe(100000);
  });

  it("switches revenue basis between delivered and remitted", () => {
    const m = computeMetrics(totals, 200000, 10000, "REMITTED");
    expect(m.revenue).toBe(390000);
    expect(m.trueNetProfit).toBe(122000 - 390000);
  });
});

describe("overhead allocation", () => {
  const groups = [
    { key: "a", productId: "p1", deliveredOrders: 3, deliveredRevenue: 300 },
    { key: "b", productId: "p1", deliveredOrders: 1, deliveredRevenue: 700 },
    { key: "c", productId: "p2", deliveredOrders: 0, deliveredRevenue: 0 },
  ];

  it("splits exactly with the largest remainder method", () => {
    expect(splitByWeight(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(splitByWeight(100, [0, 0])).toBeNull();
  });

  it("allocates global expenses by delivered orders or revenue", () => {
    const exp = [{ amount: 1000, allocation: "GLOBAL" as const, productId: null }];
    expect(Object.fromEntries(allocateOverhead(groups, exp, "BY_DELIVERED_ORDERS").allocated)).toEqual({ a: 750, b: 250, c: 0 });
    expect(Object.fromEntries(allocateOverhead(groups, exp, "BY_REVENUE").allocated)).toEqual({ a: 300, b: 700, c: 0 });
    expect(allocateOverhead(groups, exp, "NONE").unallocated).toBe(1000);
  });

  it("keeps product-specific expenses within that product and reports what cannot be allocated", () => {
    const exp = [
      { amount: 400, allocation: "PRODUCT" as const, productId: "p1" },
      { amount: 90, allocation: "PRODUCT" as const, productId: "p2" }, // p2 delivered nothing
      { amount: 10, allocation: "PRODUCT" as const, productId: "p9" }, // no group
    ];
    const r = allocateOverhead(groups, exp, "BY_DELIVERED_ORDERS");
    expect(r.allocated.get("a")).toBe(300);
    expect(r.allocated.get("b")).toBe(100);
    expect(r.allocated.get("c")).toBe(0);
    expect(r.unallocated).toBe(100);
  });
});

describe("creative verdict precedence", () => {
  const t = { minSampleOrders: 20, targetPoas: 0.3, minDeliveryRate: 0.55, maxRtoRate: 0.3, acceptablePlacedCpa: 80000, minShippedForRates: 10 };
  const base = { placed: 40, finished: 30, adSpend: 1_000_000, trueNetProfit: 500_000, truePoas: 0.5, placedCpa: 25000, deliveryRate: 0.7, returnRate: 0.2 };

  it("SCALE when POAS meets target with enough sample", () => expect(creativeVerdict(base, t)).toBe("SCALE"));
  it("KILL beats everything when profit is negative", () => expect(creativeVerdict({ ...base, trueNetProfit: -1, truePoas: -0.01, deliveryRate: 0.3 }, t)).toBe("KILL"));
  it("KILL also applies when spend alone could have bought a sample", () =>
    expect(creativeVerdict({ ...base, placed: 2, finished: 0, adSpend: 20 * 80000, trueNetProfit: -1_000_000, truePoas: -0.6 }, t)).toBe("KILL"));
  it("BAD_TRAFFIC when CPA looks good but delivery is poor", () => expect(creativeVerdict({ ...base, deliveryRate: 0.4 }, t)).toBe("BAD_TRAFFIC"));
  it("BAD_TRAFFIC when RTO is too high", () => expect(creativeVerdict({ ...base, returnRate: 0.45 }, t)).toBe("BAD_TRAFFIC"));
  it("not BAD_TRAFFIC when CPA is not acceptable", () => expect(creativeVerdict({ ...base, placedCpa: 90000, deliveryRate: 0.4 }, t)).toBe("SCALE"));
  it("not BAD_TRAFFIC before enough parcels are delivered or returned", () => expect(creativeVerdict({ ...base, finished: 5, deliveryRate: 0.2 }, t)).toBe("SCALE"));
  it("WATCH when enough data but below target", () => expect(creativeVerdict({ ...base, truePoas: 0.1 }, t)).toBe("WATCH"));
  it("INSUFFICIENT_DATA below the sample threshold", () => expect(creativeVerdict({ ...base, placed: 5, finished: 2, adSpend: 100000 }, t)).toBe("INSUFFICIENT_DATA"));
});
