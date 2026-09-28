import { z } from "zod";
import { CURRENCIES } from "@/lib/money";

export const CALL_CENTER_BASES = ["PLACED_LEAD", "CONFIRMED_ORDER", "CALL_ATTEMPT"] as const;
export const OVERHEAD_POLICIES = ["NONE", "BY_DELIVERED_ORDERS", "BY_REVENUE"] as const;

/** Fallback fees (minor units) used when a product has no cost version for a date. */
export const economicsDefaultsSchema = z.object({
  forwardShippingFee: z.number().int().min(0).default(60000),
  rtoFee: z.number().int().min(0).default(20000),
  callCenterFee: z.number().int().min(0).default(10000),
  packagingFee: z.number().int().min(0).default(5000),
  callCenterBasis: z.enum(CALL_CENTER_BASES).default("CONFIRMED_ORDER"),
  overheadPolicy: z.enum(OVERHEAD_POLICIES).default("BY_DELIVERED_ORDERS"),
  revenueView: z.enum(["DELIVERED", "REMITTED"]).default("DELIVERED"),
});
export type EconomicsDefaults = z.infer<typeof economicsDefaultsSchema>;

export const verdictThresholdsSchema = z.object({
  minSampleOrders: z.number().int().min(1).default(20),
  /** trueNetProfit ÷ adSpend. 0.3 means 30% profit on top of ad spend. */
  targetPoas: z.number().min(-10).max(100).default(0.3),
  minDeliveryRate: z.number().min(0).max(1).default(0.55),
  maxRtoRate: z.number().min(0).max(1).default(0.3),
  /** Placed CPA considered "acceptable" for BAD_TRAFFIC detection (minor units). */
  acceptablePlacedCpa: z.number().int().min(0).default(80000),
  /** Shipped parcels needed before delivery/RTO rates can trigger BAD_TRAFFIC. */
  minShippedForRates: z.number().int().min(1).default(10),
});
export type VerdictThresholds = z.infer<typeof verdictThresholdsSchema>;

export function parseEconomicsDefaults(v: unknown): EconomicsDefaults {
  const r = economicsDefaultsSchema.safeParse(v ?? {});
  return r.success ? r.data : economicsDefaultsSchema.parse({});
}

export function parseVerdictThresholds(v: unknown): VerdictThresholds {
  const r = verdictThresholdsSchema.safeParse(v ?? {});
  return r.success ? r.data : verdictThresholdsSchema.parse({});
}

export const currencyCodeSchema = z.enum(CURRENCIES);

/**
 * Exchange rates the workspace uses to fill in forms: how many units of the
 * workspace currency one unit of each other currency costs, e.g. { USD: 250 }.
 * Each saved amount keeps the rate it was converted with, so changing a rate
 * here never rewrites past costs.
 */
export const exchangeRatesSchema = z.partialRecord(currencyCodeSchema, z.number().positive().max(1_000_000));
export type ExchangeRates = z.infer<typeof exchangeRatesSchema>;

export function parseExchangeRates(v: unknown): ExchangeRates {
  const r = exchangeRatesSchema.safeParse(v ?? {});
  return r.success ? r.data : {};
}
