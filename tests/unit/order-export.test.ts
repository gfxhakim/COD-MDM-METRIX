import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { COLUMN_PRESETS, EXPORT_COLUMNS, exportFileName, isCustomerColumn, statusGroupOf } from "@/domain/orderExport";
import { toDelimited } from "@/lib/csv";
import { maskCustomer, normalizeCustomer, openCustomer, sealCustomer } from "@/server/customers";
import { dayStart, resolveStatus } from "@/server/exports/orders";
import { buildXlsx, columnLetter, crc32, excelSerial } from "@/server/exports/xlsx";

const local0 = (buf: Buffer, central: number) => buf.readUInt32LE(central + 42);

/** Reads a zip's central directory back, checking each entry's CRC and sizes. */
function unzip(buf: Buffer): Record<string, string> {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const crc = buf.readUInt32LE(p + 16);
    const size = buf.readUInt32LE(p + 24);
    expect(buf.readUInt32LE(p + 20)).toBe(buf.readUInt32LE(local0(buf, p) + 18));
    const nameLen = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30);
    const comment = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    expect(buf.readUInt32LE(local)).toBe(0x04034b50);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = inflateRawSync(buf.subarray(start, start + buf.readUInt32LE(local + 18)));
    expect(data.length).toBe(size);
    expect(crc32(data)).toBe(crc);
    out[name] = data.toString("utf8");
    p += 46 + nameLen + extra + comment;
  }
  return out;
}

describe("Excel writer", () => {
  it("writes a valid workbook with escaped text, real numbers and dates", () => {
    const at = new Date("2026-09-30T13:30:00Z");
    const file = buildXlsx(
      [
        { name: "Orders", columns: [{ header: "Name", kind: "text" }, { header: "COD (DZD)", kind: "money" }, { header: "Order date", kind: "datetime" }], rows: [["أمينة <&> \"Test\"\u0001", 3900, at], ["=HYPERLINK(1)", null, null]] },
        { name: "Totals: by/status?", columns: [{ header: "Group", kind: "text" }, { header: "Orders", kind: "number" }], rows: [["Delivered", 2], ["Total", 2]], totalsRow: true },
      ],
      (d) => new Date(d.getTime() + 3_600_000),
    );
    const files = unzip(file);
    expect(Object.keys(files)).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"]);
    const sheet = files["xl/worksheets/sheet1.xml"];
    expect(sheet).toContain("أمينة &lt;&amp;&gt; &quot;Test&quot;</t>");
    // Text is always an inline string, so "=..." can never run as a formula.
    expect(sheet).toContain('t="inlineStr"');
    expect(sheet).not.toContain("<f>");
    expect(sheet).toContain("<v>3900</v>");
    // Dates are Excel serials in the workspace's wall-clock time (UTC+1 here).
    expect(sheet).toContain(`<v>${excelSerial(new Date("2026-09-30T14:30:00Z"))}</v>`);
    expect(sheet).toContain('<autoFilter ref="A1:C3"/>');
    expect(files["xl/workbook.xml"]).toContain('<sheet name="Totals  by status" sheetId="2"');
    // The totals row stays out of the filter.
    expect(files["xl/worksheets/sheet2.xml"]).toContain('<autoFilter ref="A1:B2"/>');
  });

  it("names columns like Excel", () => {
    expect([0, 25, 26, 27, 51, 52, 701, 702].map(columnLetter)).toEqual(["A", "Z", "AA", "AB", "AZ", "BA", "ZZ", "AAA"]);
  });
});

describe("CSV for Excel", () => {
  it("opens with accents and Arabic, and fits English or French Excel", () => {
    const rows = [["Nom", "Montant"], ["Amina Benali, أمينة", 3900.5], ["=cmd", -12], ["-12", "a;b"]];
    const comma = toDelimited(rows, ",");
    expect(comma.startsWith("﻿")).toBe(true);
    expect(comma).toBe('﻿Nom,Montant\r\n"Amina Benali, أمينة",3900.5\r\n\'=cmd,-12\r\n-12,a;b\r\n');
    expect(toDelimited(rows, ";")).toBe('﻿Nom;Montant\r\nAmina Benali, أمينة;3900,5\r\n\'=cmd;-12\r\n-12;"a;b"\r\n');
  });
});

