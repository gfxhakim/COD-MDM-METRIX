import type { AdPlatform } from "@prisma/client";
import { db } from "@/server/db";
import type { AdFilter } from "@/domain/adFilter";
import { selectCostVersion } from "@/domain/costVersions";
import { recurringByMonth } from "@/domain/recurring";
import { allocateOverhead, orderEconomics, type AllocationGroup, type CostResolver, type CostTerms, type ExpenseFact, type OrderFact } from "@/domain/economics";
import { parseEconomicsDefaults, parseVerdictThresholds } from "@/domain/settings";
import type { WorkspaceContext } from "@/server/tenancy";
import { resolveAdScope, scopeMatcher } from "./adScope";

export type DateRange = { from?: Date; to?: Date };

/** `productId` is the product the spend counts for (see `loadFacts`). `campaignId` is the platform's campaign ID. */
export type SpendFact = { creativeId: string | null; productId: string | null; campaignId: string | null; adAccountId: string | null; date: Date; spend: number };
/** `productId` is the product the ad counts for: its campaign's; only an ad without a campaign keeps its own (see `loadFacts`). */
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
  /** True when only some Meta ads count (see `loadFacts`). */
  adScoped: boolean;
};

const between = (r: DateRange) => (r.from || r.to ? { gte: r.from, lte: r.to } : undefined);

/**
 * Loads every stored fact needed for economics in one workspace for a date range.
 * Orders are a cohort by placed date; spend and expenses are filtered by their own dates.
 * Repeating expenses add their share of the range, one fact per month.
 *
 * With an ad filter, only the orders whose ad is in the picked campaigns or ad accounts count
 * (orders without an ad don't), only the spend of those campaigns or accounts, only those campaigns,
 * and the share of the expenses those orders take under the overhead rule.
 *
 * Ad spend counts for a product only through a link someone set: the campaign's own product,
 * else its ad account's product. Spend with no campaign at all (a CSV without one) can still
 * count through its ad's product. Nothing is guessed: spend without a link counts for no product
 * (it still counts in the business's totals). Orders keep the product of their own lines.
 */
export async function loadFacts(ctx: WorkspaceContext, range: DateRange, ads?: AdFilter | null): Promise<WorkspaceFacts> {
  const w = ctx.workspaceId;
  const [scope, ws, orders, spend, expenses, recurring, creatives, products, versions, campaigns, accounts] = await Promise.all([
    resolveAdScope(w, ads),
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
    db.recurringExpense.findMany({ where: { workspaceId: w }, select: { amount: true, frequency: true, startDate: true, endDate: true, allocation: true, productId: true } }),
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
  // An ad in a campaign counts for its campaign's product; only an ad without a campaign keeps its own.
  const creativeInfo: CreativeInfo[] = creatives.map((c) => ({ ...c, productId: c.campaignId ? (campaignProduct.get(c.campaignId) ?? null) : c.productId }));
  const creativeProduct = new Map(creativeInfo.map((c) => [c.id, c.productId]));
  const creativeCampaign = new Map(creatives.map((c) => [c.id, c.campaignId]));

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

  const defaults = parseEconomicsDefaults(ws.economicsDefaults);
  const orderFacts = orders.map((o) => ({
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
    }));
  const spendProduct = (s: { creativeId: string | null; campaignId: string | null; adAccountId: string | null }) => {
    const campaignId = s.campaignId ?? (s.creativeId ? creativeCampaign.get(s.creativeId) ?? null : null);
    if (campaignId) return campaignProduct.get(campaignId) ?? (s.adAccountId ? accountProduct.get(s.adAccountId) ?? null : null);
    if (s.adAccountId && accountProduct.has(s.adAccountId)) return accountProduct.get(s.adAccountId)!;
    return s.creativeId ? creativeProduct.get(s.creativeId) ?? null : null;
  };
  const spendFacts: SpendFact[] = spend.map((s) => ({
      creativeId: s.creativeId,
      campaignId: s.campaignId,
      adAccountId: s.adAccountId,
      productId: spendProduct(s),
      date: s.date,
      spend: s.spend,
    }));
  const expenseFacts = [...expenses, ...recurringFacts(recurring, range, new Date())];

  const facts: WorkspaceFacts = {
    currency: ws.currency,
    defaults,
    thresholds: parseVerdictThresholds(ws.verdictThresholds),
    resolveCost,
    creatives: creativeInfo,
    campaigns: campaignInfo,
    products,
    orders: orderFacts,
    spend: spendFacts,
    expenses: expenseFacts,
    adScoped: false,
  };
  if (!scope) return facts;

  const inScope = scopeMatcher(scope, new Map(campaigns.map((c) => [c.externalId, c.adAccountId])));
  const adCampaign = new Map(creatives.map((c) => [c.id, c.campaignId]));
  const orderIn = (o: { creativeId: string | null }) => !!o.creativeId && inScope(adCampaign.get(o.creativeId) ?? null);
  return {
    ...facts,
    adScoped: true,
    orders: orderFacts.filter(orderIn),
    spend: spendFacts.filter((s) => inScope(s.campaignId ?? (s.creativeId ? (adCampaign.get(s.creativeId) ?? null) : null), s.adAccountId)),
    campaigns: campaignInfo.filter((c) => inScope(c.externalId, c.adAccountId)),
    expenses: expenseShare(orderFacts, orderIn, expenseFacts, facts, range.to ?? new Date()),
  };
}

/**
 * The expenses the orders in scope take: every order of the range is weighed by the overhead rule
 * (delivered orders or revenue, per product), and the part allocated to the orders in scope is kept,
 * on their products. Nothing is kept when the rule leaves expenses unallocated.
 */
function expenseShare(all: WorkspaceFacts["orders"], isIn: (o: WorkspaceFacts["orders"][number]) => boolean, expenses: WorkspaceFacts["expenses"], facts: WorkspaceFacts, date: Date): WorkspaceFacts["expenses"] {
  const groups = new Map<string, AllocationGroup & { inScope: boolean }>();
  for (const o of all) {
    const inScope = isIn(o);
    const key = `${inScope ? "in" : "out"}|${o.productId ?? ""}`;
    const g = groups.get(key) ?? groups.set(key, { key, productId: o.productId, deliveredOrders: 0, deliveredRevenue: 0, inScope }).get(key)!;
    const t = orderEconomics(o, facts.resolveCost, facts.defaults);
    g.deliveredOrders += t.deliveredOrders;
    g.deliveredRevenue += t.deliveredRevenue;
  }
  const { allocated } = allocateOverhead([...groups.values()], expenses, facts.defaults.overheadPolicy);
  return [...groups.values()]
    .filter((g) => g.inScope && (allocated.get(g.key) ?? 0) > 0)
    .map((g) => ({ amount: allocated.get(g.key)!, allocation: g.productId ? ("PRODUCT" as const) : ("GLOBAL" as const), productId: g.productId, date }));
}

function recurringFacts(rows: (Parameters<typeof recurringByMonth>[0] & Omit<ExpenseFact, "amount">)[], range: DateRange, now: Date) {
  const out: (ExpenseFact & { date: Date })[] = [];
  for (const r of rows) {
    for (const [month, amount] of recurringByMonth(r, range, now)) {
      if (amount > 0) out.push({ amount, allocation: r.allocation, productId: r.productId, date: new Date(`${month}-15T12:00:00Z`) });
    }
  }
  return out;
}
