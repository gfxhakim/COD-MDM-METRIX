import type { AdPlatform } from "@prisma/client";
import { db } from "@/server/db";
import { selectCostVersion } from "@/domain/costVersions";
import type { CostResolver, CostTerms, ExpenseFact, OrderFact } from "@/domain/economics";
import { parseEconomicsDefaults, parseVerdictThresholds } from "@/domain/settings";
import type { WorkspaceContext } from "@/server/tenancy";

export type DateRange = { from?: Date; to?: Date };

/** `productId` is the product the spend counts for (see `loadFacts`). `campaignId` is the platform's campaign ID. */
export type SpendFact = { creativeId: string | null; productId: string | null; campaignId: string | null; adAccountId: string | null; date: Date; spend: number };
/** `productId` is the product the ad counts for: its campaign's, else its own (see `loadFacts`). */
export type CreativeInfo = { id: string; externalCreativeId: string; name: string | null; campaignId: string | null; campaignName: string | null; platform: AdPlatform; productId: string | null };
export type CampaignInfo = {
  id: string;
  externalId: string;
  name: string | null;
  adAccountId: string | null;
  status: string | null;
  /** The product linked to the campaign itself. */
  ownProductId: string | null;
  /** The product it counts for: its own, else its ad account's default. */
  productId: string | null;
  productSource: "CAMPAIGN" | "ACCOUNT" | null;
};

export type WorkspaceFacts = {
  orders: (OrderFact & { orderNumber: string })[];
  spend: SpendFact[];
  expenses: (ExpenseFact & { date: Date })[];
  creatives: CreativeInfo[];
  campaigns: CampaignInfo[];
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
 *
 * Which product ad spend counts for, most specific link first: the campaign's own product,
 * then its ad account's default product, then the ad's own product. Orders keep the product
 * of their own lines.
 */
export async function loadFacts(ctx: WorkspaceContext, range: DateRange): Promise<WorkspaceFacts> {
  const w = ctx.workspaceId;
  const [ws, orders, spend, expenses, creatives, products, versions, campaigns, accounts] = await Promise.all([
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
    db.adSpend.findMany({ where: { workspaceId: w, date: between(range), supersededAt: null }, select: { creativeId: true, campaignId: true, adAccountId: true, date: true, spend: true } }),
    db.expense.findMany({ where: { workspaceId: w, date: between(range) }, select: { amount: true, allocation: true, productId: true, date: true } }),
    db.creative.findMany({ where: { workspaceId: w }, select: { id: true, externalCreativeId: true, name: true, campaignId: true, campaignName: true, platform: true, productId: true } }),
    db.product.findMany({ where: { workspaceId: w }, select: { id: true, name: true, sku: true } }),
    db.productCostVersion.findMany({ where: { workspaceId: w } }),
    db.campaign.findMany({ where: { workspaceId: w }, select: { id: true, externalId: true, name: true, adAccountId: true, status: true, productId: true } }),
    db.adAccount.findMany({ where: { workspaceId: w, defaultProductId: { not: null } }, select: { externalId: true, defaultProductId: true } }),
  ]);

  const accountProduct = new Map(accounts.map((a) => [a.externalId, a.defaultProductId!]));
  const campaignInfo: CampaignInfo[] = campaigns.map((c) => {
    const inherited = c.adAccountId ? accountProduct.get(c.adAccountId) ?? null : null;
    return { id: c.id, externalId: c.externalId, name: c.name, adAccountId: c.adAccountId, status: c.status, ownProductId: c.productId, productId: c.productId ?? inherited, productSource: c.productId ? "CAMPAIGN" : inherited ? "ACCOUNT" : null };
  });
  const campaignProduct = new Map(campaignInfo.filter((c) => c.productId).map((c) => [c.externalId, c.productId!]));
  const creativeInfo: CreativeInfo[] = creatives.map((c) => ({ ...c, productId: (c.campaignId ? campaignProduct.get(c.campaignId) : undefined) ?? c.productId }));
  const creativeProduct = new Map(creativeInfo.map((c) => [c.id, c.productId]));

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
    creatives: creativeInfo,
    campaigns: campaignInfo,
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
    spend: spend.map((s) => ({
      creativeId: s.creativeId,
      campaignId: s.campaignId,
      adAccountId: s.adAccountId,
      productId: (s.campaignId ? campaignProduct.get(s.campaignId) : undefined) ?? (s.adAccountId ? accountProduct.get(s.adAccountId) : undefined) ?? (s.creativeId ? creativeProduct.get(s.creativeId) ?? null : null),
      date: s.date,
      spend: s.spend,
    })),
    expenses,
  };
}
