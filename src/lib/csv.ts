/**
 * CSV export with spreadsheet formula-injection protection: any cell starting with
 * = + - @ tab or CR is prefixed with a single quote so Excel/Sheets treat it as text.
 * Pure negative numbers are left alone so numeric columns stay numeric.
 */
export function sanitizeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(s) && !/^-\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T>(rows: readonly T[], columns: readonly { header: string; value: (row: T) => unknown }[]): string {
  const lines = [columns.map((c) => sanitizeCell(c.header)).join(",")];
  for (const r of rows) lines.push(columns.map((c) => sanitizeCell(c.value(r))).join(","));
  return lines.join("\r\n") + "\r\n";
}

/**
 * Rows for Excel in either locale: "," with a decimal point (English Excel) or ";" with a decimal
 * comma (French Excel). Starts with a byte-order mark so accents and Arabic open correctly.
 * Text cells get the same formula-injection guard as `sanitizeCell`.
 */
export function toDelimited(rows: readonly (readonly (string | number | null | undefined)[])[], delimiter: "," | ";"): string {
  const needsQuotes = delimiter === "," ? /[",\n\r]/ : /[";\n\r]/;
  const cell = (v: string | number | null | undefined): string => {
    if (v === null || v === undefined) return "";
    if (typeof v === "number") {
      if (!Number.isFinite(v)) return "";
      const s = String(v);
      return delimiter === ";" ? s.replace(".", ",") : s;
    }
    let s = v;
    if (/^[=+\-@\t\r]/.test(s) && !/^-\d+([.,]\d+)?$/.test(s)) s = `'${s}`;
    return needsQuotes.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + rows.map((r) => r.map(cell).join(delimiter)).join("\r\n") + "\r\n";
}
