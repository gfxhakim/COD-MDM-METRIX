/** Quick date ranges shared by the pickers (export, custom sync). Days are YYYY-MM-DD in the workspace's time zone. */
import { englishT, msg, type TFunction } from "@/i18n/core";

export const RANGES = [
  { key: "today", label: msg("Today") },
  { key: "yesterday", label: msg("Yesterday") },
  { key: "7d", label: msg("Last 7 days") },
  { key: "30d", label: msg("Last 30 days") },
  { key: "month", label: msg("This month") },
  { key: "lastMonth", label: msg("Last month") },
  { key: "all", label: msg("All dates") },
  { key: "custom", label: msg("Custom") },
] as const;
export type RangeKey = (typeof RANGES)[number]["key"];

/** Today in the workspace's time zone, as YYYY-MM-DD. */
export function todayIn(timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export function rangeDays(key: RangeKey, today: string, custom: { from: string; to: string }): { from?: string; to?: string } {
  switch (key) {
    case "today": return { from: today, to: today };
    case "yesterday": return { from: addDays(today, -1), to: addDays(today, -1) };
    case "7d": return { from: addDays(today, -6), to: today };
    case "30d": return { from: addDays(today, -29), to: today };
    case "month": return { from: `${today.slice(0, 8)}01`, to: today };
    case "lastMonth": {
      const end = addDays(`${today.slice(0, 8)}01`, -1);
      return { from: `${end.slice(0, 8)}01`, to: end };
    }
    case "all": return {};
    case "custom": return { from: custom.from || undefined, to: custom.to || undefined };
  }
}

const MONTHS = [msg("Jan"), msg("Feb"), msg("Mar"), msg("Apr"), msg("May"), msg("Jun"), msg("Jul"), msg("Aug"), msg("Sep"), msg("Oct"), msg("Nov"), msg("Dec")];

/** "2026-09-01" → "1 Sep 2026", the same in every browser. `t` gives the month in the picked language. */
export const shortDay = (day: string, t: TFunction = englishT) => `${Number(day.slice(8, 10))} ${t(MONTHS[Number(day.slice(5, 7)) - 1] ?? "")} ${day.slice(0, 4)}`;
