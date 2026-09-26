/**
 * Breakeven CPA simulator. Pure functions; scenario rates only (observed facts come from reports).
 *
 * Default model (per confirmed/shipped order, from the product spec):
 *   expectedContributionBeforeAdSpend = (P − C − S) × D − R × Q − K
 *   breakevenCPA = expectedContributionBeforeAdSpend
 *
 * Detailed model (per placed lead) separates confirmation, shipping, delivery, RTO and
 * lost probabilities and also charges forward shipping + packaging on returned and lost parcels:
 *   perShipped = D×(P − C) − (D+Q+L)×(S + G) − Q×R − L×C
 *   perLead    = confirm × ship × perShipped − K × (basis is lead ? 1 : confirm)
 */
import { z } from "zod";

const money = z.number().int().min(0).max(1_000_000_000_00);
const prob = z.number().min(0).max(1);

export const simulatorInputSchema = z
  .object({
    currency: z.string().length(3).default("DZD"),
    model: z.enum(["DEFAULT", "DETAILED"]).default("DEFAULT"),
    salePrice: money, // P
    sourcingCost: money, // C
    outboundShipping: money, // S
    rtoFee: money, // R
    callCenterCost: money, // K
    packagingCost: money.default(0), // G (detailed model only)
    deliveryProbability: prob, // D
    /** When true, Q = 1 − D (labelled assumption). */
    returnIsComplement: z.boolean().default(true),
    returnProbability: prob, // Q
    lostProbability: prob.default(0), // L (detailed)
    confirmationRate: prob.default(1), // detailed
    shippingRate: prob.default(1), // detailed
    callCenterBasis: z.enum(["PLACED_LEAD", "CONFIRMED_ORDER"]).default("CONFIRMED_ORDER"),
    targetProfitPerOrder: z.number().int().min(-1_000_000_000).max(1_000_000_000).default(0),
    /** Optional CPA to evaluate (e.g. your current CPA). */
    currentCpa: money.optional(),
  })
  .superRefine((v, ctx) => {
    const lost = v.model === "DETAILED" ? v.lostProbability : 0;
    const q = v.returnIsComplement ? 0 : v.returnProbability;
    if (v.deliveryProbability + q + lost > 1.000001) {
      ctx.addIssue({ code: "custom", path: ["returnProbability"], message: "Delivery + return + lost probabilities cannot exceed 100%" });
    }
  });

export type SimulatorInput = z.input<typeof simulatorInputSchema>;
export type ParsedSimulatorInput = z.output<typeof simulatorInputSchema>;

export type SimulatorResult = {
  model: "DEFAULT" | "DETAILED";
  /** "order" for the default model, "placed lead" for the detailed model. */
  unit: "order" | "placed lead";
  returnProbabilityUsed: number;
  assumptions: string[];
  expectedContribution: number;
  breakevenCpa: number;
  targetCpa: number;
  expectedProfitAtCurrentCpa: number | null;
  sensitivity: { deliveryRates: number[]; cpas: number[]; profit: number[][] };
};

function contribution(v: ParsedSimulatorInput, d: number): { value: number; q: number } {
  const q = v.returnIsComplement ? Math.max(0, 1 - d - (v.model === "DETAILED" ? v.lostProbability : 0)) : v.returnProbability;
  const P = v.salePrice, C = v.sourcingCost, S = v.outboundShipping, R = v.rtoFee, K = v.callCenterCost;
  if (v.model === "DEFAULT") return { value: Math.round((P - C - S) * d - R * q - K), q };
  const L = v.lostProbability, G = v.packagingCost;
  const perShipped = d * (P - C) - (d + q + L) * (S + G) - q * R - L * C;
  const reach = v.confirmationRate * v.shippingRate;
  const k = v.callCenterBasis === "PLACED_LEAD" ? K : K * v.confirmationRate;
  return { value: Math.round(reach * perShipped - k), q };
}

const DELIVERY_GRID = [0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9];

export function simulate(input: SimulatorInput): SimulatorResult {
  const v = simulatorInputSchema.parse(input);
  const { value, q } = contribution(v, v.deliveryProbability);
  const assumptions: string[] = [];
  if (v.returnIsComplement) assumptions.push(v.model === "DETAILED" ? "Return probability Q = 1 − D − L (every shipped parcel that is not delivered or lost is returned)." : "Return probability Q = 1 − D (every shipped parcel that is not delivered is returned).");
  if (v.model === "DEFAULT") assumptions.push("Default formula: forward shipping is charged on delivered parcels only; call-center cost K is charged once per order.");
  else assumptions.push(`Per placed lead; call-center cost charged per ${v.callCenterBasis === "PLACED_LEAD" ? "placed lead" : "confirmed order"}.`);

  const breakevenCpa = value;
  const targetCpa = value - v.targetProfitPerOrder;
  const base = Math.max(Math.abs(breakevenCpa), 1);
  const cpas = [0.25, 0.5, 0.75, 1, 1.25, 1.5].map((f) => Math.round((base * f) / 100) * 100);
  const deliveryRates = [...new Set([...DELIVERY_GRID, Math.round(v.deliveryProbability * 100) / 100])].sort((a, b) => a - b);
  const profit = deliveryRates.map((d) => {
    const c = contribution(v, d).value;
    return cpas.map((cpa) => c - cpa);
  });

  return {
    model: v.model,
    unit: v.model === "DEFAULT" ? "order" : "placed lead",
    returnProbabilityUsed: q,
    assumptions,
    expectedContribution: value,
    breakevenCpa,
    targetCpa,
    expectedProfitAtCurrentCpa: v.currentCpa === undefined ? null : value - v.currentCpa,
    sensitivity: { deliveryRates, cpas, profit },
  };
}
