import type { AdFilter } from "@/domain/adFilter";
import { selectCostVersion } from "@/domain/costVersions";
import { allocateOverhead, computeMetrics, sumTotals, type Metrics, type Totals } from "@/domain/economics";
import { addOpen, expectedCash, expectedProfit, noOpenOrders, openOrder, settledRates, type ExpectRates, type OpenOrders } from "@/domain/openOrders";
import { FALLBACK_RATES, type CallCenterBasis } from "@/domain/orderProfit";
import { dayRange, zoneOffsetMs } from "@/lib/zonedDays";
import { db } from "@/server/db";
import { ensureCampaigns, RUNNING_STATUSES } from "@/server/repositories/campaigns";
import { assertCan, type WorkspaceContext } from "@/server/tenancy";
import { evaluate, groupTotals, type Evaluated } from "./economics";
import { loadFacts, type WorkspaceFacts } from "./facts";

const NONE = "__none__";
const DAY_MS = 86_400_000;

/** The counts and rates the Profit tracker shows for a group of orders and the spend on them. */
function funnel(m: Metrics) {
  return {
    spend: m.adSpend,
    placed: m.placed,
    confirmed: m.confirmed,
    shipped: m.shipped,
    delivered: m.delivered,
    returned: m.returned,
    lost: m.lost,
    inTransit: m.inTransit,
    finished: m.finished,
    confirmationRate: m.confirmationRate,
    // An order split into several parcels can put shipped over confirmed: the rate stops at 100%.
    shippingRate: m.shippingRate === null ? null : Math.min(1, m.shippingRate),
    deliveryRate: m.deliveryRate,
    lostRate: m.finished > 0 ? m.lost / m.finished : null,
    /** Ad spend per order placed. */
    adCostPerOrder: m.placedCpa,
  };
}
export type Funnel = ReturnType<typeof funnel>;

/** Where a number the calculation uses was read from. */
export type InputSource = "orders" | "product" | "mdm" | "settings" | "campaigns" | "none";
/** Where the rates were read from: the days picked, every order of the product, or an example. */
export type RateSource = "days" | "all" | "example";

/** Each product's order totals and its orders not finished yet. */
function byProduct(facts: WorkspaceFacts, evaluated: Evaluated[], now: Date) {
  const totals = groupTotals(evaluated, (o) => o.productId ?? NONE);
  const open = new Map<string, OpenOrders>();
  const openOf = new Map<string, ReturnType<typeof openOrder>>();
  for (const o of evaluated) {
    const r = openOrder(o, facts.resolveCost, facts.defaults, now);
    openOf.set(o.id, r);
    if (!r) continue;
    const k = o.productId ?? NONE;
    addOpen(open.get(k) ?? open.set(k, noOpenOrders()).get(k)!, r.stage, r.sums);
  }
  return { totals, open, openOf };
}

/** The rates the expected profit and one delivered order use: the days picked, else every order, else an example. */
function ratesFor(minFinished: number, sets: [RateSource, Totals | undefined, OpenOrders | undefined][]): ExpectRates & { source: RateSource; finished: number } {
  for (const [source, t, open] of sets) {
    if (!t) continue;
    const finished = t.shipped - t.inTransit;
    if (finished < minFinished) continue;
    const r = settledRates({ placed: t.placed, confirmed: t.confirmed, shipped: t.shipped, finished, delivered: t.delivered, lost: t.lost }, open ?? noOpenOrders());
    return {
      source,
      finished,
      confirmation: r.confirmation ?? FALLBACK_RATES.confirmation,
      shipping: r.shipping ?? FALLBACK_RATES.shipping,
      delivery: r.delivery ?? FALLBACK_RATES.delivery,
      lost: r.lost ?? FALLBACK_RATES.lost,
    };
  }
  return { source: "example", finished: 0, ...FALLBACK_RATES };
}

/**
 * Everything the Profit tracker needs per product, for the orders placed in the days picked:
 * - real profit: what their delivered parcels collected, minus the ads of those days, the product,
 *   every fee and the product's expenses;
 * - expected profit: what the orders not finished yet (on the road, being prepared, waiting for the
 *   call center) should still bring at the product's rates (src/domain/openOrders.ts);
 * - the numbers one delivered order is worked out from (src/domain/orderProfit.ts runs in the page,
 *   so the What if part updates at once), read from MDM, Meta and the product details, each with
 *   where it came from;
 * - its linked campaigns, its days and its MDM stock.
 */
