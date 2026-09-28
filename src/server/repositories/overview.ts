import { db } from "@/server/db";
import type { WorkspaceContext } from "@/server/tenancy";

/**
 * Data-freshness and data-quality facts shown across the app shell and dashboard.
 * Profit calculations live in the economics engine (Milestone 2); this only counts stored facts.
 */
export async function getDataHealth(ctx: WorkspaceContext) {
  const w = { workspaceId: ctx.workspaceId };
  const [connection, lastJob, unmatched, unknownParcels, importErrors, failedSyncItems, pendingBank, unmatchedSpend] = await Promise.all([
    db.integrationConnection.findFirst({ where: { ...w, provider: "MDM_EXPRESS" }, select: { status: true, lastSuccessfulSyncAt: true, lastTestedAt: true, maskedLabel: true } }),
    db.syncJob.findFirst({ where: w, orderBy: { createdAt: "desc" }, select: { id: true, status: true, createdAt: true, finishedAt: true } }),
    db.unmatchedRecord.count({ where: { ...w, status: "OPEN" } }),
    db.parcel.count({ where: { ...w, normalizedStatus: "UNKNOWN" } }),
    db.importRowError.count({ where: w }),
    db.syncItem.count({ where: { ...w, result: "FAILED" } }),
    db.bankTransaction.count({ where: { ...w, reviewStatus: "PENDING" } }),
    db.adSpend.count({ where: { ...w, creativeId: null, supersededAt: null } }),
  ]);
  return {
    connectionStatus: connection?.status ?? "NOT_CONFIGURED",
    maskedLabel: connection?.maskedLabel ?? null,
    lastSuccessfulSyncAt: connection?.lastSuccessfulSyncAt ?? null,
    lastJob,
    unmatchedRecords: unmatched,
    unknownStatusParcels: unknownParcels,
    importRowErrors: importErrors,
    failedSyncItems,
    pendingBankRows: pendingBank,
    unmatchedSpendRows: unmatchedSpend,
  };
}

export async function getOperationalCounts(ctx: WorkspaceContext, range: { from?: Date; to?: Date }) {
  const placedAt = range.from || range.to ? { gte: range.from, lte: range.to } : undefined;
  const orderWhere = { workspaceId: ctx.workspaceId, placedAt };
  const [placed, confirmed, canceled, parcelGroups, wilayaGroups] = await Promise.all([
    db.order.count({ where: orderWhere }),
    db.order.count({ where: { ...orderWhere, confirmedAt: { not: null } } }),
    db.order.count({ where: { ...orderWhere, status: "CANCELED" } }),
    db.parcel.groupBy({ by: ["normalizedStatus"], where: { workspaceId: ctx.workspaceId, order: placedAt ? { placedAt } : undefined }, _count: true }),
    db.order.groupBy({ by: ["wilaya"], where: orderWhere, _count: true, orderBy: { _count: { wilaya: "desc" } }, take: 8 }),
  ]);
  const byStatus = Object.fromEntries(parcelGroups.map((g) => [g.normalizedStatus, g._count])) as Record<string, number>;
  return {
    placed,
    confirmed,
    canceled,
    parcelsByStatus: byStatus,
    wilayas: wilayaGroups.map((g) => ({ wilaya: g.wilaya ?? "Unknown", orders: g._count })),
  };
}
