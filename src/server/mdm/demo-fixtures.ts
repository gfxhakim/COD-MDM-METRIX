import { db } from "@/server/db";
import type { MockAccount } from "./mock";
import type { MdmArrival, MdmCapital, MdmFeeLine, MdmParcel, MdmPayoutBreakdown, MdmPayoutRecord, MdmStockCounts, MdmVariant, MdmWallet } from "./types";

/**
 * DEMO fixtures for the mocked adapter. Built from the workspace's own seeded demo
 * parcels (flagged isDemoFixture) so a sync visibly changes things:
 *  - some in-transit parcels get delivered, some move to an unmapped "held_at_hub" status;
 *  - a confirmed order that never shipped gets a new parcel (matched by order reference);
 *  - a pending order gets a parcel whose reference is unknown but whose store order ID matches;
 *  - a parcel with a reference no order has (goes to the unmatched review queue).
 * Deterministic: re-running a sync reports those parcels as unchanged.
 */
const HOUR = 3_600_000;

export async function demoFixtures(workspaceId: string): Promise<MdmParcel[]> {
  const parcels = await db.parcel.findMany({
    where: { workspaceId, isDemoFixture: true, provider: "MDM_EXPRESS" },
    orderBy: { trackingId: "asc" },
    include: { events: { where: { source: "DEMO_FIXTURE" }, orderBy: { occurredAt: "asc" } } },
  });
  const out: MdmParcel[] = [];
  const base = (p: (typeof parcels)[number]): MdmParcel => ({
    trackingId: p.trackingId,
    reference: p.providerReference,
    sourceOrderId: p.sourceOrderId,
    status: p.events.at(-1)?.providerStatus ?? p.providerStatus,
    statusAt: p.events.at(-1)?.occurredAt ?? p.lastProviderUpdateAt,
    codAmount: p.codAmount,
    currency: p.currency,
    shippingFee: p.shippingFee,
    returnFee: p.returnFee,
    wilaya: p.wilaya,
    dispatchedAt: p.dispatchedAt,
    deliveredAt: null,
    returnedAt: null,
    events: p.events.map((e) => ({ status: e.providerStatus, at: e.occurredAt })),
    raw: null,
  });

  for (const p of parcels) {
    if (p.trackingId.startsWith("MDM-DEMO-NEW") || p.trackingId.startsWith("MDM-DEMO-SRC") || p.trackingId.startsWith("MDM-DEMO-ORPHAN")) continue;
    const f = base(p);
    const seedLast = p.events.at(-1);
    const n = Number(p.trackingId.replace(/\D/g, "")) || 0;
    if (seedLast && ["dispatched", "in_transit", "out_for_delivery", "shipped"].includes(seedLast.providerStatus)) {
      const at = new Date(Math.min(seedLast.occurredAt.getTime() + 20 * HOUR, Date.now() - HOUR));
      const at2 = new Date(Math.floor(at.getTime() / HOUR) * HOUR);
      if (n % 3 === 0) {
        f.events.push({ status: "delivered", at: at2 });
        f.status = "delivered";
        f.statusAt = at2;
      } else if (n % 3 === 1) {
        f.events.push({ status: "held_at_hub", at: at2 });
        f.status = "held_at_hub";
        f.statusAt = at2;
      }
    }
    if (f.status === "delivered") f.deliveredAt = f.statusAt;
    if (f.status === "returned" || f.status === "return_received") f.returnedAt = f.statusAt;
    f.raw = { tracking: f.trackingId, reference: f.reference, status: f.status, cod: f.codAmount, wilaya: f.wilaya, demo: true };
    out.push(f);
  }

  const fixed = async (trackingId: string, pick: () => Promise<{ orderNumber: string; externalOrderId: string; placedAt: Date; codAmount: number; wilaya: string | null } | null>, shape: "reference" | "source") => {
    const existing = await db.parcel.findFirst({ where: { workspaceId, trackingId }, select: { providerReference: true, sourceOrderId: true, dispatchedAt: true, codAmount: true, wilaya: true } });
    let ref: string | null;
    let src: string | null;
    let at: Date;
    let cod: number;
    let wilaya: string | null;
    if (existing) {
      ({ providerReference: ref, sourceOrderId: src, codAmount: cod, wilaya } = existing);
      at = existing.dispatchedAt ?? new Date(Date.now() - 24 * HOUR);
    } else {
      const o = await pick();
      if (!o) return;
      ref = shape === "reference" ? o.orderNumber : `WEB-${o.externalOrderId.toUpperCase()}`;
      src = shape === "source" ? o.externalOrderId : null;
      at = new Date(Math.floor((Math.min(o.placedAt.getTime() + 24 * HOUR, Date.now() - 2 * HOUR)) / HOUR) * HOUR);
      cod = o.codAmount;
      wilaya = o.wilaya;
    }
    const status = shape === "reference" ? "dispatched" : "in_transit";
    out.push({ trackingId, reference: ref, sourceOrderId: src, status, statusAt: at, codAmount: cod, currency: "DZD", shippingFee: 60000, returnFee: 25000, wilaya, dispatchedAt: at, deliveredAt: null, returnedAt: null, events: [{ status, at }], raw: { tracking: trackingId, reference: ref, source_order_id: src, status, demo: true, recipient_phone: "0550000000" } });
  };

  const sel = { orderNumber: true, externalOrderId: true, placedAt: true, codAmount: true, wilaya: true } as const;
  await fixed("MDM-DEMO-NEW-1", () => db.order.findFirst({ where: { workspaceId, status: "CONFIRMED", parcels: { none: {} } }, orderBy: { orderNumber: "asc" }, select: sel }), "reference");
  await fixed("MDM-DEMO-SRC-1", () => db.order.findFirst({ where: { workspaceId, status: "PENDING", parcels: { none: {} } }, orderBy: { orderNumber: "asc" }, select: sel }), "source");
  const orphanExisting = await db.parcel.findFirst({ where: { workspaceId, trackingId: "MDM-DEMO-ORPHAN-1" }, select: { dispatchedAt: true } });
  const orphanAt = orphanExisting?.dispatchedAt ?? new Date(Math.floor((Date.now() - 30 * HOUR) / (24 * HOUR)) * 24 * HOUR);
  out.push({ trackingId: "MDM-DEMO-ORPHAN-1", reference: "SHOP-77123", sourceOrderId: null, status: "in_transit", statusAt: orphanAt, codAmount: 490000, currency: "DZD", shippingFee: 70000, returnFee: 30000, wilaya: "Sétif", dispatchedAt: orphanAt, deliveredAt: null, returnedAt: null, events: [{ status: "in_transit", at: orphanAt }], raw: { tracking: "MDM-DEMO-ORPHAN-1", reference: "SHOP-77123", status: "in_transit", demo: true } });
  return out;
}

