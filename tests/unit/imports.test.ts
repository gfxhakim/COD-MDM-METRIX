import { describe, expect, it } from "vitest";
import { CsvError, parseCsv } from "@/domain/imports/csv";
import { detectDateFormat, parseDate } from "@/domain/imports/dates";
import { missingRequired, suggestMapping } from "@/domain/imports/fields";
import { occurrenceKeys } from "@/domain/imports/common";
import { parseOrderStatus, utmFromUrl, validateOrders } from "@/domain/imports/orders";
import { convert, currencyFromHeader, validateSpend } from "@/domain/imports/spend";
import { parseCategory, validateBank, validateExpenses } from "@/domain/imports/finance";

const products = [
  { id: "p1", sku: "PC-01", name: "Posture Corrector", salePrice: 390000 },
  { id: "p2", sku: "MB-02", name: "Mini Blender", salePrice: 450000 },
];

describe("parseCsv", () => {
  it("strips the BOM, guesses the delimiter and numbers lines from the header", () => {
    const csv = parseCsv("﻿a;b\n1;2\n\n3;4\n");
    expect(csv.headers).toEqual(["a", "b"]);
    expect(csv.delimiter).toBe(";");
    expect(csv.rows.map((r) => r.line)).toEqual([2, 4]);
    expect(csv.rows[1].values).toEqual({ a: "3", b: "4" });
  });
  it("renames duplicate and blank headers", () => {
    expect(parseCsv("x,x,\n1,2,3").headers).toEqual(["x", "x (2)", "Column 3"]);
  });
  it("rejects binary and empty files", () => {
    expect(() => parseCsv("a,b\n1\u0000,2")).toThrow(CsvError);
    expect(() => parseCsv("")).toThrow(CsvError);
  });
});

describe("dates", () => {
  it("detects day-first vs month-first from the column", () => {
    expect(detectDateFormat(["03/04/2026", "25/04/2026"])).toBe("DMY");
    expect(detectDateFormat(["04/25/2026"])).toBe("MDY");
    expect(detectDateFormat(["2026-04-25"])).toBe("ISO");
  });
  it("parses ISO with offsets and rejects impossible dates", () => {
    expect(parseDate("2026-04-25 10:00:00 +0100", "ISO")?.toISOString()).toBe("2026-04-25T09:00:00.000Z");
    expect(parseDate("31/02/2026", "DMY")).toBeNull();
    expect(parseDate("25/04/2026", "DMY")?.toISOString()).toBe("2026-04-25T00:00:00.000Z");
    expect(parseDate("04/25/26", "MDY")?.toISOString()).toBe("2026-04-25T00:00:00.000Z");
    expect(parseDate("tomorrow", "DMY")).toBeNull();
  });
});

describe("column mapping", () => {
  it("maps a Shopify export", () => {
    const m = suggestMapping("ORDERS", ["Name", "Id", "Created at", "Lineitem quantity", "Lineitem name", "Lineitem price", "Lineitem sku", "Total", "Billing Phone", "Shipping Province", "Landing Site", "Tags", "Notes"]);
    expect(m).toMatchObject({ orderNumber: "Name", externalOrderId: "Id", placedAt: "Created at", sku: "Lineitem sku", quantity: "Lineitem quantity", unitPrice: "Lineitem price", total: "Total", phone: "Billing Phone", wilaya: "Shipping Province", landingUrl: "Landing Site" });
  });
  it("maps a Meta Ads export and reports missing required fields", () => {
    const m = suggestMapping("AD_SPEND", ["Day", "Campaign name", "Ad set name", "Ad name", "Ad ID", "Amount spent (USD)", "Impressions", "Link clicks"]);
    expect(m).toMatchObject({ date: "Day", adId: "Ad ID", spend: "Amount spent (USD)", clicks: "Link clicks" });
    expect(missingRequired("AD_SPEND", { date: "Day" })).toEqual(["Amount spent"]);
    expect(missingRequired("BANK", { date: "d" })).toContain("Amount or Debit/Credit");
  });
});

