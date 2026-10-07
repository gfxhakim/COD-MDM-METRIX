import type { AdFilter } from "@/domain/adFilter";
import { computeMetrics, creativeVerdict, sumTotals, type Metrics, type RevenueView, type Totals, type Verdict } from "@/domain/economics";
import { db } from "@/server/db";
import { ensureCampaigns, RUNNING_STATUSES } from "@/server/repositories/campaigns";
import type { WorkspaceContext } from "@/server/tenancy";
import { creativeBreakdown, evaluate, UNATTRIBUTED, UNMATCHED_SPEND } from "./economics";
import { loadFacts, type CampaignInfo, type DateRange } from "./facts";

/** Orders and spend that no campaign can be found for. */
export const NO_CAMPAIGN = "__no_campaign__";
/** The ad-account filter value for campaigns whose ad account is unknown (imported from a CSV). */
export const NO_ACCOUNT = "__none__";

export type CampaignAdRow = { key: string; externalCreativeId: string | null; name: string | null; metrics: Metrics; verdict: Verdict | null };

export type CampaignRow = {
  key: string;
  kind: "CAMPAIGN" | "NO_CAMPAIGN";
  campaignId: string | null;
  externalId: string | null;
  name: string | null;
  adAccountId: string | null;
  status: string | null;
  /** On in Meta, or spent in the period. */
  running: boolean;
  productId: string | null;
  ownProductId: string | null;
  /** ADS: not linked, and all its ads count for the same product through their own link. */
  productSource: CampaignInfo["productSource"] | "ADS";
  metrics: Metrics;
  verdict: Verdict | null;
  /** Orders from this campaign whose own lines are all for another product than the campaign's. */
  otherProductOrders: number;
  ads: CampaignAdRow[];
};

type Acc = { totals: Totals[]; spend: number; overhead: number; otherProductOrders: number; ads: Set<string> };
const emptyAcc = (): Acc => ({ totals: [], spend: 0, overhead: 0, otherProductOrders: 0, ads: new Set() });

/**
 * Each campaign with its own orders, spend and profit, for one ad account or all of them.
 * An order belongs to the campaign of its ad (the ad ID in utm_content); spend to the campaign
 * Meta reported it under. Overhead is what the campaign's ads were allocated in the creative matrix.
 */
