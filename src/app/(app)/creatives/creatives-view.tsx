"use client";

import { useMoney } from "@/components/app/currency";
import type { CurrencyCode } from "@/lib/money";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Columns3, Download, Link2, Megaphone } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Money, Rate, Ratio } from "@/components/app/format";
import { AdsFilter, useAdsFilter } from "@/components/app/ads-filter";
import { MoreDetailsButton, useMoreDetails } from "@/components/app/more-details";
import { PageHeader } from "@/components/app/page-header";
import { VERDICT_LABEL, VerdictBadge, type VerdictValue } from "@/components/app/verdict";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { useSlidingPill } from "@/components/ui/sliding-pill";
import { EmptyState, ErrorState, Loading } from "@/components/ui/states";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { HelpTip, Term } from "@/components/ui/tooltip";
import { ALL_PRODUCTS, EACH_PRODUCT, NO_PRODUCT, inProductPick, productSections, type ProductSection } from "@/domain/creativeProducts";
import type { Metrics } from "@/domain/economics";
import { MATRIX_COLUMNS, type MatrixColumnKey } from "@/domain/matrixColumns";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/core";
import { DEF } from "@/lib/definitions";
import { errorMessage, useTRPC } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

const COLUMN_DEFS: Partial<Record<MatrixColumnKey, string>> = {
  product: msg("The product the ad sells: the one its campaign or ad account is linked to, else the product most of its orders are for."),
  placedCpa: DEF.placedCpa, cpco: DEF.cpco, cpdo: DEF.cpdo, confirmationRate: DEF.confirmationRate, deliveryRate: DEF.deliveryRate,
  returnRate: DEF.returnRate, trueNetProfit: DEF.trueNetProfit, truePoas: DEF.truePoas, verdict: DEF.verdict,
  revenue: msg("Delivered revenue or remitted cash, depending on the selected view."),
};
/** How the footer words the overhead policy picked in Settings. */
const OVERHEAD_POLICY: Record<string, string> = { NONE: msg("none"), BY_DELIVERED_ORDERS: msg("by delivered orders"), BY_REVENUE: msg("by revenue") };
/** A beginner sees what each ad spent, what it brought and what it earned; the rest is under Columns. */
const DEFAULT_HIDDEN: MatrixColumnKey[] = ["campaign", "confirmed", "confirmationRate", "cpco", "shipped", "deliveryRate", "returned", "cpdo", "revenue"];
// v2: the shorter default above applies once, even where columns were picked before.
const STORAGE_KEY = "cft.matrix.columns.v2";

function loadHidden(): MatrixColumnKey[] {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v ? (JSON.parse(v) as MatrixColumnKey[]) : DEFAULT_HIDDEN;
  } catch {
    return DEFAULT_HIDDEN;
  }
}

type Row = {
  key: string;
  kind: "CREATIVE" | "UNATTRIBUTED" | "UNMATCHED_SPEND";
  externalCreativeId: string | null;
  name: string | null;
  campaignName: string | null;
  verdict: VerdictValue | null;
  product: { id: string; source: "LINK" | "ORDERS" } | null;
  metrics: Metrics;
};
type Column = (typeof MATRIX_COLUMNS)[number];
type Sort = { key: MatrixColumnKey; dir: "asc" | "desc" };

function sortValue(r: Row, key: MatrixColumnKey, productName: (id: string) => string): number | string {
  if (key === "creative") return r.externalCreativeId ?? r.name ?? "";
  if (key === "product") return r.product ? productName(r.product.id) : "";
  if (key === "campaign") return r.campaignName ?? "";
  if (key === "verdict") return r.verdict ?? "";
  const v = r.metrics[key];
  return typeof v === "number" ? v : Number.NEGATIVE_INFINITY;
}

/** The line under an ad that sits with a product only because of its orders. */
function ByOrders() {
  const { t } = useT();
  return <span className="text-[11px] font-medium text-warning">{t("Matched by its orders")}</span>;
}