describe("order validation", () => {
  const mapping = { orderNumber: "Name", externalOrderId: "Id", placedAt: "Created at", sku: "Lineitem sku", quantity: "Lineitem quantity", unitPrice: "Lineitem price", total: "Total", status: "Status", phone: "Phone", landingUrl: "Landing", utmContent: "utm_content" };
  const header = "Name,Id,Created at,Lineitem sku,Lineitem quantity,Lineitem price,Total,Status,Phone,Landing,utm_content";

  it("groups Shopify line items into one order and reads UTM from the landing URL", () => {
    const csv = parseCsv(`${header}\n#1001,555,2026-04-01 10:00,PC-01,2,3900,12300,Confirmé,0551234567,/p?utm_source=fb&utm_content=CR_Hook-01,\n#1001,,2026-04-01 10:00,MB-02,1,4500,,,,,`);
    const r = validateOrders(csv, mapping, { dateFormat: "ISO", currency: "DZD", products });
    expect(r.issues).toEqual([]);
    expect(r.orders).toHaveLength(1);
    const o = r.orders[0];
    expect(o).toMatchObject({ externalOrderId: "555", orderNumber: "#1001", status: "CONFIRMED", codAmount: 1230000, utmSource: "fb", utmContent: "CR_Hook-01", creativeKey: "cr_hook-01", lines: [2, 3] });
    expect(o.items.map((l) => [l.productId, l.quantity, l.unitPrice])).toEqual([["p1", 2, 390000], ["p2", 1, 450000]]);
  });

  it("defaults COD to the line total and warns on unknown products and statuses", () => {
    const csv = parseCsv(`${header}\nES-1,,01/04/2026,ZZ-9,2,1000,,weird,,,`);
    const r = validateOrders(csv, mapping, { dateFormat: "DMY", currency: "DZD", products });
    expect(r.orders[0].codAmount).toBe(200000);
    expect(r.orders[0].items[0].productId).toBeNull();
    expect(r.warnings.map((w) => w.field).sort()).toEqual(["sku", "status"]);
  });

  it("rejects the whole order when any line is invalid", () => {
    const csv = parseCsv(`${header}\nES-2,,2026-04-01,PC-01,x,3900,,,,,\nES-2,,2026-04-01,MB-02,1,4500,,,,,\nES-3,,not a date,PC-01,1,3900,,,,,\n,,2026-04-01,PC-01,1,1,,,,,`);
    const r = validateOrders(csv, mapping, { dateFormat: "ISO", currency: "DZD", products });
    expect(r.orders).toEqual([]);
    expect(r.issues.map((i) => [i.line, i.field])).toEqual([[5, "orderNumber"], [2, "quantity"], [4, "placedAt"]]);
  });

  it("rejects orders in another currency", () => {
    const csv = parseCsv("Name,Created at,Total,Currency\nX1,2026-04-01,10,EUR");
    const r = validateOrders(csv, { orderNumber: "Name", placedAt: "Created at", total: "Total", currency: "Currency" }, { dateFormat: "ISO", currency: "DZD", products });
    expect(r.issues[0].field).toBe("currency");
  });

  it("recognizes EN/FR statuses", () => {
    expect(parseOrderStatus("Annulée").status).toBe("CANCELED");
    expect(parseOrderStatus("livré").status).toBe("CONFIRMED");
    expect(parseOrderStatus("En attente")).toEqual({ status: "PENDING", recognized: true });
    expect(utmFromUrl("utm_campaign=x&utm_medium=cpc").utmCampaign).toBe("x");
  });
});

