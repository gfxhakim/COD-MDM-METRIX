import {
  allocateOverhead,
  computeMetrics,
  creativeVerdict,
  orderEconomics,
  sumTotals,
  type AllocationGroup,
  type Metrics,
  type RevenueView,
  type Totals,
  type Verdict,
} from "@/domain/economics";
import type { AdFilter } from "@/domain/adFilter";
import { getDataHealth } from "@/server/repositories/overview";
import type { WorkspaceContext } from "@/server/tenancy";
import { loadFacts, type DateRange, type WorkspaceFacts } from "./facts";

export const UNATTRIBUTED = "__unattributed__";
export const UNMATCHED_SPEND = "__unmatched_spend__";

export type Evaluated = WorkspaceFacts["orders"][number] & { totals: Totals };

export function evaluate(facts: WorkspaceFacts): Evaluated[] {
  return facts.orders.map((o) => ({ ...o, totals: orderEconomics(o, facts.resolveCost, facts.defaults) }));
}

export function groupTotals<K extends string>(orders: Evaluated[], keyOf: (o: Evaluated) => K): Map<K, Totals> {
  const buckets = new Map<K, Totals[]>();
  for (const o of orders) {
    const k = keyOf(o);
    const list = buckets.get(k);
    if (list) list.push(o.totals);
    else buckets.set(k, [o.totals]);
  }
  return new Map([...buckets].map(([k, list]) => [k, sumTotals(list)]));
}

const sumSpend = (facts: WorkspaceFacts, pred: (s: WorkspaceFacts["spend"][number]) => boolean) => facts.spend.filter(pred).reduce((a, s) => a + s.spend, 0);

export type CreativeRow = {
  key: string;
  kind: "CREATIVE" | "UNATTRIBUTED" | "UNMATCHED_SPEND";
  creativeId: string | null;
  externalCreativeId: string | null;
  name: string | null;
  campaignName: string | null;
  productId: string | null;
  metrics: Metrics;
  verdict: Verdict | null;
};

/**
 * Order totals, ad spend and allocated overhead per creative, keyed by creative ID, plus the
 * UNATTRIBUTED (orders without a creative) and UNMATCHED_SPEND (spend without one) buckets.
 */
export function creativeBreakdown(facts: WorkspaceFacts, evaluated: Evaluated[]) {
  const totalsByCreative = groupTotals(evaluated, (o) => o.creativeId ?? UNATTRIBUTED);
  const spendByCreative = new Map<string, number>();
  for (const s of facts.spend) {
    const k = s.creativeId ?? UNMATCHED_SPEND;
    spendByCreative.set(k, (spendByCreative.get(k) ?? 0) + s.spend);
  }
  const creativeIndex = new Map(facts.creatives.map((c) => [c.id, c]));
  const keys = new Set<string>([...totalsByCreative.keys(), ...spendByCreative.keys()]);
  const groups: AllocationGroup[] = [...keys].map((k) => {
    const t = totalsByCreative.get(k);
    return { key: k, productId: creativeIndex.get(k)?.productId ?? null, deliveredOrders: t?.deliveredOrders ?? 0, deliveredRevenue: t?.deliveredRevenue ?? 0 };
  });
  const { allocated, unallocated } = allocateOverhead(groups, facts.expenses, facts.defaults.overheadPolicy);
  return { keys, totalsByCreative, spendByCreative, allocated, unallocated, creativeIndex };
}