function Cell({ row, col, currency, productName, sectioned }: { row: Row; col: Column; currency: string; productName: (id: string) => string; sectioned: boolean }) {
  const { t } = useT();
  const m = row.metrics;
  switch (col.key) {
    case "creative":
      return row.kind === "CREATIVE" ? (
        <span className="flex flex-col">
          <span className="font-mono text-xs">{row.externalCreativeId}</span>
          <span className="max-w-48 truncate text-[11px] text-subtle">{row.name}</span>
          {sectioned && row.product?.source === "ORDERS" ? <ByOrders /> : null}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1">
          <Badge tone={row.kind === "UNMATCHED_SPEND" ? "warning" : "neutral"}>{row.kind === "UNATTRIBUTED" ? t("Unattributed orders") : row.kind === "UNMATCHED_SPEND" ? t("Unmatched spend") : row.name}</Badge>
          {row.kind === "UNATTRIBUTED" ? <HelpTip label={t("Unattributed orders")}>{t("Orders with no ad ID (utm_content), or one that matches no ad yet, so no ad can claim them. They still count in your totals.")}</HelpTip> : null}
          {row.kind === "UNMATCHED_SPEND" ? <HelpTip label={t("Unmatched spend")}>{t("Ad spend whose ad ID matches no ad you know, so no ad's profit includes it. It still counts in your totals; match it on the Imports page.")}</HelpTip> : null}
        </span>
      );
    case "product":
      if (row.kind !== "CREATIVE") return null;
      return row.product ? (
        <span className="flex flex-col">
          <span className="max-w-40 truncate text-xs font-semibold">{productName(row.product.id)}</span>
          {row.product.source === "ORDERS" ? <ByOrders /> : null}
        </span>
      ) : <span className="text-xs text-subtle">{t("No product")}</span>;
    case "campaign": return <span className="max-w-48 truncate text-xs text-muted">{row.campaignName ?? "—"}</span>;
    case "verdict": return <VerdictBadge verdict={row.verdict} />;
    default: {
      const v = m[col.key] as number | null;
      if (col.kind === "money") return <Money value={v} currency={currency} signed={col.key === "trueNetProfit"} />;
      if (col.kind === "rate") return <Rate value={v} className={col.key === "returnRate" && (v ?? 0) > 0.3 ? "text-negative" : undefined} />;
      if (col.kind === "ratio") return <Ratio value={v} />;
      return <span className="num">{v ?? 0}</span>;
    }
  }
}

