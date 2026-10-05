/**
 * Calendar days in a workspace's time zone. Pickers send days as YYYY-MM-DD; the server turns
 * them into instants here, so "today" means the same thing for the owner and for the database.
 */

export function zoneOffsetMs(at: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - Math.floor(at.getTime() / 1000) * 1000;
  } catch {
    return 0;
  }
}

/** The instant a local day starts in `timeZone`. */
export function dayStart(day: string, timeZone: string): Date {
  const guess = Date.parse(`${day}T00:00:00Z`);
  return new Date(guess - zoneOffsetMs(new Date(guess), timeZone));
}

export const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** Inclusive days → the first and last instant they cover. Either end may be open. */
export function dayRange(f: { from?: string; to?: string }, timeZone: string): { from?: Date; to?: Date } {
  return { from: f.from ? dayStart(f.from, timeZone) : undefined, to: f.to ? new Date(dayStart(nextDay(f.to), timeZone).getTime() - 1) : undefined };
}
