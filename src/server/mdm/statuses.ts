import type { NormalizedStatus, Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { DEFAULT_MDM_STATUS_MAP, normalizeProviderStatus, SHIPPED_STATES, statusKey } from "@/domain/statusMapping";

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
  // A parcel that left the warehouse means the order was confirmed.
  if (p.orderId && shipped) {
    await tx.order.updateMany({ where: { id: p.orderId, workspaceId, status: "PENDING" }, data: { status: "CONFIRMED", confirmedAt: dispatchedAt ?? new Date() } });
  }
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

    const parcels = Object.values(moved).reduce((a, b) => a + b, 0);
    if (missing.length || parcels) {
      await tx.auditLog.create({
        data: { workspaceId, actorUserId: null, action: "status_mapping.defaults_applied", entityType: "StatusMapping", metadata: { added: missing.map(([k]) => k), parcels: moved } },
      });
    }
    return { added: missing.map(([k]) => k), parcels };
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