const DAY = 24 * HOUR;
const SELLER = "DEMO-SELLER";

/**
 * DEMO money and stock for the mocked adapter, built from the workspace's own demo parcels so
 * the Money & stock page adds up: money collected and fees per delivered or returned parcel,
 * older lines paid out, newer ones ready or on hold, and a small stock of the first product.
 */
export async function demoAccount(workspaceId: string): Promise<MockAccount> {
  const parcels = await db.parcel.findMany({
    where: { workspaceId, isDemoFixture: true, normalizedStatus: { in: ["DELIVERED", "RETURNED"] } },
    orderBy: { trackingId: "asc" },
    select: { trackingId: true, mdmOrderId: true, normalizedStatus: true, codAmount: true, shippingFee: true, returnFee: true, deliveredAt: true, returnedAt: true, lastProviderUpdateAt: true, createdAt: true },
  });
  const product = await db.product.findFirst({ where: { workspaceId }, orderBy: { createdAt: "asc" }, select: { name: true } });
  const now = Date.now();
  const fees: MdmFeeLine[] = [];
  const line = (p: (typeof parcels)[number], n: number, type: string, amount: number, at: Date): MdmFeeLine => ({
    id: `DEMO-LINE-${p.trackingId}-${n}`, sellerId: SELLER, entityId: p.trackingId, type, subType: null, amount, grossAmount: amount, taxes: 0, currency: "DZD", status: "pending",
    payoutId: null, parcelTrackingId: p.trackingId, orderTrackingId: p.mdmOrderId, createdAt: at, updatedAt: at,
  });
  for (const p of parcels) {
    const at = p.deliveredAt ?? p.returnedAt ?? p.lastProviderUpdateAt ?? p.createdAt;
    if (p.normalizedStatus === "DELIVERED") {
      fees.push(line(p, 1, "COD", p.codAmount, at), line(p, 2, "DELIVERY_FEE", -(p.shippingFee ?? 60000), at), line(p, 3, "CALL_CENTER_FEE", -10000, at));
    } else {
      fees.push(line(p, 1, "DELIVERY_FEE", -(p.shippingFee ?? 60000), at), line(p, 2, "RETURN_FEE", -(p.returnFee ?? 25000), at));
    }
  }
  // Lines more than ten days old were paid in one payout; the rest wait.
  const payoutAt = new Date(Math.floor((now - 3 * DAY) / DAY) * DAY);
  const sum = (list: MdmFeeLine[]) => list.reduce((a, l) => a + l.amount, 0);
  const paidLines = fees.filter((l) => now - l.createdAt.getTime() > 10 * DAY);
  for (const l of paidLines) Object.assign(l, { payoutId: "DEMO-PAYOUT-1", status: "paid", updatedAt: payoutAt });
  const waiting = fees.filter((l) => !l.payoutId);
  const ready = waiting.filter((l) => now - l.createdAt.getTime() > 4 * DAY);
  for (const l of ready) l.status = "ready";
  const byType = (list: MdmFeeLine[]) => {
    const m = new Map<string, { type: string; count: number; total: number; grossTotal: number }>();
    for (const l of list) {
      const t = m.get(l.type) ?? { type: l.type, count: 0, total: 0, grossTotal: 0 };
      t.count++;
      t.total += l.amount;
      t.grossTotal += l.amount;
      m.set(l.type, t);
    }
    return [...m.values()];
  };
  const payouts: MdmPayoutRecord[] = [{ id: "DEMO-PAYOUT-1", amount: sum(paidLines), currency: "DZD", status: "confirmed", confirmed: true, sellerId: SELLER, storeNames: ["Demo store"], createdAt: new Date(payoutAt.getTime() - DAY), updatedAt: payoutAt }];
  if (ready.length) payouts.push({ id: "DEMO-PAYOUT-2", amount: sum(ready), currency: "DZD", status: "pending", confirmed: false, sellerId: SELLER, storeNames: ["Demo store"], createdAt: new Date(Math.floor(now / DAY) * DAY - HOUR), updatedAt: new Date(Math.floor(now / DAY) * DAY - HOUR) });
  const breakdowns: Record<string, MdmPayoutBreakdown> = { "DEMO-PAYOUT-1": { currency: "DZD", items: byType(paidLines), taxes: [] } };
  if (ready.length) breakdowns["DEMO-PAYOUT-2"] = { currency: "DZD", items: byType(ready), taxes: [] };
  const cod = (list: MdmFeeLine[]) => list.filter((l) => l.type === "COD").reduce((a, l) => a + l.amount, 0);
  const wallet: MdmWallet = {
    currency: "DZD",
    onHold: sum(waiting) - sum(ready),
    ready: sum(ready),
    paid: sum(paidLines),
    details: { gross: { onHold: cod(waiting) - cod(ready), ready: cod(ready), paid: cod(paidLines) }, taxes: { onHold: 0, ready: 0, paid: 0 } },
  };
  const name = product?.name ?? "Demo product";
  const unit = 120000;
  const variants: MdmVariant[] = [
    { id: "DEMO-VARIANT-1", productId: "DEMO-PRODUCT-1", productName: name, variantName: "Black", sku: "DEMO-BLK", sellingPrice: 290000, purchasePrice: unit, currency: "DZD", archived: false },
    { id: "DEMO-VARIANT-2", productId: "DEMO-PRODUCT-1", productName: name, variantName: "White", sku: "DEMO-WHT", sellingPrice: 290000, purchasePrice: unit, currency: "DZD", archived: false },
  ];
  const stock: Record<string, MdmStockCounts> = {
    "DEMO-VARIANT-1": { totalInbound: 300, incoming: 100, available: 142, processing: 6, inDelivery: 21, delivered: 109, returning: 4, returned: 13, damaged: 2, discharged: 0, lost: 3 },
    "DEMO-VARIANT-2": { totalInbound: 150, incoming: 0, available: 71, processing: 3, inDelivery: 9, delivered: 58, returning: 2, returned: 6, damaged: 1, discharged: 0, lost: 0 },
  };
  const units = (k: keyof MdmStockCounts) => stock["DEMO-VARIANT-1"][k] + stock["DEMO-VARIANT-2"][k];
  const bucket = (k: keyof MdmStockCounts) => ({ units: units(k), value: units(k) * unit });
  const capital: MdmCapital = { currency: "DZD", buckets: { totalInbound: bucket("totalInbound"), available: bucket("available"), processing: bucket("processing"), inDelivery: bucket("inDelivery"), returning: bucket("returning"), lost: bucket("lost") } };
  const arrival = (id: string, daysAgo: number, status: string, expected: [number, number], received: number, damaged: number): MdmArrival => {
    const at = new Date(Math.floor((now - daysAgo * DAY) / DAY) * DAY + 9 * HOUR);
    return { id, status, operation: "inbound", products: [{ name: `${name} Black`, sku: "DEMO-BLK", expected: expected[0] }, { name: `${name} White`, sku: "DEMO-WHT", expected: expected[1] }].filter((p) => p.expected > 0), expectedUnits: expected[0] + expected[1], receivedUnits: received, damagedUnits: damaged, createdAt: at, updatedAt: at };
  };
  return {
    profileId: SELLER,
    wallet,
    payouts,
    breakdowns,
    fees,
    prices: {
      currency: "DZD",
      callCenter: { type: "standard", perLead: 0, perConfirmed: 10000, perDelivered: 0, upsellExtra: 5000 },
      fulfilment: { type: "standard", perDispatched: 5000, perDelivered: 0, maxItems: 3, extraPerItem: 2000 },
      delivery: [
        { wilaya: "Alger", code: "16", home: 40000, stopDesk: 25000, return: 20000, exchange: 40000 },
        { wilaya: "Oran", code: "31", home: 60000, stopDesk: 40000, return: 25000, exchange: 60000 },
        { wilaya: "Sétif", code: "19", home: 60000, stopDesk: 40000, return: 25000, exchange: 60000 },
      ],
      usdRate: null,
      euroRate: null,
    },
    variants,
    stock,
    capital,
    arrivals: [arrival("DEMO-ARRIVAL-1", 40, "completed", [200, 150], 348, 2), arrival("DEMO-ARRIVAL-2", 6, "completed", [100, 0], 100, 1), arrival("DEMO-ARRIVAL-3", 1, "pending", [100, 0], 0, 0)],
  };
}
