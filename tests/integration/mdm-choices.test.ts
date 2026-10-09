import { describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]) }));

import { db } from "@/server/db";
import { createMockAdapter } from "@/server/mdm/mock";
import { runSyncJob, startSync } from "@/server/mdm/sync";
import type { MdmOrder, MdmParcel } from "@/server/mdm/types";
import { addMember, cost, makeTenant } from "../helpers";

type Tenant = Awaited<ReturnType<typeof makeTenant>>;
const SECRET = "mdm_live_CHOICES_4242";
const noSleep = async () => {};
const AT = new Date("2026-09-20T10:00:00Z");

const line = (ref: string, name: string) => ({ ref, variantOf: null, name, quantity: 1, unitPrice: 390000 });
const LAMP = line("LMP", "Lamp");
const FAN = line("PRD-FAN", "Fan");
const order = (trackingId: string, products: MdmOrder["products"], over: Partial<MdmOrder> = {}): MdmOrder => ({
  trackingId, externalId: null, status: "packaged", statusAt: AT, confirmed: true, placedAt: new Date("2026-09-20T09:00:00Z"),
  total: 390000, currency: "DZD", phone: "0551234567", wilaya: "Alger", city: null,
  utm: { source: "facebook", medium: "paid", campaign: "Spring", content: null }, products, ...over,
});
const parcel = (trackingId: string, mdmOrderId: string, status = "in_transit"): MdmParcel => ({
  trackingId, reference: null, sourceOrderId: null, mdmOrderId, status, statusAt: AT, codAmount: 390000, currency: "DZD",
  shippingFee: 60000, returnFee: 25000, wilaya: "Alger", dispatchedAt: AT, deliveredAt: null, returnedAt: null, events: [], raw: { tracking: trackingId },
});

async function setup(name: string) {
  const d = await makeTenant(name);
  await d.caller.products.create({ name: "Lamp", sku: "LMP", cost });
  await d.caller.integrations.saveMdmCredential({ credential: SECRET });
  await db.integrationConnection.updateMany({ where: { workspaceId: d.ws.id }, data: { status: "CONNECTED" } });
  return d;
}

async function sync(d: Tenant, orders: MdmOrder[], fixtures: MdmParcel[], mode: "FULL" | "INCREMENTAL" = "FULL") {
  const adapter = createMockAdapter({ fixtures, orders, credential: SECRET });
  const { job } = await startSync(d.ctx, { mode });
  return (await runSyncJob(job.id, { adapterFactory: async () => ({ adapter, connection: null }), sleep: noSleep, pageSize: 10 }))!;
}

const inApp = async (d: Tenant) => (await db.order.findMany({ where: { workspaceId: d.ws.id }, select: { mdmOrderId: true } })).map((o) => o.mdmOrderId).sort();
const parcelsIn = async (d: Tenant) => (await db.parcel.findMany({ where: { workspaceId: d.ws.id }, select: { trackingId: true } })).map((p) => p.trackingId).sort();
const product = async (d: Tenant, id: string) => (await d.caller.sync.mdmProducts()).products.find((p) => p.id === id)!;

