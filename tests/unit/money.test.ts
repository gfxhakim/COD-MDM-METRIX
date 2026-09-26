import { describe, expect, it } from "vitest";
import { addMoney, formatMoney, MoneyError, multiplyMoney, parseToMinor, scaleMoney } from "@/lib/money";

describe("money", () => {
  it("parses common amount formats into integer minor units", () => {
    expect(parseToMinor("3900", "DZD")).toBe(390000);
    expect(parseToMinor("3900.5", "DZD")).toBe(390050);
    expect(parseToMinor("3 900,50", "DZD")).toBe(390050);
    expect(parseToMinor("1,200", "DZD")).toBe(120000);
    expect(parseToMinor("1.234,56", "DZD")).toBe(123456);
    expect(parseToMinor("1,234.56", "DZD")).toBe(123456);
    expect(parseToMinor("DZD 12,5", "DZD")).toBe(1250);
    expect(parseToMinor("-45.10", "DZD")).toBe(-4510);
    expect(parseToMinor(19.99, "USD")).toBe(1999);
  });

  it("rounds sub-minor digits half up instead of accumulating float error", () => {
    expect(parseToMinor("0.105", "DZD")).toBe(11);
    expect(parseToMinor("0.104", "DZD")).toBe(10);
    // 0.1 + 0.2 in floats is 0.30000000000000004; in minor units it is exact.
    expect(addMoney(parseToMinor("0.1"), parseToMinor("0.2"))).toBe(30);
  });

  it("rejects garbage", () => {
    expect(() => parseToMinor("abc")).toThrow(MoneyError);
    expect(() => parseToMinor("")).toThrow(MoneyError);
    expect(() => parseToMinor(Number.NaN)).toThrow(MoneyError);
  });

  it("multiplies by integer quantities only and guards overflow", () => {
    expect(multiplyMoney(390000, 3)).toBe(1170000);
    expect(() => multiplyMoney(100, 1.5)).toThrow(MoneyError);
    expect(() => addMoney(Number.MAX_SAFE_INTEGER, 1)).toThrow(MoneyError);
  });

  it("scales by probabilities with symmetric rounding", () => {
    expect(scaleMoney(1001, 0.5)).toBe(501);
    expect(scaleMoney(-1001, 0.5)).toBe(-501);
  });

  it("formats with currency code", () => {
    expect(formatMoney(390000, "DZD").replace(/\s/g, " ")).toBe("DZD 3,900");
    expect(formatMoney(390050, "DZD").replace(/\s/g, " ")).toBe("DZD 3,900.50");
  });
});