describe("spend validation", () => {
  const mapping = { date: "Day", campaignName: "Campaign name", adName: "Ad name", adId: "Ad ID", spend: "Amount spent (USD)", impressions: "Impressions" };
  const header = "Day,Campaign name,Ad name,Ad ID,Amount spent (USD),Impressions";

  it("converts foreign-currency spend and keeps the original", () => {
    expect(currencyFromHeader("Amount spent (USD)")).toBe("USD");
    expect(convert(1250, "USD", "DZD", 250)).toBe(312500);
    const csv = parseCsv(`${header}\n2026-04-01,C1,Hook A,cr_a,12.50,1000`);
    const r = validateSpend(csv, mapping, { dateFormat: "ISO", workspaceCurrency: "DZD", fxRate: 250 });
    expect(r.items[0]).toMatchObject({ spend: 312500, originalSpend: 1250, originalCurrency: "USD", fxRate: 250, externalCreativeId: "cr_a", creativeKey: "cr_a" });
  });

  it("requires a rate for foreign currency, skips empty rows and keeps unknown creatives", () => {
    const csv = parseCsv(`${header}\n2026-04-01,C1,Hook A,cr_a,12.50,1000\n2026-04-01,C1,Hook B,cr_b,0,0\n2026-04-02,C1,,,5,10`);
    expect(validateSpend(csv, mapping, { dateFormat: "ISO", workspaceCurrency: "DZD" }).issues[0].field).toBe("currency");
    const r = validateSpend(csv, mapping, { dateFormat: "ISO", workspaceCurrency: "DZD", fxRate: 250 });
    expect(r.skippedZero).toBe(1);
    expect(r.items[1].creativeKey).toBeNull();
    expect(r.warnings).toHaveLength(1);
  });

  it("builds identity without the amount so re-exports update rather than duplicate", () => {
    const a = validateSpend(parseCsv(`${header}\n2026-04-01,C1,Hook A,cr_a,12.50,1000`), mapping, { dateFormat: "ISO", workspaceCurrency: "DZD", fxRate: 250 });
    const b = validateSpend(parseCsv(`${header}\n2026-04-01T00:00:00Z,C1,Hook A,cr_a,20,1500`), mapping, { dateFormat: "ISO", workspaceCurrency: "DZD", fxRate: 250 });
    expect(a.items[0].identity).toBe(b.items[0].identity);
    expect(occurrenceKeys(["x", "x", "y"])).toEqual(["x#1", "x#2", "y#1"]);
  });
});

describe("expense and bank validation", () => {
  it("maps category synonyms and product-specific rows", () => {
    expect(parseCategory("Frais bancaires").category).toBe("BANK_FEES");
    expect(parseCategory("DOMAINS_PROXIES").category).toBe("DOMAINS_PROXIES");
    expect(parseCategory("Airbnb")).toEqual({ category: "OTHER", recognized: false });
    expect(parseCategory("My pay").category).toBe("OWNER_PAY");
    expect(parseCategory("OWNER_PAY").category).toBe("OWNER_PAY");
    expect(parseCategory("Salaire").category).toBe("SALARIES");
    expect(parseCategory("Employee pay").category).toBe("SALARIES");
    const csv = parseCsv("date,category,amount,sku\n2026-04-01,Emballage,1500,PC-01\n2026-04-02,Logiciel,3000,\n2026-04-03,Other,0,\n2026-04-03,Other,10,NOPE");
    const r = validateExpenses(csv, { date: "date", category: "category", amount: "amount", productSku: "sku" }, { dateFormat: "ISO", currency: "DZD", products });
    expect(r.items.map((e) => [e.category, e.amount, e.productId])).toEqual([["PACKAGING", 150000, "p1"], ["SOFTWARE", 300000, null]]);
    expect(r.issues.map((i) => i.field)).toEqual(["amount", "productSku"]);
  });

  it("reads signed amounts or debit/credit columns", () => {
    const csv = parseCsv("date,label,debit,credit\n2026-04-01,FB ADS,12000,\n2026-04-02,MDM REMIT,,85000\n2026-04-03,empty,,");
    const r = validateBank(csv, { date: "date", description: "label", debit: "debit", credit: "credit" }, { dateFormat: "ISO", currency: "DZD" });
    expect(r.items.map((b) => b.amount)).toEqual([-1200000, 8500000]);
    expect(r.issues).toHaveLength(1);
  });
});
