import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { englishT, type TFunction } from "@/i18n/core";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** `locale` is an Intl locale: components get it from useT().date (src/i18n/client.tsx). */
export function formatDate(d: Date | string | null | undefined, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium" }, locale = "en-GB") {
  if (!d) return "—";
  return new Intl.DateTimeFormat(locale, opts).format(typeof d === "string" ? new Date(d) : d);
}

export function formatDateTime(d: Date | string | null | undefined) {
  return formatDate(d, { dateStyle: "medium", timeStyle: "short" });
}

/** `t` translates the words (src/i18n); English without it. */
export function timeAgo(d: Date | string | null | undefined, t: TFunction = englishT): string {
  if (!d) return t("never");
  const ms = Date.now() - new Date(d).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return t("just now");
  if (m < 60) return t("{n} min ago", { n: m });
  const h = Math.round(m / 60);
  if (h < 48) return t("{n} h ago", { n: h });
  return t("{n} days ago", { n: Math.round(h / 24) });
}

export function toDateInput(d: Date | string | null | undefined): string {
  if (!d) return "";
  return new Date(d).toISOString().slice(0, 10);
}

export function formatPercent(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

export function humanize(s: string): string {
  return s.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()).replace(/\bmdm\b/gi, "MDM");
}
