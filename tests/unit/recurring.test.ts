import { describe, expect, it } from "vitest";
import { daySpan, isRunning, monthlyEquivalent, recurringByMonth, recurringShare, type RecurringLike } from "@/domain/recurring";

const noon = (d: string) => new Date(`${d}T12:00:00Z`);
const now = noon("2026-10-20");
const monthly = (amount: number, start = "2026-01-01", end: string | null = null): RecurringLike => ({ amount, frequency: "MONTHLY", startDate: noon(start), endDate: end ? noon(end) : null });

describe("repeating expenses", () => {
  it("counts a whole month as the monthly amount, whatever its length", () => {
    expect(recurringShare(monthly(3_100_000), { from: noon("2026-02-01"), to: noon("2026-02-28") }, now)).toBe(3_100_000);
    expect(recurringShare(monthly(3_100_000), { from: noon("2026-03-01"), to: noon("2026-03-31") }, now)).toBe(3_100_000);
  });

  it("splits a month over its days and a week over 7", () => {
    // 10 days of a 31-day month.
    expect(recurringShare(monthly(3_100_000), { from: noon("2026-03-01"), to: noon("2026-03-10") }, now)).toBe(1_000_000);
    expect(recurringShare({ amount: 70_000, frequency: "WEEKLY", startDate: noon("2026-01-01"), endDate: null }, { from: noon("2026-03-01"), to: noon("2026-03-03") }, now)).toBe(30_000);
    expect(recurringShare({ amount: 5_000, frequency: "DAILY", startDate: noon("2026-01-01"), endDate: null }, { from: noon("2026-03-01"), to: noon("2026-03-03") }, now)).toBe(15_000);
    expect(recurringShare({ amount: 365_000, frequency: "YEARLY", startDate: noon("2026-01-01"), endDate: null }, { from: noon("2026-03-01"), to: noon("2026-03-03") }, now)).toBe(3_000);
  });

  it("never counts before it starts, after it ends, or after today", () => {
    const rent = monthly(3_000_000, "2026-09-16", "2026-09-30");
    expect(recurringShare(rent, { from: noon("2026-09-01"), to: noon("2026-09-30") }, now)).toBe(1_500_000);
    expect(recurringShare(rent, {}, now)).toBe(1_500_000);
    // October has 31 days and today is the 20th.
    expect(recurringShare(monthly(3_100_000), { from: noon("2026-10-01"), to: noon("2026-10-31") }, now)).toBe(2_000_000);
    expect(recurringShare(monthly(3_100_000, "2026-11-01"), {}, now)).toBe(0);
  });

  it("picks the days whose noon lies in a range, so a time zone's day boundaries work", () => {
    // Algiers (UTC+1): 2026-03-01 starts at 2026-02-28 23:00 UTC and 2026-03-10 ends at 22:59:59.
    const span = daySpan({ from: new Date("2026-02-28T23:00:00Z"), to: new Date("2026-03-10T22:59:59Z") });
    expect(span.last - span.first + 1).toBe(10);
    expect(recurringShare(monthly(3_100_000), { from: new Date("2026-02-28T23:00:00Z"), to: new Date("2026-03-10T22:59:59Z") }, now)).toBe(1_000_000);
  });

  it("splits by calendar month", () => {
    const m = recurringByMonth(monthly(3_000_000, "2026-08-16"), { from: noon("2026-08-01"), to: noon("2026-10-31") }, now);
    expect([...m.keys()]).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(m.get("2026-08")).toBe(Math.round((3_000_000 * 16) / 31));
    expect(m.get("2026-09")).toBe(3_000_000);
    expect(m.get("2026-10")).toBe(Math.round((3_000_000 * 20) / 31));
  });

  it("compares in an average month and knows when it still runs", () => {
    expect(monthlyEquivalent({ amount: 12_000, frequency: "YEARLY" })).toBe(1_000);
    expect(monthlyEquivalent({ amount: 1_200, frequency: "WEEKLY" })).toBe(5_200);
    expect(monthlyEquivalent({ amount: 1_200, frequency: "DAILY" })).toBe(36_500);
    expect(isRunning(monthly(1), now)).toBe(true);
    expect(isRunning(monthly(1, "2026-01-01", "2026-10-20"), now)).toBe(true);
    expect(isRunning(monthly(1, "2026-01-01", "2026-10-19"), now)).toBe(false);
    expect(isRunning(monthly(1, "2026-10-21"), now)).toBe(false);
  });
});
