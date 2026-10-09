import type { Prisma } from "@prisma/client";
import type { AdFilter } from "@/domain/adFilter";
import { selectCostVersion } from "@/domain/costVersions";
import { allocateOverhead, computeMetrics, sumTotals } from "@/domain/economics";
import { profitPlanSchema, type Defaults, type ProductData, type ProfitPlan } from "@/domain/profitTracker";
import { dayRange } from "@/lib/zonedDays";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { ensureCampaigns } from "@/server/repositories/campaigns";
import { assertCan, NotFoundError, type WorkspaceContext } from "@/server/tenancy";
import { evaluate, groupTotals } from "./economics";
import { loadFacts } from "./facts";

const NONE = "__none__";

function readPlan(row: { stockSource: string; stockUnits: number | null; overrides: Prisma.JsonValue } | null): ProfitPlan | null {
  if (!row) return null;
  const parsed = profitPlanSchema.safeParse({ stockSource: row.stockSource, stockUnits: row.stockUnits, overrides: row.overrides ?? {} });
  return parsed.success ? parsed.data : null;
}

/**
 * Everything the Profit tracker needs per product: its product details, the MDM stock that counts
 * for it, the rates, costs and ad spend of its real orders in the period (orders by the day they
 * were placed), and what someone saved for it. The two stock calculations themselves run in the
 * browser (src/domain/profitTracker.ts), so typed values update them at once.
 */
