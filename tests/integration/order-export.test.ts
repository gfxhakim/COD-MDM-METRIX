import { inflateRawSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createMockAdapter } from "@/server/mdm/mock";
import { runSyncJob, startSync } from "@/server/mdm/sync";
import type { MdmOrder, MdmParcel } from "@/server/mdm/types";
import { addMember, cost, makeTenant } from "../helpers";

type Tenant = Awaited<ReturnType<typeof makeTenant>>;
const SECRET = "mdm_live_SUPERSECRET_9876";

// Placeholder people and numbers only.
const order = (trackingId: string, over: Partial<MdmOrder> = {}): MdmOrder => ({
  trackingId, externalId: null, status: "pending", statusAt: new Date("2026-09-20T10:00:00Z"), confirmed: false, placedAt: new Date("2026-09-20T09:00:00Z"),
  total: 390000, currency: "DZD", phone: "0550000001", wilaya: "Alger", city: "Bab Ezzouar",
  utm: { source: "facebook", medium: "paid", campaign: "Spring", content: "120000000000009" },
  products: [{ ref: "LMP", variantOf: null, name: "Lamp", quantity: 1, unitPrice: 390000 }],
  customer: { name: "Test Customer", phone2: null, address: "1 Placeholder street" }, deliveryType: "HOME", storeName: "Test store", ...over,
});
const parcel = (trackingId: string, mdmOrderId: string, status: string, at: string): MdmParcel => ({
  trackingId, mdmOrderId, reference: null, sourceOrderId: null, status, statusAt: new Date(at), codAmount: 390000, currency: "DZD",
  shippingFee: 60000, returnFee: 25000, wilaya: "Alger", dispatchedAt: new Date("2026-09-21T10:00:00Z"), deliveredAt: status === "delivered" ? new Date(at) : null, returnedAt: null,
  events: [{ status, at: new Date(at) }], raw: { tracking: trackingId, status },
});

let t: Tenant;
let orders: MdmOrder[];

async function sync(mode: "FULL" | "INCREMENTAL") {
  const fixtures = [parcel("P-3", "ORD-3", "delivered", "2026-09-25T10:00:00Z")];
  const { job } = await startSync(t.ctx, { mode });
  return runSyncJob(job.id, { adapterFactory: async () => ({ adapter: createMockAdapter({ fixtures, credential: SECRET, orders }), connection: null }), sleep: async () => {}, pageSize: 10 });
}

function unzip(buf: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  for (let p = 0; buf.readUInt32LE(p) === 0x04034b50; ) {
    const size = buf.readUInt32LE(p + 18);
    const nameLen = buf.readUInt16LE(p + 26);
    const start = p + 30 + nameLen + buf.readUInt16LE(p + 28);
    out[buf.subarray(p + 30, p + 30 + nameLen).toString("utf8")] = inflateRawSync(buf.subarray(start, start + size)).toString("utf8");
    p = start + size;
  }
  return out;
}

const text = (r: { kind: string } & Record<string, unknown>) => Buffer.from(String(r.base64), "base64").toString("utf8");
const september = { from: "2026-09-01", to: "2026-09-30", dateField: "placed" as const, scope: "mdm" as const };
const opts = { ...september, format: "csv" as const, csvDelimiter: "," as const, layout: "orders" as const, totals: false };

beforeAll(async () => {
  t = await makeTenant("Export");
  await t.caller.products.create({ name: "Lamp", sku: "LMP", cost });
  await t.caller.integrations.saveMdmCredential({ credential: SECRET });
  await db.integrationConnection.updateMany({ where: { workspaceId: t.ws.id }, data: { status: "CONNECTED" } });
  orders = [
    order("ORD-1", { status: "not_answered", statusAt: new Date("2026-09-20T12:00:00Z") }),
    order("ORD-2", { status: "packaged", confirmed: true, customer: { name: "Second Person", phone2: "0660000002", address: null }, deliveryType: "STOP_DESK" }),
    order("ORD-3", { status: "dispatched", confirmed: true, products: [{ ref: "LMP", variantOf: null, name: "Lamp", quantity: 2, unitPrice: 190000 }, { ref: "X", variantOf: null, name: "Cable", quantity: 1, unitPrice: 10000 }] }),
    order("ORD-4", { status: "cancelled", placedAt: new Date("2026-08-15T09:00:00Z"), statusAt: new Date("2026-08-15T12:00:00Z") }),
  ];
  await sync("FULL");
  // An order that never came from MDM.
  const product = await db.product.findFirstOrThrow({ where: { workspaceId: t.ws.id } });
  await t.caller.orders.create({ orderNumber: "MAN-1", placedAt: new Date("2026-09-22T10:00:00Z"), status: "CONFIRMED", codAmount: 390000, lines: [{ productId: product.id, quantity: 1, unitPrice: 390000 }] });
});

