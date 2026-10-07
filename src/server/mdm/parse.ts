import { MoneyError, parseToMinor } from "@/lib/money";

/** Small, strict readers for MDM's JSON. Anything unexpected reads as null rather than being guessed. */

export type Obj = Record<string, unknown>;
export const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
export function obj(v: unknown, what: string): Obj {
  if (!isObj(v)) throw new Error(`${what} is not an object`);
  return v;
}
export const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
export function date(v: unknown): Date | null {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
/** An MDM amount (major units, e.g. 2500 = 2 500 DZD) as integer minor units, or null. */
export function money(v: unknown, currency: string): number | null {
  if (v == null || v === "") return null;
  if (typeof v !== "number" && typeof v !== "string") return null;
  try {
    return parseToMinor(v, currency);
  } catch (e) {
    if (e instanceof MoneyError) return null;
    throw e;
  }
}
/** A count (units, lines): a finite number rounded to a whole, else 0. */
export const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0);