export async function campaignReport(ctx: WorkspaceContext, input: DateRange & { adAccountId?: string; revenueView?: RevenueView; ads?: AdFilter }) {
  await ensureCampaigns(ctx.workspaceId);
  const [facts, adAccounts] = await Promise.all([
    loadFacts(ctx, input, input.ads),
    db.adAccount.findMany({ where: { workspaceId: ctx.workspaceId }, orderBy: [{ name: "asc" }, { externalId: "asc" }], select: { id: true, externalId: true, name: true, currency: true, enabled: true, defaultProductId: true } }),
  ]);
  const view = input.revenueView ?? facts.defaults.revenueView;
  const evaluated = evaluate(facts);
  const byCreative = creativeBreakdown(facts, evaluated);

  const byExternal = new Map(facts.campaigns.map((c) => [c.externalId, c]));
  const creativeCampaign = new Map(facts.creatives.map((c) => [c.id, c.campaignId ? byExternal.get(c.campaignId)?.id ?? NO_CAMPAIGN : NO_CAMPAIGN]));
  const campaignOf = (creativeId: string | null) => (creativeId ? creativeCampaign.get(creativeId) ?? NO_CAMPAIGN : NO_CAMPAIGN);
  const accs = new Map<string, Acc>();
  const acc = (k: string) => accs.get(k) ?? accs.set(k, emptyAcc()).get(k)!;
  const productOf = new Map(facts.campaigns.map((c) => [c.id, c.productId]));

  for (const o of evaluated) {
    const k = campaignOf(o.creativeId);
    const a = acc(k);
    a.totals.push(o.totals);
    const p = productOf.get(k);
    const lineProducts = o.lines.map((l) => l.productId).filter((x): x is string => !!x);
    if (p && lineProducts.length && !lineProducts.includes(p)) a.otherProductOrders++;
  }
  for (const s of facts.spend) {
    const k = s.campaignId ? byExternal.get(s.campaignId)?.id ?? campaignOf(s.creativeId) : campaignOf(s.creativeId);
    acc(k).spend += s.spend;
  }
  for (const key of byCreative.keys) {
    const k = key === UNATTRIBUTED || key === UNMATCHED_SPEND ? NO_CAMPAIGN : campaignOf(key);
    const a = acc(k);
    a.overhead += byCreative.allocated.get(key) ?? 0;
    if (key !== UNATTRIBUTED && key !== UNMATCHED_SPEND) a.ads.add(key);
  }

  const adRows = (a: Acc): CampaignAdRow[] =>
    [...a.ads]
      .map((key) => {
        const c = byCreative.creativeIndex.get(key);
        const metrics = computeMetrics(byCreative.totalsByCreative.get(key) ?? sumTotals([]), byCreative.spendByCreative.get(key) ?? 0, byCreative.allocated.get(key) ?? 0, view);
        return { key, externalCreativeId: c?.externalCreativeId ?? null, name: c?.name ?? null, metrics, verdict: creativeVerdict(metrics, facts.thresholds) };
      })
      .sort((x, y) => y.metrics.adSpend - x.metrics.adSpend || y.metrics.placed - x.metrics.placed);

  // An unlinked campaign whose ads all have the same product counts for that product through them.
  const adProducts = new Map<string, Set<string | null>>();
  for (const c of facts.creatives) if (c.campaignId) adProducts.set(c.campaignId, (adProducts.get(c.campaignId) ?? new Set()).add(c.productId));
  const fromAds = (externalId: string) => {
    const set = adProducts.get(externalId);
    return set?.size === 1 ? [...set][0] : null;
  };

  const filter = input.adAccountId;
  const inScope = (c: CampaignInfo) => !filter || (filter === NO_ACCOUNT ? !c.adAccountId : c.adAccountId === filter);
  const rows: CampaignRow[] = facts.campaigns.filter(inScope).map((c) => {
    const a = accs.get(c.id) ?? emptyAcc();
    const metrics = computeMetrics(sumTotals(a.totals), a.spend, a.overhead, view);
    const viaAds = c.productSource ? null : fromAds(c.externalId);
    return {
      key: c.id,
      kind: "CAMPAIGN",
      campaignId: c.id,
      externalId: c.externalId,
      name: c.name,
      adAccountId: c.adAccountId,
      status: c.status,
      running: (c.status !== null && RUNNING_STATUSES.has(c.status)) || a.spend > 0,
      productId: c.productId ?? viaAds,
      ownProductId: c.ownProductId,
      productSource: c.productSource ?? (viaAds ? "ADS" : null),
      metrics,
      verdict: metrics.placed > 0 || metrics.adSpend > 0 ? creativeVerdict(metrics, facts.thresholds) : null,
      otherProductOrders: a.otherProductOrders,
      ads: adRows(a),
    };
  });
  rows.sort((x, y) => Number(y.running) - Number(x.running) || y.metrics.adSpend - x.metrics.adSpend || y.metrics.placed - x.metrics.placed || (x.name ?? "").localeCompare(y.name ?? ""));
  const loose = accs.get(NO_CAMPAIGN);
  if (!filter && !facts.adScoped && loose && (loose.totals.length || loose.spend)) {
    rows.push({
      key: NO_CAMPAIGN,
      kind: "NO_CAMPAIGN",
      campaignId: null,
      externalId: null,
      name: "Not linked to a campaign",
      adAccountId: null,
      status: null,
      running: false,
      productId: null,
      ownProductId: null,
      productSource: null,
      metrics: computeMetrics(sumTotals(loose.totals), loose.spend, loose.overhead, view),
      verdict: null,
      otherProductOrders: 0,
      ads: adRows(loose),
    });
  }

  // Everything in scope for the period, running or not.
  const scoped = rows.map((r) => (r.kind === "NO_CAMPAIGN" ? loose! : accs.get(r.key) ?? emptyAcc()));
  const total = computeMetrics(sumTotals(scoped.flatMap((a) => a.totals)), scoped.reduce((x, a) => x + a.spend, 0), scoped.reduce((x, a) => x + a.overhead, 0), view);

  const known = new Map(adAccounts.map((a) => [a.externalId, a]));
  const accounts = [
    ...adAccounts.map((a) => ({ id: a.id, externalId: a.externalId, name: a.name, enabled: a.enabled, defaultProductId: a.defaultProductId })),
    // Accounts only known from spend rows, e.g. before a token that reads them was saved.
    ...[...new Set(facts.campaigns.map((c) => c.adAccountId).filter((x): x is string => !!x && !known.has(x)))].sort().map((externalId) => ({ id: null, externalId, name: null, enabled: true, defaultProductId: null })),
  ].map((a) => {
    const mine = facts.campaigns.filter((c) => c.adAccountId === a.externalId);
    return { ...a, campaigns: mine.length };
  });
  const unassigned = facts.campaigns.filter((c) => !c.adAccountId).length;

  return {
    currency: facts.currency,
    revenueView: view,
    thresholds: facts.thresholds,
    accounts,
    /** Campaigns whose ad account is unknown (spend imported from a CSV). */
    unassignedCampaigns: unassigned,
    total,
    rows,
  };
}
