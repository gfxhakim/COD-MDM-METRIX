import { MoneyError, parseToMinor } from "@/lib/money";
import type { ParsedCsv } from "./csv";

export type RowIssue = { line: number; field?: string; message: string };
export type Mapping = Record<string, string | null | undefined>;
export type Row = ParsedCsv["rows"][number];

export function cell(row: Row, mapping: Mapping, key: string): string {
  const col = mapping[key];
  return col ? (row.values[col] ?? "").trim() : "";
}

export class RowError extends Error {
  constructor(public field: string, message: string) {
    super(message);
  }
}

export function money(raw: string, currency: string, field: string, opts: { allowNegative?: boolean } = {}): number {
  try {
    const v = parseToMinor(raw, currency);
    if (!opts.allowNegative && v < 0) throw new RowError(field, `${field} cannot be negative`);
    return v;
  } catch (e) {
    if (e instanceof RowError) throw e;
    if (e instanceof MoneyError) throw new RowError(field, `Invalid amount "${raw}"`);
    throw e;
  }
}

export function int(raw: string, field: string, { min = 0, max = 1_000_000_000 } = {}): number {
  const v = Number(raw.replace(/[\s, ]/g, ""));
  if (!Number.isInteger(v) || v < min || v > max) throw new RowError(field, `Invalid whole number "${raw}"`);
  return v;
}

/** Stable identity with an occurrence counter so identical rows in one file stay distinct but re-imports dedupe. */
export function occurrenceKeys(identities: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return identities.map((id) => {
    const n = (seen.get(id) ?? 0) + 1;
    seen.set(id, n);
    return `${id}#${n}`;
  });
}

export const CURRENCY_RE = /^[A-Z]{3}$/;
export function currencyOf(raw: string, fallback: string): string {
  const c = raw.trim().toUpperCase();
  if (!c) return fallback;
  if (!CURRENCY_RE.test(c)) throw new RowError("currency", `Invalid currency "${raw}"`);
  return c;
}