describe("choosing what to bring from MDM", () => {
  it("brings in only the MDM products picked, from their first day, and skips their parcels", async () => {
    const d = await setup("ChoicesA");
    await sync(d, [order("O1", [LAMP]), order("O2", [FAN])], [parcel("P1", "O1"), parcel("P2", "O2")]);
    expect(await inApp(d)).toEqual(["O1", "O2"]);
    expect(await product(d, "PRD-FAN")).toMatchObject({ name: "Fan", bring: true, sinceDay: null, orders: 1 });

    // The fan is turned off: its new orders and their parcels stay out, the one already here keeps updating.
    expect(await d.caller.sync.setMdmProduct({ mdmProductId: "PRD-FAN", bring: false, sinceDay: null })).toEqual({ widened: false });
    let job = await sync(d, [order("O1", [LAMP]), order("O2", [FAN], { status: "delivered" }), order("O3", [FAN])], [parcel("P1", "O1"), parcel("P2", "O2", "delivered"), parcel("P3", "O3")]);
    expect(job).toMatchObject({ status: "SUCCEEDED", skippedCount: 1 });
    expect(await inApp(d)).toEqual(["O1", "O2"]);
    expect(await parcelsIn(d)).toEqual(["P1", "P2"]);
    expect((await db.order.findFirstOrThrow({ where: { workspaceId: d.ws.id, mdmOrderId: "O2" } })).mdmStatus).toBe("delivered");
    expect(await product(d, "PRD-FAN")).toMatchObject({ bring: false, notBrought: 1 });

    // Removing what's already here takes the order and its parcel out, and later syncs leave them out.
    expect(await d.caller.sync.removeNotBrought({ mdmProductId: "PRD-FAN" })).toEqual({ orders: 1, parcels: 1 });
    await sync(d, [order("O1", [LAMP]), order("O2", [FAN])], [parcel("P1", "O1"), parcel("P2", "O2")]);
    expect(await inApp(d)).toEqual(["O1"]);
    expect(await parcelsIn(d)).toEqual(["P1"]);

    // The lamp from 21 September: older new orders stay out, newer ones and mixed orders come in.
    await d.caller.sync.setMdmProduct({ mdmProductId: "LMP", bring: true, sinceDay: "2026-09-21" });
    expect(await product(d, "LMP")).toMatchObject({ bring: true, sinceDay: "2026-09-21", notBrought: 1 });
    const later = { placedAt: new Date("2026-09-22T09:00:00Z") };
    await sync(d, [order("O1", [LAMP]), order("O4", [LAMP], { placedAt: new Date("2026-09-19T09:00:00Z") }), order("O5", [LAMP], later), order("O6", [FAN, LAMP], later)], []);
    expect(await inApp(d)).toEqual(["O1", "O5", "O6"]);

    // Turning the fan back on: the next sync reads every MDM order once and brings its orders back.
    expect(await d.caller.sync.setMdmProduct({ mdmProductId: "PRD-FAN", bring: true, sinceDay: null })).toEqual({ widened: true });
    expect((await d.caller.sync.mdmProducts()).rereadPending).toBe(true);
    job = await sync(d, [order("O2", [FAN]), order("O3", [FAN])], [parcel("P2", "O2"), parcel("P3", "O3")], "INCREMENTAL");
    expect(job).toMatchObject({ mode: "FULL", updatedSince: null });
    expect(await inApp(d)).toEqual(["O1", "O2", "O3", "O5", "O6"]);
    expect(await parcelsIn(d)).toEqual(["P1", "P2", "P3"]);
    expect(await db.mdmSkippedOrder.count({ where: { workspaceId: d.ws.id, mdmOrderId: { in: ["O2", "O3"] } } })).toBe(0);
    expect((await d.caller.sync.mdmProducts()).rereadPending).toBe(false);
    expect((await sync(d, [], [], "INCREMENTAL")).mode).toBe("INCREMENTAL");
  });

  it("can keep new MDM products out until someone picks them", async () => {
    const d = await setup("ChoicesB");
    await d.caller.sync.setBringNewMdmProducts({ bring: false });
    await sync(d, [order("N1", [line("PRD-NEW", "Heater")])], [parcel("NP1", "N1")]);
    expect(await inApp(d)).toEqual([]);
    expect(await parcelsIn(d)).toEqual([]);
    expect((await d.caller.sync.mdmProducts()).products).toEqual([expect.objectContaining({ id: "PRD-NEW", name: "Heater", bring: false })]);
    // No product was made for it.
    expect((await d.caller.products.list({ includeInactive: true })).map((p) => p.name)).toEqual(["Lamp"]);

    await d.caller.sync.setMdmProduct({ mdmProductId: "PRD-NEW", bring: true, sinceDay: null });
    await sync(d, [order("N1", [line("PRD-NEW", "Heater")])], [parcel("NP1", "N1")]);
    expect(await inApp(d)).toEqual(["N1"]);
    expect(await parcelsIn(d)).toEqual(["NP1"]);
  });

  it("lets only owners and admins change the choices", async () => {
    const d = await setup("ChoicesC");
    const analyst = await addMember(d.ws.id, "ANALYST");
    const operator = await addMember(d.ws.id, "OPERATOR");
    expect((await analyst.caller.sync.mdmProducts()).bringNew).toBe(true);
    for (const who of [analyst, operator]) {
      await expect(who.caller.sync.setMdmProduct({ mdmProductId: "LMP", bring: false, sinceDay: null })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(who.caller.sync.setBringNewMdmProducts({ bring: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(who.caller.sync.removeNotBrought({ mdmProductId: "LMP" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    const other = await setup("ChoicesD");
    await other.caller.sync.setMdmProduct({ mdmProductId: "LMP", bring: false, sinceDay: null });
    expect(await db.mdmProductChoice.count({ where: { workspaceId: d.ws.id } })).toBe(0);
  });
});
