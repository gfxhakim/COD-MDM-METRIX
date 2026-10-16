import { computeMetrics, sumTotals, type Metrics, type RevenueView } from "@/domain/economics";

/**
 * What the Creatives page shows: every ad together, each product apart, one product (its ID), or the
 * ads that belong to no product.
 */
export const ALL_PRODUCTS = "all";
export const EACH_PRODUCT = "each";
export const NO_PRODUCT = "none";

type RowLike = {
  kind: "CREATIVE" | "UNATTRIBUTED" | "UNMATCHED_SPEND";
  product: { id: string; source: "LINK" | "ORDERS" } | null;
  metrics: Metrics;
};

/** Whether a row shows for the pick. Orders and spend without an ad show only with every product. */
export function inProductPick(row: RowLike, pick: string): boolean {
  if (pick === ALL_PRODUCTS || pick === EACH_PRODUCT) return true;
  if (row.kind !== "CREATIVE") return false;
  return pick === NO_PRODUCT ? !row.product : row.product?.id === pick;
}

export type ProductSection<R> = {
  /** The product's ID, or NO_PRODUCT. */
  id: string;
  name: string | null;
  rows: R[];
  metrics: Metrics;
  /** How many of the ads are here only because of their orders (their campaign isn't linked). */
  fromOrders: number;
};

/** One section per product, the biggest spend first, then the ads with no product. Rows keep their order. */
export function productSections<R extends RowLike>(rows: R[], products: { id: string; name: string }[], view: RevenueView): ProductSection<R>[] {
  const names = new Map(products.map((p) => [p.id, p.name]));
  const groups = new Map<string, R[]>();
  for (const r of rows) {
    if (r.kind !== "CREATIVE") continue;
    const k = r.product?.id ?? NO_PRODUCT;
    const list = groups.get(k);
    if (list) list.push(r);
    else groups.set(k, [r]);
  }
  const sections = [...groups].map(([id, list]) => ({
    id,
    name: id === NO_PRODUCT ? null : (names.get(id) ?? null),
    rows: list,
    metrics: sectionMetrics(list, view),
    fromOrders: list.filter((r) => r.product?.source === "ORDERS").length,
  }));
  const last = (s: { id: string }) => (s.id === NO_PRODUCT ? 1 : 0);
  return sections.sort((a, b) => last(a) - last(b) || b.metrics.adSpend - a.metrics.adSpend || (a.name ?? "").localeCompare(b.name ?? ""));
}

/** Several rows together: their counts, money, spend and overhead added up, then every rate worked out again. */
export function sectionMetrics(rows: { metrics: Metrics }[], view: RevenueView): Metrics {
  const spend = rows.reduce((a, r) => a + r.metrics.adSpend, 0);
  const overhead = rows.reduce((a, r) => a + r.metrics.allocatedOverhead, 0);
  return computeMetrics(sumTotals(rows.map((r) => r.metrics)), spend, overhead, view);
}