/** The ads' table: sortable columns, the ads, then (with every product) the orders and spend no ad claims. */
function MatrixTable({ creatives, buckets, columns, sort, onSort, currency, productName, sectioned, empty }: {
  creatives: Row[];
  buckets: Row[];
  columns: Column[];
  sort: Sort;
  onSort: (s: Sort) => void;
  currency: string;
  productName: (id: string) => string;
  sectioned: boolean;
  empty?: string;
}) {
  const { t } = useT();
  return (
    <Table className="sticky-first">
      <THead>
        <tr>
          {columns.map((c) => {
            const active = sort.key === c.key;
            return (
              <Th key={c.key} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={c.kind === "text" ? undefined : "text-end"}>
                <span className="inline-flex items-center gap-1">
                  <button type="button" className="inline-flex items-center gap-1 uppercase hover:text-fg" onClick={() => onSort({ key: c.key, dir: active && sort.dir === "desc" ? "asc" : "desc" })}>
                    {t(c.label)}
                    {active ? sort.dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : null}
                  </button>
                  {COLUMN_DEFS[c.key] ? <Term label={t(c.label)} hideLabel definition={t(COLUMN_DEFS[c.key]!)} /> : null}
                </span>
              </Th>
            );
          })}
        </tr>
      </THead>
      <tbody>
        {creatives.map((r) => (
          <Tr key={r.key}>
            {columns.map((c) => <Td key={c.key} className={c.kind === "text" ? undefined : "text-end"}><Cell row={r} col={c} currency={currency} productName={productName} sectioned={sectioned} /></Td>)}
          </Tr>
        ))}
        {creatives.length === 0 && empty ? (
          <tr><Td colSpan={columns.length} className="py-8 text-center text-muted">{empty}</Td></tr>
        ) : null}
        {buckets.map((r) => (
          <Tr key={r.key} className={cn("bg-surface-2/40", r === buckets[0] && creatives.length > 0 && "border-t-2 border-border-strong")}>
            {columns.map((c) => <Td key={c.key} className={c.kind === "text" ? undefined : "text-end"}><Cell row={r} col={c} currency={currency} productName={productName} sectioned={sectioned} /></Td>)}
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

/** A section's number: its label with an ⓘ, the number, and a line under it. */
function Tile({ label, def, value, sub }: { label: string; def: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-[18px] bg-surface-2 p-3 ring-1 ring-border/50">
      <span className="text-[11.5px] font-semibold leading-snug text-muted"><Term label={label} definition={def} /></span>
      <span className="min-w-0 truncate text-[19px] font-extrabold leading-tight tracking-[-0.02em] sm:text-[21px]">{value}</span>
      {sub ? <span className="text-[11px] leading-snug text-subtle">{sub}</span> : null}
    </div>
  );
}

/** One product's ads: what they spent, brought and earned together, then each ad. */
function ProductCard({ section, children, currency }: { section: ProductSection<Row>; children: React.ReactNode; currency: string }) {
  const { t } = useT();
  const m = section.metrics;
  const n = section.rows.length;
  const none = section.id === NO_PRODUCT;
  const name = section.name ?? t("No product");
  const linkCampaigns = <Button asChild variant="ghost" size="sm"><Link href="/campaigns"><Link2 /> {t("Link campaigns")}</Link></Button>;
  return (
    <Card role="region" aria-label={name}>
      <CardHeader
        title={name}
        help={none
          ? t("Ads not linked to a product that brought no order of a product in these days, so nothing says what they sell. Link their campaign to a product on the Campaigns page.")
          : t("This product's ads and their totals together. An ad sits here when its campaign or ad account is linked to this product, or, when it isn't linked, when most of its orders are for this product.")}
        description={n === 1 ? t("1 ad") : t("{n} ads", { n })}
        actions={none ? linkCampaigns : <Button asChild variant="ghost" size="sm"><Link href={`/profit?productId=${section.id}`}>{t("Profit tracker")}</Link></Button>}
      />
      <div className="grid grid-cols-2 gap-2 px-5 pb-4 sm:grid-cols-4">
        <Tile label={t("Spend")} def={t("What Meta spent on these ads in these days.")} value={<Money value={m.adSpend} currency={currency} />} />
        <Tile
          label={t("Orders")}
          def={t("Orders these ads brought in these days, and how many of them were delivered.")}
          value={<span className="num">{m.placed}</span>}
          sub={t("{n} delivered", { n: m.delivered })}
        />
        <Tile label={t("Meta per order")} def={t(DEF.placedCpa)} value={<Money value={m.placedCpa} currency={currency} />} />
        <Tile label={t("True net profit")} def={t(DEF.trueNetProfit)} value={<Money value={m.trueNetProfit} currency={currency} signed />} sub={<>{t("True POAS")} <Ratio value={m.truePoas} /></>} />
      </div>
      {section.fromOrders > 0 && !none ? (
        <div className="mx-5 mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-warning-soft px-3.5 py-2.5 text-[12.5px] leading-snug text-fg">
          <span className="min-w-0 flex-1">
            {section.fromOrders === 1
              ? t("1 ad is here because of its orders: its campaign isn't linked to {product}, so its spend doesn't count in that product's Profit tracker yet.", { product: name })
              : t("{n} ads are here because of their orders: their campaigns aren't linked to {product}, so their spend doesn't count in that product's Profit tracker yet.", { n: section.fromOrders, product: name })}
          </span>
          {linkCampaigns}
        </div>
      ) : null}
      <div className="border-t border-border">{children}</div>
    </Card>
  );
}

/** Every product together, each apart, one product, or the ads with no product. */
function ProductPicker({ pick, onPick, products, showNone }: { pick: string; onPick: (p: string) => void; products: { id: string; name: string }[]; showNone: boolean }) {
  const { t } = useT();
  const { boxRef, pill } = useSlidingPill<HTMLDivElement>();
  const options = [
    { value: ALL_PRODUCTS, label: t("All products") },
    { value: EACH_PRODUCT, label: t("Each product apart") },
    ...products.map((p) => ({ value: p.id, label: p.name })),
    ...(showNone ? [{ value: NO_PRODUCT, label: t("No product") }] : []),
  ];
  return (
    <div className="mb-4 flex min-w-0 items-center gap-2">
      <div ref={boxRef} data-slide="" role="group" aria-label={t("Show the ads of")} className="no-scrollbar relative flex min-w-0 max-w-full gap-0.5 overflow-x-auto rounded-full bg-surface p-1 shadow-card">
        {pill}
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={pick === o.value}
            onClick={() => onPick(o.value)}
            className={cn("slide-item press h-8 max-w-56 shrink-0 truncate whitespace-nowrap rounded-full px-3.5 text-xs font-medium", pick === o.value ? "bg-brand glow" : "text-muted hover:bg-surface-3 hover:text-fg")}
          >
            {o.label}
          </button>
        ))}
      </div>
      <HelpTip label={t("Show the ads of")} className="shrink-0">
        {t("Pick a product to see only its ads with their totals, or Each product apart to see one part per product. An ad goes with the product its campaign or ad account is linked to, else with the product most of its orders are for.")}
      </HelpTip>
    </div>
  );
}

export function CreativesView({ initialProduct }: { initialProduct?: string }) {
  const { t } = useT();
  const money = useMoney();
  const trpc = useTRPC();
  const toast = useToast();
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [view, setView] = React.useState<"" | "DELIVERED" | "REMITTED">("");
  const [minSample, setMinSample] = React.useState(0);
  const [verdict, setVerdict] = React.useState<VerdictValue | "">("");
  const [search, setSearch] = React.useState("");
  const [sort, setSort] = React.useState<Sort>({ key: "trueNetProfit", dir: "desc" });
  const [hidden, setHidden] = React.useState<MatrixColumnKey[]>(DEFAULT_HIDDEN);
  const [showColumns, setShowColumns] = React.useState(false);
  const [pick, setPick] = React.useState(initialProduct || ALL_PRODUCTS);
  const [moreFilters, setMoreFilters] = useMoreDetails("creatives-filters");
  const showFilters = moreFilters || !!from || !!to || !!verdict || minSample > 0 || !!view;
  React.useEffect(() => setHidden(loadHidden()), []); // eslint-disable-line react-hooks/set-state-in-effect -- read per-viewer preference after hydration

  // The pick stays in the address, so a reload or a shared link opens the same products.
  const choosePick = (p: string) => {
    setPick(p);
    const url = new URL(window.location.href);
    if (p === ALL_PRODUCTS) url.searchParams.delete("product");
    else url.searchParams.set("product", p);
    window.history.replaceState(null, "", url);
  };

  const ads = useAdsFilter().filter;
  const range = { from: from ? new Date(`${from}T00:00:00Z`) : undefined, to: to ? new Date(`${to}T23:59:59Z`) : undefined, revenueView: view || undefined, ads };
  const q = useQuery({ ...trpc.creatives.matrix.queryOptions(range), placeholderData: keepPreviousData });
  const exportCsv = useMutation(
    trpc.creatives.exportCsv.mutationOptions({
      onSuccess: ({ filename, content }) => {
        const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
        const a = Object.assign(document.createElement("a"), { href: url, download: filename });
        a.click();
        URL.revokeObjectURL(url);
      },
      onError: (e) => toast("error", errorMessage(e)),
    }),
  );

  const sectioned = pick !== ALL_PRODUCTS;
  // The product column says what each ad sells when every product shows together; a product's own part doesn't need it.
  const shownColumns = MATRIX_COLUMNS.filter((c) => c.key === "creative" || !hidden.includes(c.key));
  const columns = sectioned ? shownColumns.filter((c) => c.key !== "product") : shownColumns;
  const toggleColumn = (key: MatrixColumnKey) => {
    const next = hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key];
    setHidden(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* per-viewer convenience only */ }
  };

  const data = q.data;
  const products = React.useMemo(() => data?.products ?? [], [data]);
  const productName = React.useCallback((id: string) => products.find((p) => p.id === id)?.name ?? t("Unknown product"), [products, t]);
  const rows = React.useMemo(() => {
    if (!data) return { creatives: [] as Row[], buckets: [] as Row[], anyWithoutProduct: false };
    const all = data.rows as unknown as Row[];
    const s = search.trim().toLowerCase();
    const creatives = all
      .filter((r) => r.kind === "CREATIVE")
      .filter((r) => inProductPick(r, pick))
      .filter((r) => r.metrics.placed >= minSample)
      .filter((r) => !verdict || r.verdict === verdict)
      .filter((r) => !s || `${r.externalCreativeId} ${r.name} ${r.campaignName}`.toLowerCase().includes(s))
      .sort((a, b) => {
        const va = sortValue(a, sort.key, productName), vb = sortValue(b, sort.key, productName);
        const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
        return sort.dir === "asc" ? c : -c;
      });
    return { creatives, buckets: all.filter((r) => r.kind !== "CREATIVE" && inProductPick(r, pick)), anyWithoutProduct: all.some((r) => r.kind === "CREATIVE" && !r.product) };
  }, [data, search, minSample, verdict, sort, pick, productName]);

  const cur = data?.currency ?? "DZD";
  const sections = React.useMemo(() => (sectioned && data ? productSections(rows.creatives, products, data.revenueView) : []), [sectioned, data, rows.creatives, products]);
  const policy = data ? (OVERHEAD_POLICY[data.overheadPolicy] ? t(OVERHEAD_POLICY[data.overheadPolicy]) : data.overheadPolicy.replaceAll("_", " ").toLowerCase()) : "";
  const filtersHide = !!search || !!verdict || minSample > 0;

  const toolbar = (
    <div className={cn("grid grid-cols-2 items-center gap-2 p-3 sm:flex sm:flex-wrap", !sectioned && "border-b border-border")}>
      <AdsFilter className="col-span-2" />
      <Input aria-label={t("Search creatives")} placeholder={t("Search creative or campaign")} value={search} onChange={(e) => setSearch(e.target.value)} className="col-span-2 w-full sm:w-56" />
      <MoreDetailsButton open={showFilters} onToggle={(o) => { setMoreFilters(o); if (!o) { setFrom(""); setTo(""); setVerdict(""); setMinSample(0); setView(""); } }} what="filters" className="col-span-2 justify-self-start" />
      {showFilters ? (
        <>
          <Input aria-label={t("From date")} type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full sm:w-38" />
          <Input aria-label={t("To date")} type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-full sm:w-38" />
          <Select aria-label={t("Verdict")} value={verdict} onChange={(e) => setVerdict(e.target.value as VerdictValue | "")} className="w-full sm:w-40">
            <option value="">{t("All verdicts")}</option><option value="SCALE">{t(VERDICT_LABEL.SCALE)}</option><option value="WATCH">{t(VERDICT_LABEL.WATCH)}</option><option value="BAD_TRAFFIC">{t(VERDICT_LABEL.BAD_TRAFFIC)}</option><option value="KILL">{t(VERDICT_LABEL.KILL)}</option><option value="INSUFFICIENT_DATA">{t(VERDICT_LABEL.INSUFFICIENT_DATA)}</option>
          </Select>
          <label className="flex items-center justify-between gap-2 text-xs text-muted sm:justify-start">
            <Term label={t("Min. placed")} definition={t("Hides ads with fewer orders placed in this period than this number, here and in the CSV export. Example: 5 hides ads with 0 to 4 orders.")} />
            <Input type="number" min={0} value={minSample} onChange={(e) => setMinSample(Math.max(0, Number.parseInt(e.target.value || "0", 10)))} className="w-20" />
          </label>
          <Select aria-label={t("Revenue basis")} value={view || data?.revenueView || "DELIVERED"} onChange={(e) => setView(e.target.value as "DELIVERED" | "REMITTED")} className="col-span-2 w-full sm:w-52">
            <option value="DELIVERED">{t("Delivered revenue view")}</option><option value="REMITTED">{t("Cash remitted view")}</option>
          </Select>
        </>
      ) : null}
      <div className="relative col-span-2 justify-self-end sm:ms-auto">
        <Button variant="ghost" size="sm" aria-expanded={showColumns} onClick={() => setShowColumns((s) => !s)}><Columns3 /> {t("Columns")}</Button>
        {showColumns ? (
          <div className="absolute end-0 top-full z-20 mt-1 grid w-56 gap-1 rounded-lg border border-border-strong bg-surface-2 p-2 shadow-xl">
            {MATRIX_COLUMNS.filter((c) => c.key !== "creative").map((c) => (
              <label key={c.key} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-surface-3">
                <input type="checkbox" className="size-4 accent-[#e1182c]" checked={!hidden.includes(c.key)} onChange={() => toggleColumn(c.key)} /> {t(c.label)}
              </label>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );

  const footer = data ? (
    <div className={cn("flex flex-wrap gap-x-6 gap-y-1 px-4 py-3 text-xs text-subtle", !sectioned && "border-t border-border")}>
      <span>{t("Verdict thresholds: min {n} placed · target POAS {poas} · delivery ≥ {delivery}% · RTO ≤ {rto}%", { n: data.thresholds.minSampleOrders, poas: data.thresholds.targetPoas, delivery: Math.round(data.thresholds.minDeliveryRate * 100), rto: Math.round(data.thresholds.maxRtoRate * 100) })}</span>
      <span>{data.unallocatedOverhead ? t("Overhead policy: {policy} · {amount} not allocated to any creative", { policy, amount: money.fmt(data.unallocatedOverhead, cur) }) : t("Overhead policy: {policy}", { policy })}</span>
    </div>
  ) : null;

  const table = (creatives: Row[], buckets: Row[], empty?: string) => (
    <MatrixTable creatives={creatives} buckets={buckets} columns={columns} sort={sort} onSort={setSort} currency={cur} productName={productName} sectioned={sectioned} empty={empty} />
  );
  const pickedName = pick === NO_PRODUCT ? t("No product") : products.find((p) => p.id === pick)?.name ?? t("Unknown product");

  return (
    <>
      <PageHeader
        title={t("Creative attribution matrix")}
        description={t("What each ad spent, the orders it brought and the profit it made.")}
        actions={
          <Button onClick={() => exportCsv.mutate({ ...range, columns: shownColumns.map((c) => c.key), minSample, currency: money.view as CurrencyCode, product: pick })} disabled={exportCsv.isPending}>
            <Download /> {t("Export CSV")}
          </Button>
        }
      />
      {products.length > 0 || pick !== ALL_PRODUCTS ? <ProductPicker pick={pick} onPick={choosePick} products={products} showNone={rows.anyWithoutProduct || pick === NO_PRODUCT} /> : null}
      {!sectioned ? (
        <Card>
          {toolbar}
          {q.error ? <ErrorState message={errorMessage(q.error)} /> : q.isLoading ? <Loading /> : !data?.rows.length ? (
            <EmptyState icon={<Megaphone />} title={t("No creatives or spend yet")} description={t("Import Meta spend and orders with utm_content to see creative profitability.")} />
          ) : table(rows.creatives, rows.buckets, t("No creatives match these filters."))}
          {footer}
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          <Card>{toolbar}</Card>
          {q.error ? <Card><ErrorState message={errorMessage(q.error)} /></Card> : q.isLoading ? <Card><Loading /></Card> : sections.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Megaphone />}
                title={filtersHide ? t("No creatives match these filters.") : pick === EACH_PRODUCT ? t("No creatives or spend yet") : t("No ads for {product} yet", { product: pickedName })}
                description={filtersHide ? undefined : t("Link the campaigns that sell a product to it on the Campaigns page, and its ads show here.")}
              />
            </Card>
          ) : (
            sections.map((s) => (
              <ProductCard key={s.id} section={s} currency={cur}>
                {table(s.rows, [])}
              </ProductCard>
            ))
          )}
          {pick === EACH_PRODUCT && rows.buckets.length > 0 ? (
            <Card>
              <CardHeader
                title={t("Orders and spend with no ad")}
                help={t("Orders that no ad can claim, and spend whose ad is unknown. They count in your totals, but in none of the products' ads above.")}
              />
              <div className="border-t border-border">{table([], rows.buckets)}</div>
            </Card>
          ) : null}
          {footer}
        </div>
      )}
    </>
  );
}