describe("order export", () => {
  it("counts the MDM orders by status group and exact MDM status", async () => {
    const p = await t.caller.orders.exportPreview(september);
    expect(p).toMatchObject({ total: 3, lines: 4, tooMany: false });
    const byGroup = Object.fromEntries(p.groups.map((g) => [g.key, g.statuses.map((s) => `${s.label}:${s.count}`)]));
    expect(byGroup).toMatchObject({ not_confirmed: ["Not answered:1"], confirmed: ["Packaged:1"], delivered: ["Delivered:1"], cancelled: [], carrier: [] });
    expect((await t.caller.orders.exportPreview({ ...september, scope: "all" })).total).toBe(4);
    expect((await t.caller.orders.exportPreview({ ...september, from: undefined, to: undefined })).total).toBe(4);
  });

  it("exports an Excel file with the customer's details for the owner", async () => {
    const r = await t.caller.orders.export({ ...opts, format: "xlsx", totals: true, columns: ["orderNumber", "customerName", "phone", "phone2", "address", "deliveryType", "store", "status", "codAmount"] });
    expect(r).toMatchObject({ kind: "file", filename: "mdm-orders_2026-09-01_to_2026-09-30.xlsx", orders: 3, rows: 3 });
    if (r.kind !== "file") throw new Error("expected a file");
    const files = unzip(Buffer.from(r.base64, "base64"));
    const sheet = files["xl/worksheets/sheet1.xml"];
    for (const v of ["Customer name", "Test Customer", "0550000001", "Second Person", "0660000002", "1 Placeholder street", "Stop desk", "Test store", "Not answered", "COD amount (DZD)"]) expect(sheet).toContain(v);
    expect(sheet).toContain("<v>3900</v>");
    expect(files["xl/workbook.xml"]).toContain('name="Totals by status"');
    expect(files["xl/worksheets/sheet2.xml"]).toContain("Total");
  });

  it("filters by exact status, by the status date, and writes CSV for French Excel", async () => {
    const delivered = await t.caller.orders.export({ ...opts, csvDelimiter: ";", statuses: ["delivered"], columns: ["orderNumber", "status", "statusGroup", "trackingId", "deliveredAt", "codAmount"] });
    const csv = text(delivered);
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(2);
    expect(csv).toContain("P-3");
    expect(csv).toMatch(/Delivered;Delivered;P-3;2026-09-25 11:00;3900/);
    // Order date in September, but only one status changed after the 24th.
    const late = await t.caller.orders.export({ ...opts, from: "2026-09-24", to: "2026-09-30", dateField: "status", columns: ["orderNumber"] });
    expect(late).toMatchObject({ orders: 1 });
    expect((await t.caller.orders.exportPreview({ ...september, from: "2026-09-24", dateField: "placed" })).total).toBe(0);
  });

  it("writes one row per product line with the order's amounts once", async () => {
    const r = await t.caller.orders.export({ ...opts, layout: "lines", statuses: ["delivered"], columns: ["orderNumber", "products", "quantity", "unitPrice", "codAmount"] });
    expect(r).toMatchObject({ filename: "mdm-orders-by-product_2026-09-01_to_2026-09-30.csv", orders: 1, rows: 2 });
    const lines = text(r).split("\r\n");
    expect(lines[1]).toBe("ORD-3,Cable,1,100,3900");
    // The next line has its own price and no order amounts, so column sums stay right.
    expect(lines[2]).toBe("ORD-3,Lamp,2,1900,");
  });

  it("converts amounts with the Settings rates, and says when a rate is missing", async () => {
    await expect(t.caller.orders.export({ ...opts, currency: "USD", columns: ["codAmount"] })).rejects.toThrow(/USD rate/);
    await t.caller.workspace.updateSettings({ exchangeRates: { USD: 250 } });
    const r = await t.caller.orders.export({ ...opts, currency: "USD", statuses: ["delivered"], columns: ["codAmount"] });
    expect(text(r)).toBe("﻿COD amount (USD)\r\n15.6\r\n");
  });

  it("makes a printable page with totals", async () => {
    const r = await t.caller.orders.export({ ...opts, format: "print", totals: true, columns: ["orderNumber", "customerName", "codAmount", "placedAt"] });
    if (r.kind !== "print") throw new Error("expected print");
    expect(r.headers).toEqual(["Order number", "Customer name", "COD amount (DZD)", "Order date"]);
    expect(r.rows).toContainEqual(["ORD-2", "Second Person", "3,900", expect.stringContaining("20 Sept 2026")]);
    expect(r.totals?.rows.at(-1)).toEqual(["Total", "", "3", "5", "11,700"]);
  });

  it("leaves customer details out for view-only accounts and keeps them masked in the app", async () => {
    const analyst = await addMember(t.ws.id, "ANALYST");
    const r = await analyst.caller.orders.export({ ...opts, columns: ["orderNumber", "customerName", "phone", "address", "status"] });
    const csv = text(r);
    expect(csv.split("\r\n")[0]).toBe("﻿Order number,MDM status");
    expect(csv).not.toMatch(/Test Customer|0550000001|Placeholder street/);
    await expect(analyst.caller.orders.export({ ...opts, columns: ["customerName"] })).rejects.toThrow(/at least one column/);
    const list = await analyst.caller.orders.list({ search: "ORD-2", page: 1, pageSize: 25 });
    expect(list.items[0].customer).toMatchObject({ name: "S•••• P••••", address: null });
    expect(list.items[0].customer?.phone).not.toContain("0550000");
    // Operators see them in full.
    const operator = await addMember(t.ws.id, "OPERATOR");
    expect((await operator.caller.orders.list({ search: "ORD-2", page: 1, pageSize: 25 })).items[0].customer?.name).toBe("Second Person");
  });

  it("finds orders by phone and records exports without customer details in the audit log", async () => {
    expect((await t.caller.orders.list({ search: "0550000001", page: 1, pageSize: 25 })).total).toBe(4);
    const logs = await db.auditLog.findMany({ where: { workspaceId: t.ws.id, action: "report.exported" } });
    expect(logs.length).toBeGreaterThan(0);
    expect(JSON.stringify(logs)).not.toMatch(/Test Customer|0550000001|Second Person/);
  });

  it("fills in customer details for orders synced before they were kept", async () => {
    expect((await t.caller.integrations.mdm()).ordersFullReadPending).toBe(false);
    // An order as an older version stored it, then what the migration does to the connection.
    const before = await db.order.findFirstOrThrow({ where: { workspaceId: t.ws.id, mdmOrderId: "ORD-2" } });
    await db.order.update({ where: { id: before.id }, data: { customerEncrypted: null, customerKeyVersion: null, mdmStatus: null, mdmStatusAt: null, deliveryType: null, storeName: null } });
    await db.integrationConnection.updateMany({ where: { workspaceId: t.ws.id }, data: { ordersSyncedAt: null } });
    expect((await t.caller.integrations.mdm()).ordersFullReadPending).toBe(true);
    // Even an incremental sync then reads every order once.
    expect(await sync("INCREMENTAL")).toMatchObject({ status: "SUCCEEDED", ordersUpdatedCount: 1 });
    expect(await t.caller.orders.getDetails({ id: before.id })).toMatchObject({ mdmStatus: "packaged", deliveryType: "STOP_DESK", storeName: "Test store", customer: { name: "Second Person", phone: "0550000001" } });
    expect((await t.caller.integrations.mdm()).ordersFullReadPending).toBe(false);
  });

  it("never exports another workspace's orders", async () => {
    const other = await makeTenant("ExportOther");
    expect((await other.caller.orders.exportPreview({ ...september, scope: "all" })).total).toBe(0);
    const r = await other.caller.orders.export({ ...opts, scope: "all", columns: ["orderNumber"] });
    expect(r).toMatchObject({ orders: 0 });
  });
});
