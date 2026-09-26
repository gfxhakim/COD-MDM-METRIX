import { describe, expect, it } from "vitest";
import { simulate } from "@/domain/simulator";

const base = { salePrice: 390000, sourcingCost: 90000, outboundShipping: 60000, rtoFee: 25000, callCenterCost: 12000, deliveryProbability: 0.6, returnProbability: 0.4 };

describe("breakeven CPA", () => {
  it("implements (P − C − S) × D − R × Q − K", () => {
    const r = simulate({ ...base, returnIsComplement: false });
    // (390000 − 90000 − 60000) × 0.6 − 25000 × 0.4 − 12000 = 144000 − 10000 − 12000
    expect(r.breakevenCpa).toBe(122000);
    expect(r.expectedContribution).toBe(122000);
  });

  it("labels the Q = 1 − D assumption", () => {
    const r = simulate({ ...base, deliveryProbability: 0.7, returnIsComplement: true });
    expect(r.returnProbabilityUsed).toBeCloseTo(0.3);
    expect(r.breakevenCpa).toBe(Math.round(240000 * 0.7 - 25000 * 0.3 - 12000));
    expect(r.assumptions.join(" ")).toContain("Q = 1 − D");
  });

  it("computes target CPA and expected profit at the current CPA", () => {
    const r = simulate({ ...base, returnIsComplement: false, targetProfitPerOrder: 20000, currentCpa: 100000 });
    expect(r.targetCpa).toBe(102000);
    expect(r.expectedProfitAtCurrentCpa).toBe(22000);
  });

  it("can be negative when the product loses money before ads", () => {
    expect(simulate({ ...base, salePrice: 150000, returnIsComplement: true }).breakevenCpa).toBeLessThan(0);
  });

  it("builds a monotonic delivery-rate × CPA sensitivity grid", () => {
    const r = simulate({ ...base, returnIsComplement: true });
    const { deliveryRates, cpas, profit } = r.sensitivity;
    expect(profit).toHaveLength(deliveryRates.length);
    expect(profit[0]).toHaveLength(cpas.length);
    for (let i = 1; i < deliveryRates.length; i++) expect(profit[i][0]).toBeGreaterThan(profit[i - 1][0]);
    for (let j = 1; j < cpas.length; j++) expect(profit[0][j]).toBeLessThan(profit[0][j - 1]);
    expect(deliveryRates).toContain(0.6);
  });

  it("detailed model separates confirmation, shipping, lost and RTO", () => {
    const r = simulate({ ...base, model: "DETAILED", packagingCost: 5000, returnIsComplement: false, returnProbability: 0.3, lostProbability: 0.05, confirmationRate: 0.8, shippingRate: 0.9, callCenterBasis: "PLACED_LEAD" });
    const perShipped = 0.6 * (390000 - 90000) - (0.6 + 0.3 + 0.05) * 65000 - 0.3 * 25000 - 0.05 * 90000;
    expect(r.unit).toBe("placed lead");
    expect(r.breakevenCpa).toBe(Math.round(0.72 * perShipped - 12000));
  });

  it("rejects impossible probabilities", () => {
    expect(() => simulate({ ...base, deliveryProbability: 0.8, returnProbability: 0.4, returnIsComplement: false })).toThrow();
    expect(() => simulate({ ...base, deliveryProbability: 1.2 })).toThrow();
  });
});
