/**
 * Repeating expenses (rent, salaries, subscriptions). Pure functions only.
 *
 * Nothing is written per occurrence: a repeating expense is spread over the days it covers, so a
 * week, a month or any custom period gets its own share. A monthly amount is split over the days of
 * each month, a yearly one over the days of each year, a weekly one over 7 days.
 *
 * Days are calendar days numbered from 1970-01-01. An instant range covers a day when it contains
 * that day's noon (UTC), which is where expense dates sit, so the workspace's own day boundaries
 * (a few hours either side of UTC midnight) pick the right days.
 */

export const FREQUENCIES = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as const;
export type Frequency = (typeof FREQUENCIES)[number];
export const FREQUENCY_LABEL: Record<Frequency, string> = { DAILY: "Every day", WEEKLY: "Every week", MONTHLY: "Every month", YEARLY: "Every year" };
export const FREQUENCY_UNIT: Record<Frequency, string> = { DAILY: "day", WEEKLY: "week", MONTHLY: "month", YEARLY: "year" };

export type RecurringLike = { amount: number; frequency: Frequency; startDate: Date; endDate: Date | null };

const DAY = 86_400_000;
const HALF = DAY / 2;

/** The day a stored date (noon UTC) or any instant falls on, in UTC. */
export const dayOf = (d: Date) => Math.floor(d.getTime() / DAY);
const dateOfDay = (n: number) => new Date(n * DAY);

function daysInMonthOf(n: number) {
  const d = dateOfDay(n);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}
function daysInYearOf(n: number) {
  const y = dateOfDay(n).getUTCFullYear();
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365;
}

/** The share of one day. */
export function perDay(r: Pick<RecurringLike, "amount" | "frequency">, day: number): number {
  switch (r.frequency) {
    case "DAILY": return r.amount;
    case "WEEKLY": return r.amount / 7;
    case "MONTHLY": return r.amount / daysInMonthOf(day);
    case "YEARLY": return r.amount / daysInYearOf(day);
  }
}

/** First and last day (inclusive) a range of instants covers, by their noons. Open ends stay open. */
export function daySpan(range: { from?: Date; to?: Date }): { first: number; last: number } {
  return {
    first: range.from ? Math.ceil((range.from.getTime() - HALF) / DAY) : Number.NEGATIVE_INFINITY,
    last: range.to ? Math.floor((range.to.getTime() - HALF) / DAY) : Number.POSITIVE_INFINITY,
  };
}

/** The days a repeating expense counts in a range: never before it starts, after it ends, or after today. */
function countedDays(r: RecurringLike, range: { from?: Date; to?: Date }, now: Date) {
  const span = daySpan(range);
  const first = Math.max(dayOf(r.startDate), span.first);
  const last = Math.min(r.endDate ? dayOf(r.endDate) : Number.POSITIVE_INFINITY, span.last, dayOf(now));
  return { first, last };
}

/** What a repeating expense costs in a range of instants, in minor units. */
export function recurringShare(r: RecurringLike, range: { from?: Date; to?: Date }, now: Date): number {
  const { first, last } = countedDays(r, range, now);
  let sum = 0;
  for (let d = first; d <= last; d++) sum += perDay(r, d);
  return Math.round(sum);
}

/** The same, split by calendar month ("2026-10"). */
export function recurringByMonth(r: RecurringLike, range: { from?: Date; to?: Date }, now: Date): Map<string, number> {
  const { first, last } = countedDays(r, range, now);
  const raw = new Map<string, number>();
  for (let d = first; d <= last; d++) {
    const k = dateOfDay(d).toISOString().slice(0, 7);
    raw.set(k, (raw.get(k) ?? 0) + perDay(r, d));
  }
  return new Map([...raw].map(([k, v]) => [k, Math.round(v)]));
}

/** What it costs in an average month, to compare repeating expenses with each other. */
export function monthlyEquivalent(r: Pick<RecurringLike, "amount" | "frequency">): number {
  switch (r.frequency) {
    case "DAILY": return Math.round((r.amount * 365) / 12);
    case "WEEKLY": return Math.round((r.amount * 52) / 12);
    case "MONTHLY": return r.amount;
    case "YEARLY": return Math.round(r.amount / 12);
  }
}

/** True while it still counts today. */
export const isRunning = (r: Pick<RecurringLike, "startDate" | "endDate">, now: Date) => dayOf(r.startDate) <= dayOf(now) && (!r.endDate || dayOf(r.endDate) >= dayOf(now));
