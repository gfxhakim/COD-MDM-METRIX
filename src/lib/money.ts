/**
 * Money helpers. All amounts are integer minor units (e.g. centimes for DZD).
 * Never do arithmetic on floats for persisted money.
 */

const EXPONENTS: Record<string, number> = { DZD: 2, EUR: 2, USD: 2, MAD: 2, TND: 3 };

/** Currencies a user can enter a cost or an expense in. Reports are always in the workspace currency. */
export const CURRENCIES = ["DZD", "USD", "EUR", "CNY", "AED", "SAR", "TRY", "GBP", "MAD", "TND"] as const;
export type CurrencyCode = (typeof CURRENCIES)[number];

export function currencyExponent(currency: string): number {
  return EXPONENTS[currency.toUpperCase()] ?? 2;
}

export class MoneyError extends Error {}

function assertSafe(n: number): number {
  if (!Number.isSafeInteger(n)) throw new MoneyError(`Unsafe money value: ${n}`);
  return n;
}

/** Parse a user/CSV amount string ("3 900,50", "3900.5", "DZD 1,200") into minor units. */
export function parseToMinor(input: string | number, currency = "DZD"): number {
  const exp = currencyExponent(currency);
  if (typeof input === "number") {
    if (!Number.isFinite(input)) throw new MoneyError("Amount is not a finite number");
    return assertSafe(Math.round(input * 10 ** exp));
  }
  let s = input.trim().replace(/[^\d.,\-]/g, "");
  if (!s || s === "-") throw new MoneyError(`Invalid amount: "${input}"`);
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    // Whichever separator comes last is the decimal separator.
    const dec = lastComma > lastDot ? "," : ".";
    const thou = dec === "," ? "." : ",";
    s = s.split(thou).join("").replace(dec, ".");
  } else if (lastComma > -1) {
    const decimals = s.length - lastComma - 1;
    // "1,200" is a thousands separator; "12,5" / "12,50" is a decimal comma.
    s = decimals === 3 && s.indexOf(",") === lastComma ? s.replace(",", "") : s.split(",").join(".");
    if ((s.match(/\./g) ?? []).length > 1) s = s.replace(/\.(?=.*\.)/g, "");
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new MoneyError(`Invalid amount: "${input}"`);
  const neg = s.startsWith("-");
  const [intPart, fracPart = ""] = s.replace("-", "").split(".");
  const frac = (fracPart + "0".repeat(exp)).slice(0, exp);
  const roundUp = fracPart.length > exp && Number(fracPart[exp]) >= 5;
  let minor = Number(intPart) * 10 ** exp + Number(frac || "0") + (roundUp ? 1 : 0);
  if (neg) minor = -minor;
  return assertSafe(minor);
}

/**
 * Convert minor units of `from` into minor units of `to`, where `rate` is how many
 * `to` one `from` costs (e.g. 250 DZD per USD). Rounds to the nearest minor unit.
 */
export function convertMinor(minor: number, from: string, to: string, rate: number): number {
  if (from === to) return minor;
  if (!Number.isFinite(rate) || rate <= 0) throw new MoneyError("Exchange rate must be greater than zero");
  const shift = currencyExponent(to) - currencyExponent(from);
  return assertSafe(Math.round(minor * rate * 10 ** shift));
}

export function minorToMajor(minor: number, currency = "DZD"): number {
  return minor / 10 ** currencyExponent(currency);
}

export function addMoney(...values: number[]): number {
  return assertSafe(values.reduce((a, b) => a + assertSafe(b), 0));
}

export function multiplyMoney(minor: number, quantity: number): number {
  if (!Number.isInteger(quantity)) throw new MoneyError("Quantity must be an integer");
  return assertSafe(minor * quantity);
}

/** Multiply by a probability/rate and round half away from zero. */
export function scaleMoney(minor: number, factor: number): number {
  if (!Number.isFinite(factor)) throw new MoneyError("Factor must be finite");
  const v = minor * factor;
  return assertSafe(v < 0 ? -Math.round(-v) : Math.round(v));
}

export function formatMoney(minor: number, currency = "DZD", opts: { decimals?: boolean } = {}): string {
  const exp = currencyExponent(currency);
  const showDecimals = opts.decimals ?? minor % 10 ** exp !== 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    currencyDisplay: "code",
    minimumFractionDigits: showDecimals ? exp : 0,
    maximumFractionDigits: showDecimals ? exp : 0,
  }).format(minorToMajor(minor, currency));
}
