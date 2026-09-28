import { describe, expect, it } from "vitest";
import { sanitizeCell, toCsv } from "@/lib/csv";

describe("CSV export", () => {
  it("neutralises spreadsheet formula injection", () => {
    expect(sanitizeCell("=HYPERLINK(\"http://evil\")")).toBe(`"'=HYPERLINK(""http://evil"")"`);
    expect(sanitizeCell("+1+1")).toBe("'+1+1");
    expect(sanitizeCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(sanitizeCell("-2+3")).toBe("'-2+3");
    expect(sanitizeCell("\tcmd")).toBe("'\tcmd");
  });

  it("keeps numbers numeric and quotes separators", () => {
    expect(sanitizeCell(-1234.5)).toBe("-1234.5");
    expect(sanitizeCell("-12.5")).toBe("-12.5");
    expect(sanitizeCell("a,b")).toBe('"a,b"');
    expect(sanitizeCell(null)).toBe("");
    expect(sanitizeCell(Number.NaN)).toBe("");
  });

  it("builds rows with CRLF", () => {
    expect(toCsv([{ a: 1, b: "x" }], [{ header: "A", value: (r) => r.a }, { header: "B", value: (r) => r.b }])).toBe("A,B\r\n1,x\r\n");
  });
});