/** Creative-level economics including the unattributed-orders and unmatched-spend buckets. */
function creativeRows(facts: WorkspaceFacts, evaluated: Evaluated[], view: RevenueView): { rows: CreativeRow[]; unallocatedOverhead: number } {
  const { keys, totalsByCreative, spendByCreative, allocated, unallocated, creativeIndex } = creativeBreakdown(facts, evaluated);
  const rows: CreativeRow[] = [...keys].map((k) => {
    const c = creativeIndex.get(k);
    const metrics = computeMetrics(totalsByCreative.get(k) ?? sumTotals([]), spendByCreative.get(k) ?? 0, allocated.get(k) ?? 0, view);
    const kind = k === UNATTRIBUTED ? "UNATTRIBUTED" : k === UNMATCHED_SPEND ? "UNMATCHED_SPEND" : "CREATIVE";
    return {
      key: k,
      kind,
      creativeId: c?.id ?? null,
      externalCreativeId: c?.externalCreativeId ?? null,
      name: kind === "UNATTRIBUTED" ? "Unattributed orders" : kind === "UNMATCHED_SPEND" ? "Unmatched spend" : c?.name ?? null,
      campaignName: c?.campaignName ?? null,
      productId: c?.productId ?? null,
      metrics,
      verdict: kind === "CREATIVE" ? creativeVerdict(metrics, facts.thresholds) : null,
    };
  });
  return { rows, unallocatedOverhead: unallocated };
}

export async function creativeMatrix(ctx: WorkspaceContext, input: DateRange & { revenueView?: RevenueView; ads?: AdFilter }) {
  const facts = await loadFacts(ctx, input, input.ads);
  const view = input.revenueView ?? facts.defaults.revenueView;
  const { rows, unallocatedOverhead } = creativeRows(facts, evaluate(facts), view);
  rows.sort((a, b) => (a.kind === "CREATIVE" ? 0 : 1) - (b.kind === "CREATIVE" ? 0 : 1) || b.metrics.trueNetProfit - a.metrics.trueNetProfit);
  return { currency: facts.currency, revenueView: view, thresholds: facts.thresholds, overheadPolicy: facts.defaults.overheadPolicy, unallocatedOverhead, rows };
}

export type DashboardInput = DateRange & { productId?: string; creativeId?: string; revenueView?: RevenueView; ads?: AdFilter };

