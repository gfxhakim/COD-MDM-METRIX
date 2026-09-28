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