describe("export file names and columns", () => {
  it("puts the date range in the name", () => {
    expect(exportFileName({ from: "2026-09-01", to: "2026-09-30", scope: "mdm", layout: "orders", format: "xlsx" }, "2026-09-30")).toBe("mdm-orders_2026-09-01_to_2026-09-30.xlsx");
    expect(exportFileName({ from: "2026-09-30", to: "2026-09-30", scope: "all", layout: "lines", format: "csv" }, "2026-09-30")).toBe("orders-by-product_2026-09-30.csv");
    expect(exportFileName({ scope: "mdm", layout: "orders", format: "csv" }, "2026-09-30")).toBe("mdm-orders_all-dates_2026-09-30.csv");
  });

  it("marks exactly the customer columns and keeps presets to known columns", () => {
    expect(EXPORT_COLUMNS.filter((c) => isCustomerColumn(c.key)).map((c) => c.key)).toEqual(["customerName", "phone", "phone2", "address"]);
    const keys = new Set<string>(EXPORT_COLUMNS.map((c) => c.key));
    for (const p of COLUMN_PRESETS) for (const c of p.columns) expect(keys.has(c)).toBe(true);
  });
});

describe("export status and dates", () => {
  const base = { status: "CONFIRMED" as const, placedAt: new Date("2026-09-20T09:00:00Z"), confirmedAt: new Date("2026-09-20T11:00:00Z"), canceledAt: null, mdmStatus: null, mdmStatusAt: null, parcels: [] };
  const parcel = (providerStatus: string, normalizedStatus: "SHIPPED" | "DELIVERED" | "RETURNED" | "UNKNOWN", at: string) => ({ providerStatus, normalizedStatus, lastProviderUpdateAt: new Date(at), updatedAt: new Date(at) });

  it("uses the newest of the parcel's and the order's MDM status", () => {
    const withParcel = { ...base, mdmStatus: "dispatched", mdmStatusAt: new Date("2026-09-21T08:00:00Z"), parcels: [parcel("dispatched", "SHIPPED", "2026-09-21T08:00:00Z"), parcel("delivered", "DELIVERED", "2026-09-23T08:00:00Z")] };
    expect(resolveStatus(withParcel, {})).toEqual({ key: "delivered", label: "Delivered", group: "delivered", at: new Date("2026-09-23T08:00:00Z") });
    // MDM cancelled the order after its parcel last moved.
    const cancelled = { ...withParcel, mdmStatus: "canceled_after_confirmation", mdmStatusAt: new Date("2026-09-24T08:00:00Z") };
    expect(resolveStatus(cancelled, {})).toMatchObject({ key: "canceled_after_confirmation", label: "Canceled after confirmation", group: "cancelled" });
    expect(resolveStatus({ ...base, status: "PENDING", mdmStatus: "notAnswered", mdmStatusAt: new Date("2026-09-20T10:00:00Z") }, {})).toMatchObject({ key: "not_answered", label: "Not answered", group: "not_confirmed" });
    // A workspace's own mapping of an unknown status is used.
    expect(resolveStatus({ ...base, parcels: [parcel("held_at_hub", "UNKNOWN", "2026-09-22T08:00:00Z")] }, { held_at_hub: "SHIPPED" })).toMatchObject({ group: "carrier", label: "Held at hub" });
  });

  it("falls back to the app's status for orders MDM never sent", () => {
    expect(resolveStatus({ ...base, status: "CANCELED", canceledAt: new Date("2026-09-21T00:00:00Z") }, {})).toEqual({ key: "cancelled", label: "Cancelled", group: "cancelled", at: new Date("2026-09-21T00:00:00Z") });
    expect(resolveStatus(base, {})).toMatchObject({ key: "confirmed", group: "confirmed", at: base.confirmedAt });
    expect(statusGroupOf("LOST")).toBe("other");
  });

  it("starts days at midnight in the workspace's time zone", () => {
    expect(dayStart("2026-09-30", "Africa/Algiers").toISOString()).toBe("2026-09-29T23:00:00.000Z");
    expect(dayStart("2026-09-30", "UTC").toISOString()).toBe("2026-09-30T00:00:00.000Z");
    expect(dayStart("2026-03-29", "Europe/Paris").toISOString()).toBe("2026-03-28T23:00:00.000Z");
  });
});

describe("customer details", () => {
  it("are sealed per workspace and masked for view-only roles", () => {
    const c = normalizeCustomer({ name: "  Amina   Placeholder ", phone: "0551111111", phone2: "", address: "12 rue X" })!;
    expect(c).toEqual({ name: "Amina Placeholder", phone: "0551111111", phone2: null, address: "12 rue X" });
    expect(normalizeCustomer({ name: " ", phone: null })).toBeNull();
    const sealed = sealCustomer(c, "ws-1");
    expect(sealed.customerEncrypted).not.toContain("Amina");
    expect(openCustomer(sealed.customerEncrypted, "ws-1")).toEqual(c);
    // Bound to its workspace: another workspace can't read it.
    expect(openCustomer(sealed.customerEncrypted, "ws-2")).toBeNull();
    const masked = maskCustomer(c)!;
    expect(masked.name).toBe("A•••• P••••");
    expect(masked.address).toBe("••••");
    expect(masked.phone).not.toContain("0551111");
  });
});
