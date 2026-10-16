import { describe, expect, it } from "vitest";
import { ALL_PRODUCTS, EACH_PRODUCT, NO_PRODUCT, inProductPick, productSections, sectionMetrics } from "@/domain/creativeProducts";
import { computeMetrics, ZERO_TOTALS, type Metrics } from "@/domain/economics";

const metrics = (placed: number, delivered: number, returned: number, revenue: number, spend: number): Metrics =>
  computeMetrics({ ...ZERO_TOTALS, placed, confirmed: placed, shipped: delivered + returned, delivered, deliveredOrders: delivered, returned, deliveredRevenue: revenue }, spend, 0, "DELIVERED");

type R = { key: string; kind: "CREATIVE" | "UNATTRIBUTED" | "UNMATCHED_SPEND"; product: { id: string; source: "LINK" | "ORDERS" } | null; metrics: Metrics };
const ad = (key: string, product: string | null, m: Metrics, source: "LINK" | "ORDERS" = "LINK"): R => ({ key, kind: "CREATIVE", product: product ? { id: product, source } : null, metrics: m });

const rows: R[] = [
  ad("a1", "lamp", metrics(4, 2, 1, 780000, 100000)),
  ad("a2", "chair", metrics(2, 1, 0, 390000, 300000), "ORDERS"),
  ad("a3", null, metrics(0, 0, 0, 0, 50000)),
  ad("a4", "lamp", metrics(2, 1, 1, 390000, 100000)),
  { key: "u", kind: "UNATTRIBUTED", product: null, metrics: metrics(1, 0, 0, 0, 0) },
];
const products = [{ id: "lamp", name: "Lamp" }, { id: "chair", name: "Chair" }];

describe("creatives by product", () => {
  it("shows orders and spend without an ad only with every product", () => {
    expect(rows.filter((r) => inProductPick(r, ALL_PRODUCTS))).toHaveLength(5);
    expect(rows.filter((r) => inProductPick(r, EACH_PRODUCT))).toHaveLength(5);
    expect(rows.filter((r) => inProductPick(r, "lamp")).map((r) => r.key)).toEqual(["a1", "a4"]);
    expect(rows.filter((r) => inProductPick(r, NO_PRODUCT)).map((r) => r.key)).toEqual(["a3"]);
  });

  it("makes one section per product, biggest spend first, the ads with no product last", () => {
    const s = productSections(rows, products, "DELIVERED");
    expect(s.map((x) => [x.id, x.name, x.rows.map((r) => r.key)])).toEqual([
      ["chair", "Chair", ["a2"]],
      ["lamp", "Lamp", ["a1", "a4"]],
      [NO_PRODUCT, null, ["a3"]],
    ]);
    expect(s.map((x) => x.fromOrders)).toEqual([1, 0, 0]);
  });

  it("adds a section's ads up and works its rates out again", () => {
    const lamp = sectionMetrics([rows[0], rows[3]], "DELIVERED");
    expect(lamp).toMatchObject({ placed: 6, delivered: 3, returned: 2, adSpend: 200000, deliveredRevenue: 1170000 });
    // Rates come from the sums, not an average of the ads' rates.
    expect(lamp.deliveryRate).toBeCloseTo(3 / 5);
    expect(lamp.placedCpa).toBe(Math.round(200000 / 6));
    expect(lamp.trueNetProfit).toBe(rows[0].metrics.trueNetProfit + rows[3].metrics.trueNetProfit);
  });
});
