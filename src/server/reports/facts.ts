import type { AdPlatform } from "@prisma/client";
import { db } from "@/server/db";
import { selectCostVersion } from "@/domain/costVersions";
import type { CostResolver, CostTerms, ExpenseFact, OrderFact } from "@/domain/economics";
import { parseEconomicsDefaults, parseVerdictThresholds } from "@/domain/settings";
import type { WorkspaceContext } from "@/server/tenancy";

export type DateRange = { from?: Date; to?: Date };

export type SpendFact = { creativeId: string | null; productId: string | null; date: Date; spend: number };
export type CreativeInfo = { id: string; externalCreativeId: string; name: string | null; campaignName: string | null; platform: AdPlatform; productId: string | null };

export type WorkspaceFacts = {
  orders: (OrderFact & { orderNumber: string })[];
  spend: SpendFact[];
  expenses: (ExpenseFact & { date: Date })[];
  creatives: CreativeInfo[];
  products: { id: string; name: string; sku: string }[];
  resolveCost: CostResolver;
  defaults: ReturnType<typeof parseEconomicsDefaults>;
  thresholds: ReturnType<typeof parseVerdictThresholds>;
  currency: string;
};

const between = (r: DateRange) => (r.from || r.to ? { gte: r.from, lte: r.to } : undefined);

/**
 * Loads every stored fact needed for economics in one workspace for a date range.
 * Orders are a cohort by placed date; spend and expenses are filtered by their own dates.
 */
export async function loadFacts(ctx: WorkspaceContext, range: DateRange): Promise<WorkspaceFacts> {
  const w = ctx.workspaceId;
  const [ws, orders, spend, expenses, creatives, products, versions] = await Promise.all([
    db.workspace.findUniqueOrThrow({ where: { id: w }, select: { currency: true, economicsDefaults: true, verdictThresholds: true } }),
    db.order.findMany({
      where: { workspaceId: w, placedAt: between(range) },
      select: {
        id: true, orderNumber: true, placedAt: true, confirmedAt: true, callAttempts: true, wilaya: true,
        lines: { select: { productId: true, quantity: true } },
        attribution: { select: { creativeId: true } },
        parcels: { select: { normalizedStatus: true, codAmount: true, shippingFee: true, returnFee: true, dispatchedAt: true } },
        cashEvents: { select: { type: true, amount: true } },
      },
    }),
    db.adSpend.findMany({ where: { workspaceId: w, date: between(range), supersededAt: null }, select: { creativeId: true, date: true, spend: true, creative: { select: { productId: true } } } }),
    db.expense.findMany({ where: { workspaceId: w, date: between(range) }, select: { amount: true, allocation: true, productId: true, date: true } }),
    db.creative.findMany({ where: { workspaceId: w }, select: { id: true, externalCreativeId: true, name: true, campaignName: true, platform: true, productId: true } }),
    db.product.findMany({ where: { workspaceId: w }, select: { id: true, name: true, sku: true } }),
    db.productCostVersion.findMany({ where: { workspaceId: w } }),
  ]);

  const byProduct = new Map<string, typeof versions>();
  for (const v of versions) {
    const list = byProduct.get(v.productId);
    if (list) list.push(v);
    else byProduct.set(v.productId, [v]);
  }
  const resolveCost: CostResolver = (productId, at) => {
    if (!productId) return null;
    const v = selectCostVersion(byProduct.get(productId) ?? [], at);
    if (!v) return null;
    const terms: CostTerms = { salePrice: v.salePrice, sourcingCost: v.sourcingCost, forwardShippingFee: v.forwardShippingFee, rtoFee: v.rtoFee, callCenterFee: v.callCenterFee, packagingFee: v.packagingFee };
    return terms;
  };

  return {
    currency: ws.currency,
    defaults: parseEconomicsDefaults(ws.economicsDefaults),
    thresholds: parseVerdictThresholds(ws.verdictThresholds),
    resolveCost,
    creatives,
    products,
    orders: orders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      placedAt: o.placedAt,
      confirmed: o.confirmedAt !== null,
      callAttempts: o.callAttempts,
      productId: o.lines[0]?.productId ?? null,
      creativeId: o.attribution?.creativeId ?? null,
      wilaya: o.wilaya,
      lines: o.lines,
      parcels: o.parcels.map((p) => ({ status: p.normalizedStatus, codAmount: p.codAmount, shippingFee: p.shippingFee, returnFee: p.returnFee, dispatched: p.dispatchedAt !== null })),
      // REMITTED events carry the gross COD settled for a parcel. Carrier fees are already charged
      // through outbound shipping / RTO costs, so CARRIER_FEE events are not subtracted again here.
      remittedCash: o.cashEvents.reduce((a, e) => a + (e.type === "REMITTED" || e.type === "ADJUSTMENT" ? e.amount : 0), 0),
    })),
    spend: spend.map((s) => ({ creativeId: s.creativeId, productId: s.creative?.productId ?? null, date: s.date, spend: s.spend })),
    expenses,
  };
}
