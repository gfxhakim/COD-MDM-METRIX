/**
 * English and Arabic. The English text in the code is the key: `t("Profit tracker")` shows the
 * Arabic from src/i18n/ar when Arabic is picked, and the English itself otherwise (or when a text
 * has no translation yet). `{name}` in a text is filled from `vars`, in both languages.
 */

export const LOCALES = ["en", "ar"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
/** Remembers the language in this browser; the account remembers it too (User.locale). */
export const LOCALE_COOKIE = "cft_lang";

export type Dict = Record<string, string>;
export type Vars = Record<string, string | number>;
/** Translates an English text, filling its `{name}` parts from `vars`. */
export type TFunction = (text: string, vars?: Vars) => string;

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}

export function dirOf(locale: Locale): "ltr" | "rtl" {
  return locale === "ar" ? "rtl" : "ltr";
}

/** Dates in Arabic use Algeria's month names (جانفي, فيفري…) and Western digits. */
export function dateLocaleOf(locale: Locale): string {
  return locale === "ar" ? "ar-DZ" : "en-GB";
}

const PLACEHOLDER = /\{(\w+)\}/g;

export function interpolate(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(PLACEHOLDER, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export function makeT(dict: Dict | null): TFunction {
  return (text, vars) => interpolate((dict && dict[text]) || text, vars);
}

/** The text split around its `{name}` parts, for filling them with elements (see `tx`). */
export function splitPlaceholders(text: string): (string | { name: string })[] {
  const out: (string | { name: string })[] = [];
  let last = 0;
  for (const m of text.matchAll(PLACEHOLDER)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push({ name: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** English is the identity: for code outside React that is handed no `t`. */
export const englishT: TFunction = (text, vars) => interpolate(text, vars);

/**
 * Marks an English text kept outside a component (a constant, a label table) that is shown later
 * through `t(text)`. It returns the text unchanged; the dictionary test finds it and checks the
 * Arabic exists.
 */
export const msg = <S extends string>(text: S): S => text;