export async function profitTracker(ctx: WorkspaceContext, input: { from?: string; to?: string; ads?: AdFilter }) {
  assertCan(ctx, "money.read");
  const workspaceId = ctx.workspaceId;
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { timezone: true, isDemo: true } });
  // Campaigns only seen in ad spend get their row first, so their spend can be linked from here.
  await ensureCampaigns(workspaceId);
  const limited = !!(input.from || input.to);
  const [facts, allFacts, products, stock, links, linkedCampaigns, linkedAccounts] = await Promise.all([
    loadFacts(ctx, dayRange(input, ws.timezone), input.ads),
    // Every order, for the rates when the days picked have too few finished parcels.
    limited ? loadFacts(ctx, {}, input.ads) : null,
    db.product.findMany({
      where: { workspaceId },
      select: { id: true, name: true, sku: true, active: true, fromMdm: true, piecesPerOrder: true, costVersions: true },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    }),
    db.mdmStockItem.findMany({ where: { workspaceId }, select: { mdmProductId: true, productName: true, archived: true, available: true, incoming: true, sellingPrice: true, purchasePrice: true, currency: true, stockAt: true } }),
    db.mdmProductLink.findMany({ where: { workspaceId }, select: { mdmProductId: true, productId: true } }),
    db.campaign.findMany({ where: { workspaceId, productId: { not: null } }, select: { productId: true }, distinct: ["productId"] }),
    db.adAccount.findMany({ where: { workspaceId, defaultProductId: { not: null } }, select: { defaultProductId: true }, distinct: ["defaultProductId"] }),
  ]);
  const now = new Date();

  // ── Real orders, the ones not finished yet, and ad spend per product ──
  const evaluated = evaluate(facts);
  const period = byProduct(facts, evaluated, now);
  const all = allFacts ? byProduct(allFacts, evaluate(allFacts), now) : period;
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
  const adsLinked = new Set<string>([...linkedCampaigns.map((c) => c.productId!), ...linkedAccounts.map((a) => a.defaultProductId!), ...[...spendByProduct.keys()].filter((k) => k !== NONE)]);

  // ── Each product's campaigns: its orders by the campaign of their ad, and the spend of each ──
  // A campaign counts for a product through its own link or its ad account's; the product's
  // orders whose ad is in none of them are kept apart.
  const linkedTo = new Map<string, string>(facts.campaigns.filter((c) => c.productId).map((c) => [c.externalId, c.productId!]));
  const pairKey = (productId: string, campaign: string | null) => `${productId}|${campaign && linkedTo.get(campaign) === productId ? campaign : NONE}`;
  const totalsByCampaign = groupTotals(
    evaluated.filter((o) => o.productId),
    (o) => pairKey(o.productId!, o.creativeId ? campaignOfAd.get(o.creativeId) ?? null : null),
  );
  const spendByCampaign = new Map<string, number>();
  for (const sp of facts.spend) {
    if (!sp.productId) continue;
    const k = pairKey(sp.productId, sp.campaignId ?? (sp.creativeId ? campaignOfAd.get(sp.creativeId) ?? null : null));
    spendByCampaign.set(k, (spendByCampaign.get(k) ?? 0) + sp.spend);
  }
  const campaignsOf = (productId: string) =>
    facts.campaigns
      .filter((c) => c.productId === productId)
      .map((c) => {
        const k = `${productId}|${c.externalId}`;
        const f = funnel(computeMetrics(totalsByCampaign.get(k) ?? sumTotals([]), spendByCampaign.get(k) ?? 0, 0, "DELIVERED"));
        return { id: c.id, name: c.name ?? c.externalId, status: c.status, running: c.status !== null && RUNNING_STATUSES.has(c.status), source: c.productSource, ...f };
      })
      .filter((c) => c.spend > 0 || c.placed > 0 || c.running)
      .sort((a, b) => b.spend - a.spend || b.placed - a.placed || a.name.localeCompare(b.name));

  // ── Each product's days, in the workspace's time zone: orders by the day they were placed ──
  const dayOf = (d: Date) => new Date(d.getTime() + zoneOffsetMs(d, ws.timezone)).toISOString().slice(0, 10);
  type Day = { date: string; totals: Totals[]; adSpend: number; open: OpenOrders };
  const daysByProduct = new Map<string, Map<string, Day>>();
  const day = (productId: string, date: string) => {
    let byDay = daysByProduct.get(productId);
    if (!byDay) daysByProduct.set(productId, (byDay = new Map()));
    return byDay.get(date) ?? byDay.set(date, { date, totals: [], adSpend: 0, open: noOpenOrders() }).get(date)!;
  };
  for (const o of evaluated) {
    if (!o.productId) continue;
    const d = day(o.productId, dayOf(o.placedAt));
    d.totals.push(o.totals);
    const open = period.openOf.get(o.id);
    if (open) addOpen(d.open, open.stage, open.sums);
  }
  // Ad days are stored as the day itself (midnight UTC).
  for (const sp of facts.spend) if (sp.productId) day(sp.productId, sp.date.toISOString().slice(0, 10)).adSpend += sp.spend;
  const daysOf = (productId: string, rates: ExpectRates) =>
    [...(daysByProduct.get(productId)?.values() ?? [])]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => {
        const t = sumTotals(d.totals);
        const costs = t.cogs + t.outboundShipping + t.rtoCost + t.callCenterCost + t.packagingCost;
        return {
          date: d.date,
          placed: t.placed,
          delivered: t.delivered,
          returned: t.returned,
          /** Orders of the day not finished yet: on the road, being prepared or waiting for a call. */
          open: d.open.road.orders + d.open.preparing.orders + d.open.waiting.orders,
          revenue: t.deliveredRevenue,
          costs,
          adSpend: d.adSpend,
          /** Real profit of the day's orders, before expenses. */
          profit: t.deliveredRevenue - costs - d.adSpend,
          /** What its open orders should still bring. */
          expected: expectedProfit(d.open, rates).total,
        };
      });

  // How many days the orders cover: the days picked (up to today), or from the first order to today.
  const today = dayOf(now);
  const firstDay = evaluated.reduce<string | null>((a, o) => {
    const d = dayOf(o.placedAt);
    return !a || d < a ? d : a;
  }, null);
  const spanFrom = input.from ?? firstDay ?? today;
  const spanTo = input.to && input.to < today ? input.to : today;
  const dayCount = Math.max(1, Math.round((Date.parse(`${spanTo}T00:00:00Z`) - Date.parse(`${spanFrom}T00:00:00Z`)) / DAY_MS) + 1);

  const groups = [...period.totals].map(([k, t]) => ({ key: k, productId: k, deliveredOrders: t.deliveredOrders, deliveredRevenue: t.deliveredRevenue }));
  const { allocated } = allocateOverhead(groups, facts.expenses, facts.defaults.overheadPolicy);

  // ── MDM stock per product: through the MDM product links, else by the same name ──
  const productOfMdm = new Map(links.map((l) => [l.mdmProductId, l.productId]));
  const linked = new Set(links.map((l) => l.productId));
  const byName = new Map(products.filter((p) => !linked.has(p.id)).map((p) => [p.name.trim().toLowerCase(), p.id]));
  type Stock = { read: boolean; available: number; incoming: number; sellingPrice: number | null; purchasePrice: number | null; at: Date | null };
  const stockOf = new Map<string, Stock>();
  for (const s of stock) {
    const productId = productOfMdm.get(s.mdmProductId) ?? byName.get(s.productName.trim().toLowerCase());
    if (!productId) continue;
    let st = stockOf.get(productId);
    if (!st) stockOf.set(productId, (st = { read: false, available: 0, incoming: 0, sellingPrice: null, purchasePrice: null, at: null }));
    st.read ||= s.stockAt !== null;
    st.available += s.available;
    st.incoming += s.incoming;
    if (s.stockAt && (!st.at || s.stockAt > st.at)) st.at = s.stockAt;
    // MDM's own prices fill in for product details nobody entered yet, when they are in the same currency.
    if (!s.archived && s.currency === facts.currency) {
      st.sellingPrice ??= s.sellingPrice;
      st.purchasePrice ??= s.purchasePrice;
    }
  }

  const d = facts.defaults;
  // Per call attempt has no attempt count ahead of time: one call per order placed.
  const callCenterBasis: CallCenterBasis = d.callCenterBasis === "CONFIRMED_ORDER" ? "CONFIRMED_ORDER" : "PLACED_LEAD";
  const minFinished = facts.thresholds.minShippedForRates;
  const per = (amount: number, n: number) => (n > 0 ? Math.round(amount / n) : null);
  /** The first value that is known, with where it came from. */
  const first = (options: [InputSource, number | null | undefined][]): { value: number; source: InputSource } => {
    for (const [source, value] of options) if (value !== null && value !== undefined) return { value, source };
    return { value: 0, source: "none" };
  };

  const rows = products
    .filter((p) => p.active || period.totals.has(p.id))
    .map((p) => {
      const t = period.totals.get(p.id) ?? sumTotals([]);
      const tAll = all.totals.get(p.id);
      const open = period.open.get(p.id) ?? noOpenOrders();
      const adSpend = spendByProduct.get(p.id) ?? 0;
      const overhead = allocated.get(p.id) ?? 0;
      const m = computeMetrics(t, adSpend, overhead, "DELIVERED");
      const v = selectCostVersion(p.costVersions, now);
      const st = stockOf.get(p.id);
      const pieces = Math.max(1, p.piecesPerOrder);
      const rates = ratesFor(minFinished, [["days", t, open], ["all", tAll, all.open.get(p.id)]]);
      // What MDM really collected and charged: the orders of these days, else of every day.
      const observed = (amount: (x: Totals) => number, count: (x: Totals) => number) => per(amount(t), count(t)) ?? (tAll ? per(amount(tAll), count(tAll)) : null);
      const finished = (x: Totals) => x.shipped - x.inTransit;
      const inputs = {
        /** What one delivered order really collected, on average (what the customer paid, delivery included). */
        price: first([["orders", observed((x) => x.deliveredRevenue, (x) => x.delivered)], ["product", v?.salePrice], ["mdm", st?.sellingPrice == null ? null : st.sellingPrice * pieces]]),
        costPerPiece: first([["product", v?.sourcingCost], ["mdm", st?.purchasePrice]]),
        deliveryFee: first([["orders", observed((x) => x.outboundShipping, finished)], ["product", v?.forwardShippingFee], ["settings", d.forwardShippingFee]]),
        returnFee: first([["orders", observed((x) => x.rtoCost, (x) => x.returned)], ["product", v?.rtoFee], ["settings", d.rtoFee]]),
        callCenterFee: first([["product", v?.callCenterFee], ["settings", d.callCenterFee]]),
        packagingFee: first([["product", v?.packagingFee], ["settings", d.packagingFee]]),
        adCostPerOrder: adsLinked.has(p.id) && m.placedCpa !== null ? { value: m.placedCpa as number | null, source: "campaigns" as InputSource } : { value: null as number | null, source: "none" as InputSource },
        callCenterBasis,
        /** Delivered orders the price is read from, and finished parcels the fees are read from. */
        delivered: t.delivered || tAll?.delivered || 0,
        finished: finished(t) || (tAll ? finished(tAll) : 0),
      };
      return {
        id: p.id,
        name: p.name,
        sku: p.sku,
        active: p.active,
        fromMdm: p.fromMdm,
        adsLinked: adsLinked.has(p.id),
        piecesPerOrder: p.piecesPerOrder,
        cost: v ? { salePrice: v.salePrice, sourcingCost: v.sourcingCost } : null,
        stock: st ? { read: st.read, available: st.available, incoming: st.incoming, at: st.at } : null,
        /** Every order of the product and its ad spend, then the same per linked campaign. */
        funnel: funnel(m),
        campaigns: campaignsOf(p.id),
        /** The product's orders whose ad is in none of its linked campaigns (or that have no ad). */
        otherOrders: funnel(computeMetrics(totalsByCampaign.get(`${p.id}|${NONE}`) ?? sumTotals([]), spendByCampaign.get(`${p.id}|${NONE}`) ?? 0, 0, "DELIVERED")),
        days: daysOf(p.id, rates),
        sample: {
          placed: m.placed,
          confirmed: m.confirmed,
          shipped: m.shipped,
          finished: m.finished,
          delivered: m.delivered,
          returned: m.returned,
          lost: m.lost,
          inTransit: m.inTransit,
          /** Canceled, or waited too long for the call center. */
          notConfirmed: m.placed - m.confirmed - open.waiting.orders,
        },
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
          missingCostOrders: t.missingCostOrders,
        },
        /** Orders not finished yet, by where they stand. */
        open: { road: open.road.orders, preparing: open.preparing.orders, waiting: open.waiting.orders },
        /** What they should still bring at `rates`, and the cash their parcels should collect. */
        expected: { ...expectedProfit(open, rates), cash: expectedCash(open, rates) },
        rates,
        inputs,
        /** The days the orders cover, orders placed per day, and the product's expenses over 30 days. */
        pace: { days: dayCount, ordersPerDay: m.placed / dayCount, expensesPerMonth: Math.round((overhead / dayCount) * 30) },
      };
    });

  return {
    currency: facts.currency,
    demo: ws.isDemo,
    /** Only the orders and spend of the picked Meta ads count. */
    adScoped: facts.adScoped,
    minFinished,
    unlinked,
    products: rows,
  };
}
