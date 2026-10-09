import { readPartStates } from "@/domain/mdmAccount";
import { mdmWilaya } from "@/domain/wilayas";
import { dayRange } from "@/lib/zonedDays";
import { db } from "@/server/db";
import type { MdmCapital, MdmPayoutBreakdown, MdmPriceList, MdmWallet } from "@/server/mdm/types";
import { assertCan, type WorkspaceContext } from "@/server/tenancy";

/** What the Money & stock page shows: the copy of the seller's MDM account the syncs keep. */
export async function moneyOverview(ctx: WorkspaceContext) {
  assertCan(ctx, "money.read");
  const workspaceId = ctx.workspaceId;
  const [ws, conn, acc, payouts, stock, arrivals, feeLines] = await Promise.all([
    db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { currency: true, isDemo: true } }),
    db.integrationConnection.findUnique({ where: { workspaceId_provider: { workspaceId, provider: "MDM_EXPRESS" } }, select: { status: true, lastSuccessfulSyncAt: true } }),
    db.mdmAccount.findUnique({ where: { workspaceId } }),
    db.mdmPayout.findMany({ where: { workspaceId }, orderBy: { mdmCreatedAt: "desc" }, take: 50, select: { id: true, providerId: true, amount: true, currency: true, status: true, confirmed: true, storeNames: true, breakdown: true, mdmCreatedAt: true } }),
    db.mdmStockItem.findMany({ where: { workspaceId }, orderBy: [{ archived: "asc" }, { productName: "asc" }, { variantName: "asc" }], take: 200 }),
    db.mdmStockArrival.findMany({ where: { workspaceId }, orderBy: { mdmCreatedAt: "desc" }, take: 30, select: { id: true, providerId: true, status: true, operation: true, products: true, expectedUnits: true, receivedUnits: true, damagedUnits: true, mdmCreatedAt: true } }),
    db.mdmFee.count({ where: { workspaceId } }),
  ]);
  return {
    currency: ws.currency,
    demo: ws.isDemo,
    connected: conn?.status === "CONNECTED",
    lastSyncAt: conn?.lastSuccessfulSyncAt ?? null,
    parts: readPartStates(acc?.parts),
    wallet: (acc?.wallet as MdmWallet | null) ?? null,
    walletAt: acc?.walletAt ?? null,
    prices: withWilayaNames((acc?.prices as MdmPriceList | null) ?? null),
    pricesAt: acc?.pricesAt ?? null,
    capital: (acc?.capital as MdmCapital | null) ?? null,
    capitalAt: acc?.capitalAt ?? null,
    feeLines,
    payouts: payouts.map(({ breakdown, mdmCreatedAt, ...p }) => ({ ...p, date: mdmCreatedAt, breakdown: (breakdown as MdmPayoutBreakdown | null) ?? null })),
    stock: stock.map((s) => ({
      id: s.id, productName: s.productName, variantName: s.variantName, sku: s.sku, sellingPrice: s.sellingPrice, purchasePrice: s.purchasePrice, currency: s.currency, archived: s.archived, stockAt: s.stockAt,
      totalInbound: s.totalInbound, incoming: s.incoming, available: s.available, processing: s.processing, inDelivery: s.inDelivery, delivered: s.delivered, returning: s.returning, returned: s.returned, damaged: s.damaged, discharged: s.discharged, lost: s.lost,
    })),
    arrivals: arrivals.map(({ mdmCreatedAt, products, ...a }) => ({ ...a, date: mdmCreatedAt, products: (Array.isArray(products) ? products : []) as { name: string; sku: string | null; expected: number }[] })),
  };
}

/**
 * Money collected and fees MDM recorded in a period (by the day MDM wrote the line), by MDM's
 * line type, split into what MDM already paid out and what it still holds.
 */
export async function moneyFees(ctx: WorkspaceContext, input: { from?: string; to?: string }) {
  assertCan(ctx, "money.read");
  const workspaceId = ctx.workspaceId;
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { timezone: true } });
  const r = dayRange(input, ws.timezone);
  const where = { workspaceId, ...(r.from || r.to ? { mdmCreatedAt: { gte: r.from, lte: r.to } } : {}) };
  const by = ["type", "subType", "currency"] as const;
  const [all, unpaid, linked] = await Promise.all([
    db.mdmFee.groupBy({ by: [...by], where, _sum: { amount: true, grossAmount: true, taxes: true }, _count: { _all: true } }),
    db.mdmFee.groupBy({ by: [...by], where: { ...where, payoutId: null }, _sum: { amount: true }, _count: { _all: true } }),
    db.mdmFee.count({ where: { ...where, orderId: { not: null } } }),
  ]);
  const key = (g: { type: string; subType: string | null; currency: string }) => `${g.type}\u0000${g.subType ?? ""}\u0000${g.currency}`;
  const open = new Map(unpaid.map((u) => [key(u), u]));
  const rows = all
    .map((g) => {
      const u = open.get(key(g));
      const amount = g._sum.amount ?? 0;
      const waiting = u?._sum.amount ?? 0;
      return { type: g.type, subType: g.subType, currency: g.currency, lines: g._count._all, amount, gross: g._sum.grossAmount, taxes: g._sum.taxes, paidOut: amount - waiting, waiting, waitingLines: u?._count._all ?? 0 };
    })
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  const lines = rows.reduce((a, x) => a + x.lines, 0);
  return { rows, lines, linkedToOrders: linked };
}

/** Price lists saved before wilayas had one name show them under the same Arabic names as orders. */
function withWilayaNames(prices: MdmPriceList | null): MdmPriceList | null {
  return prices && { ...prices, delivery: prices.delivery.map((d) => ({ ...d, wilaya: mdmWilaya(d.wilaya, d.code) ?? d.wilaya })) };
}
