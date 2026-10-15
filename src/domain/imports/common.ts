import { interpolate, msg, type Vars } from "@/i18n/core";
import { MoneyError, parseToMinor } from "@/lib/money";
import type { ParsedCsv } from "./csv";

/**
 * A problem with one row. `message` is the English, as stored and in the error CSV; `text` is the
 * same with its `{name}` parts and `vars` their values, so the screen can show it through `t()`.
 */
export type RowIssue = { line: number; field?: string; message: string; text?: string; vars?: Vars };
export type Mapping = Record<string, string | null | undefined>;
export type Row = ParsedCsv["rows"][number];

export function cell(row: Row, mapping: Mapping, key: string): string {
  const col = mapping[key];
  return col ? (row.values[col] ?? "").trim() : "";
}

export class RowError extends Error {
  constructor(public field: string, public text: string, public vars?: Vars) {
    super(interpolate(text, vars));
  }
}

/** A row issue from its English text (marked with `msg`) and the values of its `{name}` parts. */
export function rowIssue(line: number, field: string, text: string, vars?: Vars): RowIssue {
  return { line, field, message: interpolate(text, vars), text, ...(vars ? { vars } : {}) };
}

/** The issue a RowError stands for. */
export const issueOf = (line: number, e: RowError) => rowIssue(line, e.field, e.text, e.vars);

export function money(raw: string, currency: string, field: string, opts: { allowNegative?: boolean } = {}): number {
  try {
    const v = parseToMinor(raw, currency);
    if (!opts.allowNegative && v < 0) throw new RowError(field, msg("{field} cannot be negative"), { field });
    return v;
  } catch (e) {
    if (e instanceof RowError) throw e;
    if (e instanceof MoneyError) throw new RowError(field, msg('Invalid amount "{raw}"'), { raw });
    throw e;
  }
}

export function int(raw: string, field: string, { min = 0, max = 1_000_000_000 } = {}): number {
  const v = Number(raw.replace(/[\s, ]/g, ""));
  if (!Number.isInteger(v) || v < min || v > max) throw new RowError(field, msg('Invalid whole number "{raw}"'), { raw });
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
  if (!CURRENCY_RE.test(c)) throw new RowError("currency", msg('Invalid currency "{raw}"'), { raw });
  return c;
}
