export type DateFormat = "AUTO" | "ISO" | "DMY" | "MDY";

const SLASH = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+\-]\d{2}:?\d{2})?)?$/;

/** Decide DMY vs MDY from a column sample: any first part > 12 ⇒ DMY, any second part > 12 ⇒ MDY. Defaults to DMY. */
export function detectDateFormat(values: readonly string[]): Exclude<DateFormat, "AUTO"> {
  let dmy = false, mdy = false, slash = false;
  for (const v of values) {
    const m = SLASH.exec(v.trim());
    if (!m) continue;
    slash = true;
    if (Number(m[1]) > 12) dmy = true;
    if (Number(m[2]) > 12) mdy = true;
  }
  if (!slash) return "ISO";
  if (mdy && !dmy) return "MDY";
  return "DMY";
}

function valid(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): Date | null {
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  // Reject rollovers such as 31/02.
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  if (y < 2000 || y > 2100) return null;
  return date;
}

/**
 * Parse a date cell. Dates without a timezone are read as UTC wall time.
 * Returns null when the value is not a real calendar date.
 */
export function parseDate(raw: string, format: Exclude<DateFormat, "AUTO">): Date | null {
  const v = raw.trim();
  if (!v) return null;
  const iso = ISO.exec(v);
  if (iso) {
    const [, y, mo, d, h = "0", mi = "0", s = "0", tz] = iso;
    const base = valid(+y, +mo, +d, +h, +mi, +s);
    if (!base || !tz || tz === "Z") return base;
    const sign = tz.startsWith("-") ? -1 : 1;
    const digits = tz.replace(/[+\-:]/g, "");
    const offsetMin = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)));
    return new Date(base.getTime() - offsetMin * 60_000);
  }
  const sl = SLASH.exec(v);
  if (sl && format !== "ISO") {
    const [, a, b, yRaw, h = "0", mi = "0", s = "0"] = sl;
    const y = yRaw.length === 2 ? 2000 + Number(yRaw) : Number(yRaw);
    return format === "DMY" ? valid(y, +b, +a, +h, +mi, +s) : valid(y, +a, +b, +h, +mi, +s);
  }
  if (sl && format === "ISO") return parseDate(v, "DMY");
  return null;
}