export async function profitTracker(ctx: WorkspaceContext, input: { from?: string; to?: string; ads?: AdFilter }) {
  assertCan(ctx, "money.read");
  const workspaceId = ctx.workspaceId;
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { timezone: true, isDemo: true } });
  // Campaigns only seen in ad spend get their row first, so their spend can be linked from here.
  await ensureCampaigns(workspaceId);
  const [facts, products, stock, links, linkedCampaigns, linkedAccounts] = await Promise.all([
    loadFacts(ctx, dayRange(input, ws.timezone), input.ads),
    db.product.findMany({
      where: { workspaceId },
      select: { id: true, name: true, sku: true, active: true, fromMdm: true, costVersions: true, profitPlan: { select: { stockSource: true, stockUnits: true, overrides: true, updatedAt: true } } },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    }),
    db.mdmStockItem.findMany({
      where: { workspaceId },
      select: { mdmProductId: true, productName: true, archived: true, available: true, incoming: true, totalInbound: true, inDelivery: true, returning: true, sellingPrice: true, purchasePrice: true, currency: true, stockAt: true },
    }),
    db.mdmProductLink.findMany({ where: { workspaceId }, select: { mdmProductId: true, productId: true } }),
    db.campaign.findMany({ where: { workspaceId, productId: { not: null } }, select: { productId: true }, distinct: ["productId"] }),
    db.adAccount.findMany({ where: { workspaceId, defaultProductId: { not: null } }, select: { defaultProductId: true }, distinct: ["defaultProductId"] }),
  ]);

  // ── Real orders and ad spend per product ──
  const evaluated = evaluate(facts);
  const totalsByProduct = groupTotals(evaluated, (o) => o.productId ?? NONE);
  const spendByProduct = new Map<string, number>();
  for (const s of facts.spend) spendByProduct.set(s.productId ?? NONE, (spendByProduct.get(s.productId ?? NONE) ?? 0) + s.spend);
  // Spend whose campaign (or ad account) nobody linked to a product counts for none: listed on its
  // own, per campaign, so it can be linked from here.
  const campaignOfAd = new Map(facts.creatives.map((c) => [c.id, c.campaignId]));
  const campaignByExternal = new Map(facts.campaigns.map((c) => [c.externalId, c]));
  const unlinkedBy = new Map<string | null, number>();
  for (const s of facts.spend) {
    if (s.productId) continue;
    const k = s.campaignId ?? (s.creativeId ? campaignOfAd.get(s.creativeId) ?? null : null);
    unlinkedBy.set(k, (unlinkedBy.get(k) ?? 0) + s.spend);
  }
  const unlinked = {
    total: spendByProduct.get(NONE) ?? 0,
    campaigns: [...unlinkedBy]
      .flatMap(([k, spend]) => {
        const c = k ? campaignByExternal.get(k) : undefined;
        return c && spend > 0 ? [{ id: c.id, name: c.name ?? c.externalId, spend }] : [];
      })
      .sort((a, b) => b.spend - a.spend),
    /** Spend whose campaign isn't known (yet), so it can't be linked by campaign. */
    other: [...unlinkedBy].reduce((a, [k, spend]) => a + (k && campaignByExternal.has(k) ? 0 : spend), 0),
  };

  // Products with ads someone linked to them (a campaign, an ad account, or spend counted for them).
  // The calculation with ads only reads a cost per order from those; the others wait for a link or a typed one.
  const adsLinked = new Set<string>([...linkedCampaigns.map((c) => c.productId!), ...linkedAccounts.map((a) => a.defaultProductId!), ...[...spendByProduct.keys()].filter((k) => k !== NONE)]);

  const groups = [...totalsByProduct].map(([k, t]) => ({ key: k, productId: k, deliveredOrders: t.deliveredOrders, deliveredRevenue: t.deliveredRevenue }));
  const { allocated } = allocateOverhead(groups, facts.expenses, facts.defaults.overheadPolicy);

  // ── MDM stock per product: through the MDM product links, else by the same name ──
  const productOfMdm = new Map(links.map((l) => [l.mdmProductId, l.productId]));
  const linked = new Set(links.map((l) => l.productId));
  const byName = new Map(products.filter((p) => !linked.has(p.id)).map((p) => [p.name.trim().toLowerCase(), p.id]));
  type Stock = ProductData["stock"] & { inDelivery: number; returning: number; at: Date | null; names: string[] };
  const stockOf = new Map<string, Stock>();
  for (const s of stock) {
    const productId = productOfMdm.get(s.mdmProductId) ?? byName.get(s.productName.trim().toLowerCase());
    if (!productId) continue;
    let st = stockOf.get(productId);
    if (!st) stockOf.set(productId, (st = { read: false, available: 0, incoming: 0, received: 0, inDelivery: 0, returning: 0, sellingPrice: null, purchasePrice: null, at: null, names: [] }));
    st.read ||= s.stockAt !== null;
    st.available += s.available;
    st.incoming += s.incoming;
    st.received += s.totalInbound;
    st.inDelivery += s.inDelivery;
    st.returning += s.returning;
    if (s.stockAt && (!st.at || s.stockAt > st.at)) st.at = s.stockAt;
    if (!st.names.includes(s.productName)) st.names.push(s.productName);
    // MDM's own prices fill in for product details nobody entered yet, when they are in the same currency.
    if (!s.archived && s.currency === facts.currency) {
      st.sellingPrice ??= s.sellingPrice;
      st.purchasePrice ??= s.purchasePrice;
    }
  }

  const d = facts.defaults;
  const defaults: Defaults = {
    forwardShippingFee: d.forwardShippingFee,
    rtoFee: d.rtoFee,
    callCenterFee: d.callCenterFee,
    packagingFee: d.packagingFee,
    // Per call attempt has no attempt count ahead of time: the projection counts one call per order placed.
    callCenterBasis: d.callCenterBasis === "CONFIRMED_ORDER" ? "CONFIRMED_ORDER" : "PLACED_LEAD",
  };
  const minFinished = facts.thresholds.minShippedForRates;
  const now = new Date();

  const rows = products
    .filter((p) => p.active || totalsByProduct.has(p.id))
    .map((p) => {
      const t = totalsByProduct.get(p.id) ?? sumTotals([]);
      const adSpend = spendByProduct.get(p.id) ?? 0;
      const overhead = allocated.get(p.id) ?? 0;
      const m = computeMetrics(t, adSpend, overhead, "DELIVERED");
      const v = selectCostVersion(p.costVersions, now);
      const st = stockOf.get(p.id);
      const per = (amount: number, n: number) => (n > 0 ? Math.round(amount / n) : null);
      const data: ProductData = {
        cost: v ? { salePrice: v.salePrice, sourcingCost: v.sourcingCost, forwardShippingFee: v.forwardShippingFee, rtoFee: v.rtoFee, callCenterFee: v.callCenterFee, packagingFee: v.packagingFee } : null,
        stock: st ? { read: st.read, available: st.available, incoming: st.incoming, received: st.received, sellingPrice: st.sellingPrice, purchasePrice: st.purchasePrice } : { read: false, available: 0, incoming: 0, received: 0, sellingPrice: null, purchasePrice: null },
        observed: {
          enough: m.finished >= minFinished,
          confirmationRate: m.confirmationRate,
          shippingRate: m.shippingRate,
          deliveryRate: m.deliveryRate,
          lostRate: m.finished > 0 ? m.lost / m.finished : null,
          unitsPerOrder: t.deliveredOrders > 0 ? Math.round((t.deliveredUnits / t.deliveredOrders) * 100) / 100 : null,
          cpa: adsLinked.has(p.id) ? m.placedCpa : null,
          avgShippingFee: per(t.outboundShipping, m.finished),
          avgReturnFee: per(t.rtoCost, t.returned),
        },
        plan: readPlan(p.profitPlan),
      };
      return {
        id: p.id,
        name: p.name,
        sku: p.sku,
        active: p.active,
        fromMdm: p.fromMdm,
        adsLinked: adsLinked.has(p.id),
        ...data,
        stockDetail: st ? { inDelivery: st.inDelivery, returning: st.returning, at: st.at, names: st.names } : null,
        planUpdatedAt: p.profitPlan?.updatedAt ?? null,
        sample: { placed: m.placed, confirmed: m.confirmed, shipped: m.shipped, finished: m.finished, delivered: m.delivered, returned: m.returned, lost: m.lost, inTransit: m.inTransit, returnRate: m.returnRate },
        actual: {
          deliveredUnits: t.deliveredUnits,
          deliveredRevenue: t.deliveredRevenue,
          cogs: t.cogs,
          adSpend,
          outboundShipping: t.outboundShipping,
          rtoCost: t.rtoCost,
          callCenterCost: t.callCenterCost,
          packagingCost: t.packagingCost,
          overhead,
          trueNetProfit: m.trueNetProfit,
          cashInTransit: t.cashInTransit,
          missingCostOrders: t.missingCostOrders,
        },
      };
    });

  return {
    currency: facts.currency,
    demo: ws.isDemo,
    /** Only the orders and spend of the picked Meta ads count. */
    adScoped: facts.adScoped,
    defaults,
    minFinished,
    unlinked,
    products: rows,
  };
}

/** Saves what the Profit tracker counts for one product. `plan: null` goes back to the data. */
export async function saveProfitPlan(ctx: WorkspaceContext, input: { productId: string; plan: ProfitPlan | null }) {
  assertCan(ctx, "settings.economics");
  const product = await db.product.findFirst({ where: { id: input.productId, workspaceId: ctx.workspaceId }, select: { id: true } });
  if (!product) throw new NotFoundError("Product not found");
  if (!input.plan) {
    await db.profitPlan.deleteMany({ where: { productId: product.id, workspaceId: ctx.workspaceId } });
  } else {
    const data = { stockSource: input.plan.stockSource, stockUnits: input.plan.stockUnits, overrides: input.plan.overrides, updatedById: ctx.userId };
    await db.profitPlan.upsert({ where: { productId: product.id }, create: { productId: product.id, workspaceId: ctx.workspaceId, ...data }, update: data });
  }
  await audit(ctx, input.plan ? "profitPlan.saved" : "profitPlan.cleared", { type: "Product", id: product.id }, input.plan ? { stockSource: input.plan.stockSource, fields: Object.keys(input.plan.overrides) } : undefined);
  return { ok: true };
}
