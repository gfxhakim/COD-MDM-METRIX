import { db } from "@/server/db";
import type { MdmParcel } from "./types";

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
