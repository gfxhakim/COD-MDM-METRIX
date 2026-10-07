/**
 * The parts of the seller's MDM account each sync reads after orders and parcels. Each is
 * read on its own, so one MDM refuses (or fails to answer) never stops the others.
 */
export const ACCOUNT_PARTS = ["wallet", "fees", "payouts", "prices", "stock", "capital", "arrivals"] as const;
export type AccountPart = (typeof ACCOUNT_PARTS)[number];

export const ACCOUNT_PART_LABEL: Record<AccountPart, string> = {
  wallet: "wallet",
  fees: "money and fees per order",
  payouts: "payouts",
  prices: "price list",
  stock: "stock",
  capital: "stock value",
  arrivals: "stock arrivals",
};

/**
 * How the last sync went for one part. `okAt` is the last time it was read in full;
 * `denied` means the API key isn't allowed to read it; `message` says what went wrong.
 */
export type PartState = { at: string; okAt: string | null; ok: boolean; denied?: boolean; message?: string; count?: number };
export type PartStates = Partial<Record<AccountPart, PartState>>;

export function readPartStates(v: unknown): PartStates {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
  const out: PartStates = {};
  for (const k of ACCOUNT_PARTS) {
    const s = (v as Record<string, unknown>)[k];
    if (typeof s === "object" && s !== null && typeof (s as PartState).at === "string") out[k] = s as PartState;
  }
  return out;
}

const ACRONYMS = new Set(["COD", "VAT", "TVA", "SMS", "RTO", "ID", "USD", "EUR", "DZD", "API", "MDM"]);

/** "DELIVERY_FEE" or "deliveryFee" → "Delivery fee", "COD" stays "COD". MDM's own words, made readable. */
export function mdmWords(v: string | null | undefined): string {
  if (!v) return "";
  const words = v.replace(/([a-z])([A-Z])/g, "$1 $2").split(/[\s_-]+/).filter(Boolean);
  const s = words.map((w) => (ACRONYMS.has(w.toUpperCase()) ? w.toUpperCase() : w.toLowerCase())).join(" ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
