"use client";

import * as React from "react";
import { formatDate, timeAgo } from "@/lib/utils";
import { dateLocaleOf, dirOf, makeT, splitPlaceholders, type Dict, type Locale, type TFunction } from "./core";

type I18n = {
  locale: Locale;
  dir: "ltr" | "rtl";
  /** Translates a text: `t("{n} orders", { n: 3 })`. */
  t: TFunction;
  /** Like `t`, but `{name}` parts can be elements: `tx("Up to {a} per order", { a: <b>…</b> })`. */
  tx: (text: string, vars: Record<string, React.ReactNode>) => React.ReactNode;
  /** A date in the picked language (Intl options as in formatDate). */
  date: (d: Date | string | null | undefined, opts?: Intl.DateTimeFormatOptions) => string;
  dateTime: (d: Date | string | null | undefined) => string;
  /** "5 min ago" in the picked language. */
  ago: (d: Date | string | null | undefined) => string;
};

const I18nCtx = React.createContext<I18n | null>(null);

export function I18nProvider({ locale, dict, children }: { locale: Locale; dict: Dict | null; children: React.ReactNode }) {
  const value = React.useMemo<I18n>(() => {
    const t = makeT(locale === "en" ? null : dict);
    const dl = dateLocaleOf(locale);
    return {
      locale,
      dir: dirOf(locale),
      t,
      tx: (text, vars) => {
        const parts = splitPlaceholders(t(text));
        return parts.map((p, i) => (typeof p === "string" ? p : <React.Fragment key={i}>{p.name in vars ? vars[p.name] : `{${p.name}}`}</React.Fragment>));
      },
      date: (d, opts) => formatDate(d, opts, dl),
      dateTime: (d) => formatDate(d, { dateStyle: "medium", timeStyle: "short" }, dl),
      ago: (d) => timeAgo(d, t),
    };
  }, [locale, dict]);
  React.useEffect(() => {
    activeT = value.t;
  }, [value]);
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

let activeT: TFunction = makeT(null);

/**
 * The picked language's `t` for code outside components that runs in the browser after the page
 * is up, such as turning a server error into the toast text. English until the provider mounts.
 */
export function currentT(): TFunction {
  return activeT;
}

/** The picked language and its `t`. English when no provider is around (tests, error pages). */
export function useT(): I18n {
  return React.useContext(I18nCtx) ?? FALLBACK;
}

const englishT = makeT(null);
const FALLBACK: I18n = {
  locale: "en",
  dir: "ltr",
  t: englishT,
  tx: (text, vars) => splitPlaceholders(englishT(text)).map((p, i) => (typeof p === "string" ? p : <React.Fragment key={i}>{vars[p.name]}</React.Fragment>)),
  date: (d, opts) => formatDate(d, opts),
  dateTime: (d) => formatDate(d, { dateStyle: "medium", timeStyle: "short" }),
  ago: (d) => timeAgo(d, englishT),
};
