import type { NormalizedStatus, Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { CONFIRMING_STATES, DEFAULT_MDM_STATUS_MAP, normalizeProviderStatus, SHIPPED_STATES, statusKey } from "@/domain/statusMapping";

const PROVIDER = "MDM_EXPRESS" as const;

type ParcelStatusFields = {
  id: string;
  orderId: string | null;
  lastProviderUpdateAt: Date | null;
  dispatchedAt: Date | null;
  deliveredAt: Date | null;
  returnedAt: Date | null;
};

export const parcelStatusSelect = { id: true, orderId: true, providerStatus: true, lastProviderUpdateAt: true, dispatchedAt: true, deliveredAt: true, returnedAt: true } as const;

/** Give a stored parcel a new normalized status, with the same side effects a sync applies. */
export async function setParcelStatus(tx: Prisma.TransactionClient, workspaceId: string, p: ParcelStatusFields, s: NormalizedStatus) {
  const shipped = SHIPPED_STATES.includes(s);
  const dispatchedAt = p.dispatchedAt ?? (shipped ? p.lastProviderUpdateAt : null);
  await tx.parcel.update({
    where: { id: p.id },
    data: {
      normalizedStatus: s,
      dispatchedAt,
      deliveredAt: s === "DELIVERED" ? p.deliveredAt ?? p.lastProviderUpdateAt : null,
      returnedAt: s === "RETURNED" ? p.returnedAt ?? p.lastProviderUpdateAt : null,
    },
  });
  if (p.orderId) await reconcileOrderStatuses(tx, workspaceId, [p.orderId]);
}

/**
 * Keep store orders in line with their MDM parcels:
 * - a parcel being prepared or with the carrier confirms a pending order;
 * - an order whose parcels are all canceled is canceled and no longer counts as
 *   confirmed, even if it was confirmed before (the client canceled after confirming).
 * Without `orderIds`, checks every order in the workspace that has a parcel.
 */
export async function reconcileOrderStatuses(tx: Prisma.TransactionClient, workspaceId: string, orderIds?: string[]) {
  const orders = await tx.order.findMany({
    where: { workspaceId, status: { not: "CANCELED" }, ...(orderIds ? { id: { in: orderIds } } : { parcels: { some: {} } }) },
    select: { id: true, status: true, parcels: { select: { normalizedStatus: true, dispatchedAt: true, lastProviderUpdateAt: true } } },
  });
  let confirmed = 0;
  let canceled = 0;
  for (const o of orders) {
    if (!o.parcels.length) continue;
    if (o.parcels.every((p) => p.normalizedStatus === "CANCELED")) {
      const at = o.parcels.map((p) => p.lastProviderUpdateAt).find(Boolean) ?? new Date();
      await tx.order.update({ where: { id: o.id }, data: { status: "CANCELED", confirmedAt: null, canceledAt: at } });
      canceled++;
    } else if (o.status === "PENDING" && o.parcels.some((p) => CONFIRMING_STATES.includes(p.normalizedStatus))) {
      const dispatched = o.parcels.map((p) => p.dispatchedAt).filter((d): d is Date => d !== null).sort((a, b) => a.getTime() - b.getTime())[0];
      await tx.order.update({ where: { id: o.id }, data: { status: "CONFIRMED", confirmedAt: dispatched ?? new Date() } });
      confirmed++;
    }
  }
  return { confirmed, canceled };
}

export async function workspaceStatusOverrides(workspaceId: string, tx: Prisma.TransactionClient = db) {
  const rows = await tx.statusMapping.findMany({ where: { workspaceId, provider: PROVIDER } });
  return Object.fromEntries(rows.map((m) => [statusKey(m.providerStatus), m.normalizedStatus])) as Record<string, NormalizedStatus>;
}

/**
 * Bring a workspace up to date with the built-in status defaults:
 * - adds a Settings row for each default it doesn't have yet (its own rows are never changed),
 * - re-sorts parcels and history events still marked UNKNOWN whose MDM status now has a mapping.
 * Runs at the start of every sync and once when the server starts, so a new default
 * applies to parcels that MDM will never send again.
 */
export async function applyStatusDefaults(workspaceId: string) {
  return db.$transaction(async (tx) => {
    const have = await workspaceStatusOverrides(workspaceId, tx);
    const missing = Object.entries(DEFAULT_MDM_STATUS_MAP).filter(([k]) => !(k in have));
    for (const [providerStatus, normalizedStatus] of missing) {
      await tx.statusMapping.create({ data: { workspaceId, provider: PROVIDER, providerStatus, normalizedStatus } });
    }
    const overrides = { ...have, ...Object.fromEntries(missing) } as Record<string, NormalizedStatus>;

    const unknown = await tx.parcel.findMany({ where: { workspaceId, provider: PROVIDER, normalizedStatus: "UNKNOWN", providerStatus: { not: null } }, select: parcelStatusSelect });
    const moved: Record<string, number> = {};
    for (const p of unknown) {
      const s = normalizeProviderStatus(p.providerStatus, overrides);
      if (s === "UNKNOWN") continue;
      await setParcelStatus(tx, workspaceId, p, s);
      const k = statusKey(p.providerStatus!);
      moved[k] = (moved[k] ?? 0) + 1;
    }

    const events = await tx.parcelStatusEvent.findMany({ where: { workspaceId, normalizedStatus: "UNKNOWN" }, select: { id: true, providerStatus: true } });
    const byStatus = new Map<NormalizedStatus, string[]>();
    for (const e of events) {
      const s = normalizeProviderStatus(e.providerStatus, overrides);
      if (s !== "UNKNOWN") byStatus.set(s, [...(byStatus.get(s) ?? []), e.id]);
    }
    for (const [s, ids] of byStatus) await tx.parcelStatusEvent.updateMany({ where: { id: { in: ids } }, data: { normalizedStatus: s } });
    // Orders whose parcels were mapped before orders followed parcel statuses.
    const orders = await reconcileOrderStatuses(tx, workspaceId);

    const parcels = Object.values(moved).reduce((a, b) => a + b, 0);
    if (missing.length || parcels || orders.confirmed || orders.canceled) {
      await tx.auditLog.create({
        data: { workspaceId, actorUserId: null, action: "status_mapping.defaults_applied", entityType: "StatusMapping", metadata: { added: missing.map(([k]) => k), parcels: moved, orders } },
      });
    }
    return { added: missing.map(([k]) => k), parcels, orders };
  });
}

let appliedAtStart = false;

/** Once per server process: apply new defaults to every workspace with an MDM connection. */
export async function applyStatusDefaultsOnce() {
  if (appliedAtStart) return;
  appliedAtStart = true;
  const conns = await db.integrationConnection.findMany({ where: { provider: PROVIDER }, select: { workspaceId: true } });
  for (const c of conns) {
    try {
      await applyStatusDefaults(c.workspaceId);
    } catch (e) {
      console.error(`[mdm] could not apply status defaults for workspace ${c.workspaceId}`, e instanceof Error ? e.message : e);
    }
  }
}