export async function dashboardReport(ctx: WorkspaceContext, input: DashboardInput) {
  const facts = await loadFacts(ctx, input, input.ads);
  const view = input.revenueView ?? facts.defaults.revenueView;
  const evaluated = evaluate(facts);
  const creative = creativeRows(facts, evaluated, view);

  // Scope: whole business, one product, or one creative.
  let scoped = evaluated;
  let adSpend: number;
  let overhead: number;
  if (input.creativeId) {
    scoped = evaluated.filter((o) => o.creativeId === input.creativeId);
    adSpend = sumSpend(facts, (s) => s.creativeId === input.creativeId);
    overhead = creative.rows.find((r) => r.key === input.creativeId)?.metrics.allocatedOverhead ?? 0;
  } else if (input.productId) {
    scoped = evaluated.filter((o) => o.productId === input.productId);
    adSpend = sumSpend(facts, (s) => s.productId === input.productId);
    const byProduct = groupTotals(evaluated, (o) => o.productId ?? "__none__");
    const groups = [...byProduct].map(([k, t]) => ({ key: k, productId: k, deliveredOrders: t.deliveredOrders, deliveredRevenue: t.deliveredRevenue }));
    overhead = allocateOverhead(groups, facts.expenses, facts.defaults.overheadPolicy).allocated.get(input.productId) ?? 0;
  } else {
    adSpend = sumSpend(facts, () => true);
    // Business level: every categorized expense in the period reduces profit, whatever the allocation policy
    // (with an ad filter, the share the orders of those ads take).
    overhead = facts.expenses.reduce((a, e) => a + e.amount, 0);
  }
  const metrics = computeMetrics(sumTotals(scoped.map((o) => o.totals)), adSpend, overhead, view);

  const wilayas = [...groupTotals(scoped, (o) => o.wilaya ?? "Unknown")]
    .map(([wilaya, t]) => {
      const m = computeMetrics(t, 0, 0, view);
      return { wilaya, placed: t.placed, shipped: t.shipped, delivered: t.delivered, returned: t.returned, deliveryRate: m.deliveryRate, returnRate: m.returnRate, deliveredRevenue: t.deliveredRevenue, contributionBeforeAds: m.trueNetProfit };
    })
    .sort((a, b) => b.placed - a.placed);

  // Daily series for sparklines.
  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const days = new Map<string, { date: string; adSpend: number; placed: number; delivered: number }>();
  const bump = (d: Date) => days.get(dayKey(d)) ?? days.set(dayKey(d), { date: dayKey(d), adSpend: 0, placed: 0, delivered: 0 }).get(dayKey(d))!;
  for (const o of scoped) {
    const e = bump(o.placedAt);
    e.placed += 1;
    e.delivered += o.totals.delivered;
  }
  for (const s of facts.spend) {
    if (input.creativeId ? s.creativeId !== input.creativeId : input.productId ? s.productId !== input.productId : false) continue;
    bump(s.date).adSpend += s.spend;
  }
  const series = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));

  const creativeOnly = creative.rows.filter((r) => r.kind === "CREATIVE" && (!input.productId || r.productId === input.productId));
  const minShipped = facts.thresholds.minShippedForRates;
  const summary = (r: CreativeRow) => ({ key: r.key, externalCreativeId: r.externalCreativeId, name: r.name, trueNetProfit: r.metrics.trueNetProfit, truePoas: r.metrics.truePoas, returnRate: r.metrics.returnRate, shipped: r.metrics.shipped, returned: r.metrics.returned, verdict: r.verdict });

  return {
    currency: facts.currency,
    revenueView: view,
    metrics,
    wilayas,
    series,
    topCreatives: [...creativeOnly].filter((r) => r.metrics.placed > 0).sort((a, b) => b.metrics.trueNetProfit - a.metrics.trueNetProfit).slice(0, 5).map(summary),
    worstRtoCreatives: creativeOnly
      .filter((r) => r.metrics.finished > 0 && r.metrics.returnRate !== null)
      .sort((a, b) => (b.metrics.returnRate ?? 0) - (a.metrics.returnRate ?? 0) || b.metrics.returned - a.metrics.returned)
      .slice(0, 5)
      .map((r) => ({ ...summary(r), belowSample: r.metrics.finished < minShipped })),
    health: await getDataHealth(ctx),
  };
}

/** Observed rates and current costs for seeding the simulator. */
export async function observedForSimulator(ctx: WorkspaceContext, input: DateRange & { productId?: string }) {
  const facts = await loadFacts(ctx, input);
  const evaluated = evaluate(facts).filter((o) => !input.productId || o.productId === input.productId);
  const m = computeMetrics(sumTotals(evaluated.map((o) => o.totals)), sumSpend(facts, (s) => !input.productId || s.productId === input.productId), 0, "DELIVERED");
  const cost = input.productId ? facts.resolveCost(input.productId, new Date()) : null;
  const d = facts.defaults;
  return {
    currency: facts.currency,
    callCenterBasis: d.callCenterBasis,
    sample: { placed: m.placed, confirmed: m.confirmed, shipped: m.shipped, delivered: m.delivered, returned: m.returned, lost: m.lost },
    rates: {
      confirmationRate: m.confirmationRate,
      shippingRate: m.shippingRate,
      deliveryRate: m.deliveryRate,
      returnRate: m.returnRate,
      lostRate: m.shipped > 0 ? m.lost / m.shipped : null,
    },
    currentCpa: { placed: m.placedCpa, confirmed: m.cpco, delivered: m.cpdo },
    costs: {
      salePrice: cost?.salePrice ?? null,
      sourcingCost: cost?.sourcingCost ?? null,
      outboundShipping: cost?.forwardShippingFee ?? d.forwardShippingFee,
      rtoFee: cost?.rtoFee ?? d.rtoFee,
      callCenterCost: cost?.callCenterFee ?? d.callCenterFee,
      packagingCost: cost?.packagingFee ?? d.packagingFee,
    },
  };
}
