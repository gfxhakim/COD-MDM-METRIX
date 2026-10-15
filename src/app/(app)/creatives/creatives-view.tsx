"use client";

import { useMoney } from "@/components/app/currency";
import type { CurrencyCode } from "@/lib/money";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Columns3, Download, Megaphone } from "lucide-react";
import * as React from "react";
import { Money, Rate, Ratio } from "@/components/app/format";
import { AdsFilter, useAdsFilter } from "@/components/app/ads-filter";
import { MoreDetailsButton, useMoreDetails } from "@/components/app/more-details";
import { PageHeader } from "@/components/app/page-header";
import { VERDICT_LABEL, VerdictBadge, type VerdictValue } from "@/components/app/verdict";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { EmptyState, ErrorState, Loading } from "@/components/ui/states";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { HelpTip, Term } from "@/components/ui/tooltip";
import { MATRIX_COLUMNS, type MatrixColumnKey } from "@/domain/matrixColumns";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/core";
import { DEF } from "@/lib/definitions";
import { errorMessage, useTRPC } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

const COLUMN_DEFS: Partial<Record<MatrixColumnKey, string>> = {
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

type Row = { key: string; kind: "CREATIVE" | "UNATTRIBUTED" | "UNMATCHED_SPEND"; externalCreativeId: string | null; name: string | null; campaignName: string | null; verdict: VerdictValue | null; metrics: Record<string, unknown> & { placed: number } };

function sortValue(r: Row, key: MatrixColumnKey): number | string {
  if (key === "creative") return r.externalCreativeId ?? r.name ?? "";
  if (key === "campaign") return r.campaignName ?? "";
  if (key === "verdict") return r.verdict ?? "";
  const v = r.metrics[key];
  return typeof v === "number" ? v : Number.NEGATIVE_INFINITY;
}

function Cell({ row, col, currency }: { row: Row; col: (typeof MATRIX_COLUMNS)[number]; currency: string }) {
  const { t } = useT();
  const m = row.metrics;
  switch (col.key) {
    case "creative":
      return row.kind === "CREATIVE" ? (
        <span className="flex flex-col"><span className="font-mono text-xs">{row.externalCreativeId}</span><span className="max-w-48 truncate text-[11px] text-subtle">{row.name}</span></span>
      ) : (
        <span className="inline-flex items-center gap-1">
          <Badge tone={row.kind === "UNMATCHED_SPEND" ? "warning" : "neutral"}>{row.kind === "UNATTRIBUTED" ? t("Unattributed orders") : row.kind === "UNMATCHED_SPEND" ? t("Unmatched spend") : row.name}</Badge>
          {row.kind === "UNATTRIBUTED" ? <HelpTip label={t("Unattributed orders")}>{t("Orders with no ad ID (utm_content), or one that matches no ad yet, so no ad can claim them. They still count in your totals.")}</HelpTip> : null}
          {row.kind === "UNMATCHED_SPEND" ? <HelpTip label={t("Unmatched spend")}>{t("Ad spend whose ad ID matches no ad you know, so no ad's profit includes it. It still counts in your totals; match it on the Imports page.")}</HelpTip> : null}
        </span>
      );
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

export function CreativesView() {
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
  const [sort, setSort] = React.useState<{ key: MatrixColumnKey; dir: "asc" | "desc" }>({ key: "trueNetProfit", dir: "desc" });
  const [hidden, setHidden] = React.useState<MatrixColumnKey[]>(DEFAULT_HIDDEN);
  const [showColumns, setShowColumns] = React.useState(false);
  const [moreFilters, setMoreFilters] = useMoreDetails("creatives-filters");
  const showFilters = moreFilters || !!from || !!to || !!verdict || minSample > 0 || !!view;
  React.useEffect(() => setHidden(loadHidden()), []); // eslint-disable-line react-hooks/set-state-in-effect -- read per-viewer preference after hydration

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

  const columns = MATRIX_COLUMNS.filter((c) => c.key === "creative" || !hidden.includes(c.key));
  const toggleColumn = (key: MatrixColumnKey) => {
    const next = hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key];
    setHidden(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* per-viewer convenience only */ }
  };

  const data = q.data;
  const rows = React.useMemo(() => {
    if (!data) return { creatives: [] as Row[], buckets: [] as Row[] };
    const all = data.rows as unknown as Row[];
    const s = search.trim().toLowerCase();
    const creatives = all
      .filter((r) => r.kind === "CREATIVE")
      .filter((r) => r.metrics.placed >= minSample)
      .filter((r) => !verdict || r.verdict === verdict)
      .filter((r) => !s || `${r.externalCreativeId} ${r.name} ${r.campaignName}`.toLowerCase().includes(s))
      .sort((a, b) => {
        const va = sortValue(a, sort.key), vb = sortValue(b, sort.key);
        const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
        return sort.dir === "asc" ? c : -c;
      });
    return { creatives, buckets: all.filter((r) => r.kind !== "CREATIVE") };
  }, [data, search, minSample, verdict, sort]);

  const cur = data?.currency ?? "DZD";
  const policy = data ? (OVERHEAD_POLICY[data.overheadPolicy] ? t(OVERHEAD_POLICY[data.overheadPolicy]) : data.overheadPolicy.replaceAll("_", " ").toLowerCase()) : "";
  return (
    <>
      <PageHeader
        title={t("Creative attribution matrix")}
        description={t("What each ad spent, the orders it brought and the profit it made.")}
        actions={
          <Button onClick={() => exportCsv.mutate({ ...range, columns: columns.map((c) => c.key), minSample, currency: money.view as CurrencyCode })} disabled={exportCsv.isPending}>
            <Download /> {t("Export CSV")}
          </Button>
        }
      />
      <Card>
        <div className="grid grid-cols-2 items-center gap-2 border-b border-border p-3 sm:flex sm:flex-wrap">
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
        {q.error ? <ErrorState message={errorMessage(q.error)} /> : q.isLoading ? <Loading /> : !data?.rows.length ? (
          <EmptyState icon={<Megaphone />} title={t("No creatives or spend yet")} description={t("Import Meta spend and orders with utm_content to see creative profitability.")} />
        ) : (
          <Table className="sticky-first">
            <THead>
              <tr>
                {columns.map((c) => {
                  const active = sort.key === c.key;
                  return (
                    <Th key={c.key} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={c.kind === "text" ? undefined : "text-end"}>
                      <span className="inline-flex items-center gap-1">
                        <button type="button" className="inline-flex items-center gap-1 uppercase hover:text-fg" onClick={() => setSort({ key: c.key, dir: active && sort.dir === "desc" ? "asc" : "desc" })}>
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
              {rows.creatives.map((r) => (
                <Tr key={r.key}>
                  {columns.map((c) => <Td key={c.key} className={c.kind === "text" ? undefined : "text-end"}><Cell row={r} col={c} currency={cur} /></Td>)}
                </Tr>
              ))}
              {rows.creatives.length === 0 ? (
                <tr><Td colSpan={columns.length} className="py-8 text-center text-muted">{t("No creatives match these filters.")}</Td></tr>
              ) : null}
              {rows.buckets.map((r) => (
                <Tr key={r.key} className={cn("bg-surface-2/40", r === rows.buckets[0] && "border-t-2 border-border-strong")}>
                  {columns.map((c) => <Td key={c.key} className={c.kind === "text" ? undefined : "text-end"}><Cell row={r} col={c} currency={cur} /></Td>)}
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        {data ? (
          <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-border px-4 py-3 text-xs text-subtle">
            <span>{t("Verdict thresholds: min {n} placed · target POAS {poas} · delivery ≥ {delivery}% · RTO ≤ {rto}%", { n: data.thresholds.minSampleOrders, poas: data.thresholds.targetPoas, delivery: Math.round(data.thresholds.minDeliveryRate * 100), rto: Math.round(data.thresholds.maxRtoRate * 100) })}</span>
            <span>{data.unallocatedOverhead ? t("Overhead policy: {policy} · {amount} not allocated to any creative", { policy, amount: money.fmt(data.unallocatedOverhead, cur) }) : t("Overhead policy: {policy}", { policy })}</span>
          </div>
        ) : null}
      </Card>
    </>
  );
}
