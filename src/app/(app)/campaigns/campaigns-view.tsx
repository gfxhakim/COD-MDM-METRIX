"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Target } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { useMoney } from "@/components/app/currency";
import { Money, Rate, Ratio } from "@/components/app/format";
import { AdsFilter, useAdsFilter } from "@/components/app/ads-filter";
import { PageHeader } from "@/components/app/page-header";
import { useCan } from "@/components/app/use-can";
import { VerdictBadge, type VerdictValue } from "@/components/app/verdict";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { EmptyState, ErrorState, Loading } from "@/components/ui/states";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { Term } from "@/components/ui/tooltip";
import { DEF } from "@/lib/definitions";
import { errorMessage, useTRPC } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

const NO_ACCOUNT = "__none__";
type RevenueView = "DELIVERED" | "REMITTED";

const STATUS: Record<string, { label: string; tone: "positive" | "neutral" | "info" | "warning" }> = {
  ACTIVE: { label: "Active", tone: "positive" },
  PAUSED: { label: "Paused", tone: "neutral" },
  IN_PROCESS: { label: "Starting", tone: "info" },
  WITH_ISSUES: { label: "Has issues", tone: "warning" },
  NOT_LISTED: { label: "Archived or deleted", tone: "neutral" },
};

function StatusBadge({ status, spent }: { status: string | null; spent: boolean }) {
  const s = status ? STATUS[status] ?? { label: status.replaceAll("_", " ").toLowerCase(), tone: "neutral" as const } : null;
  if (s) return <Badge tone={s.tone}>{s.label}</Badge>;
  return spent ? <Badge tone="info">Spent in period</Badge> : null;
}

function Stat({ label, def, children, tone, sub }: { label: string; def: string; children: React.ReactNode; tone?: string; sub?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 p-4">
      <span className="text-xs text-muted"><Term label={label} definition={def} /></span>
      <span className={cn("num text-lg font-semibold tracking-tight sm:text-xl", tone)}>{children}</span>
      {sub ? <span className="text-[11px] text-subtle">{sub}</span> : null}
    </div>
  );
}

type Metrics = { adSpend: number; placed: number; delivered: number; deliveryRate: number | null; placedCpa: number | null; trueNetProfit: number; truePoas: number | null };

function MetricCells({ m, currency }: { m: Metrics; currency: string }) {
  return (
    <>
      <Td className="text-right"><Money value={m.adSpend} currency={currency} /></Td>
      <Td className="num text-right">{m.placed}</Td>
      <Td className="num text-right">{m.delivered}</Td>
      <Td className="text-right"><Rate value={m.deliveryRate} /></Td>
      <Td className="text-right"><Money value={m.placedCpa} currency={currency} /></Td>
      <Td className="text-right"><Money value={m.trueNetProfit} currency={currency} signed /></Td>
      <Td className="text-right"><Ratio value={m.truePoas} /></Td>
    </>
  );
}

export function CampaignsView() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const money = useMoney();
  const canLink = useCan("catalog.write");
  const [account, setAccount] = React.useState("");
  const [show, setShow] = React.useState<"running" | "all">("running");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [view, setView] = React.useState<RevenueView | "">("");
  const [open, setOpen] = React.useState<Set<string>>(new Set());
  const ads = useAdsFilter().filter;

  const report = useQuery({
    ...trpc.campaigns.report.queryOptions({
      adAccountId: account || undefined,
      ads,
      from: from ? new Date(`${from}T00:00:00Z`) : undefined,
      to: to ? new Date(`${to}T23:59:59Z`) : undefined,
      revenueView: view || undefined,
    }),
    placeholderData: keepPreviousData,
  });
  const products = useQuery(trpc.products.list.queryOptions({ includeInactive: true }));
  const refresh = () => {
    qc.invalidateQueries({ queryKey: trpc.campaigns.report.queryKey() });
    qc.invalidateQueries({ queryKey: trpc.campaigns.links.queryKey() });
    qc.invalidateQueries({ queryKey: trpc.products.list.queryKey() });
  };
  const setProduct = useMutation(trpc.campaigns.setProduct.mutationOptions({ onSuccess: () => { refresh(); toast("success", "Campaign linked"); }, onError: (e) => toast("error", errorMessage(e)) }));
  const setAccountProduct = useMutation(trpc.campaigns.setAccountProduct.mutationOptions({ onSuccess: () => { refresh(); toast("success", "Ad account default saved"); }, onError: (e) => toast("error", errorMessage(e)) }));

  const r = report.data;
  const cur = r?.currency ?? "DZD";
  const productName = new Map((products.data ?? []).map((p) => [p.id, p.name]));
  const selected = r?.accounts.find((a) => a.externalId === account) ?? null;
  const accountName = (id: string | null) => {
    if (!id) return "No ad account";
    const a = r?.accounts.find((x) => x.externalId === id);
    return a?.name ?? id;
  };
  const rows = (r?.rows ?? []).filter((x) => show === "all" || x.running || x.kind === "NO_CAMPAIGN");
  const hidden = (r?.rows.length ?? 0) - rows.length;
  const toggle = (key: string) => setOpen((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const m = r?.total;

  return (
    <>
      <PageHeader
        title="Ad accounts & campaigns"
        description="Pick an ad account to see each of its campaigns with its own orders, spend and profit. Link a campaign to a product so its spend and ads count for that product."
      />
      <Card>
        <div className="grid grid-cols-2 items-center gap-2 border-b border-border p-3 sm:flex sm:flex-wrap">
          <AdsFilter className="col-span-2" />
          <Select aria-label="Ad account" value={account} onChange={(e) => { setAccount(e.target.value); setOpen(new Set()); }} className="col-span-2 w-full sm:w-72">
            <option value="">All ad accounts</option>
            {r?.accounts.map((a) => <option key={a.externalId} value={a.externalId}>{a.name ? `${a.name} (${a.externalId.replace("act_", "")})` : a.externalId}</option>)}
            {r?.unassignedCampaigns ? <option value={NO_ACCOUNT}>Imported spend (no ad account)</option> : null}
          </Select>
          <Select aria-label="Campaigns shown" value={show} onChange={(e) => setShow(e.target.value as "running" | "all")} className="col-span-2 w-full sm:w-48">
            <option value="running">Running campaigns</option>
            <option value="all">All campaigns</option>
          </Select>
          <Input aria-label="From date" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full sm:w-38" />
          <Input aria-label="To date" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-full sm:w-38" />
          <Select aria-label="Revenue basis" value={view || r?.revenueView || "DELIVERED"} onChange={(e) => setView(e.target.value as RevenueView)} className="col-span-2 w-full sm:w-52">
            <option value="DELIVERED">Delivered revenue view</option>
            <option value="REMITTED">Cash remitted view</option>
          </Select>
        </div>

        {selected?.id && canLink ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 text-sm">
            <label htmlFor="acct-product" className="text-muted">Campaigns in this account count for</label>
            <Select id="acct-product" value={selected.defaultProductId ?? ""} disabled={setAccountProduct.isPending} onChange={(e) => setAccountProduct.mutate({ id: selected.id!, productId: e.target.value || null })} className="w-56">
              <option value="">No default product</option>
              {products.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <span className="text-xs text-subtle">unless a campaign below is linked to its own product.</span>
          </div>
        ) : selected?.defaultProductId ? (
          <p className="border-b border-border px-4 py-3 text-sm text-muted">Campaigns in this account count for {productName.get(selected.defaultProductId) ?? "a product"} unless linked to their own.</p>
        ) : null}

        {m ? (
          <div className="grid grid-cols-2 border-b border-border sm:grid-cols-3 lg:grid-cols-5">
            <Stat label="Ad spend" def={DEF.adSpend}>{money.fmt(m.adSpend, cur)}</Stat>
            <Stat label="Orders placed" def="Orders whose ad (utm_content) belongs to these campaigns, placed in the period.">{m.placed.toLocaleString("en-US")}</Stat>
            <Stat label="Delivered" def={DEF.deliveryRate} sub={m.deliveryRate === null ? "No finished parcels yet" : `${Math.round(m.deliveryRate * 100)}% delivery rate`}>{m.delivered.toLocaleString("en-US")}</Stat>
            <Stat label="True net profit" def={DEF.trueNetProfit} tone={m.trueNetProfit < 0 ? "text-negative" : "text-positive"}>{money.fmt(m.trueNetProfit, cur)}</Stat>
            <Stat label="POAS" def={DEF.truePoas} tone={m.truePoas !== null && m.truePoas < 0 ? "text-negative" : undefined} sub={account ? "Whole account, this period" : "All campaigns, this period"}>{m.truePoas === null ? "—" : m.truePoas.toFixed(2)}</Stat>
          </div>
        ) : null}

        {report.error ? <ErrorState message={errorMessage(report.error)} /> : report.isLoading ? <Loading /> : !r?.rows.length ? (
          <EmptyState
            icon={<Target />}
            title={account ? "No campaigns in this ad account yet" : "No campaigns yet"}
            description={<>Campaigns appear after a Meta sync or an ad spend import. Set up Meta in <Link className="underline" href="/settings?tab=meta">Settings</Link>.</>}
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Campaign</Th>
                <Th><Term label="Product" definition="The product this campaign's spend and ads count for. A campaign's own link comes first, then its ad account's default, then the product of its ads." /></Th>
                <Th className="text-right">Spend</Th>
                <Th className="text-right">Orders</Th>
                <Th className="text-right">Delivered</Th>
                <Th className="text-right"><Term label="Delivery" definition={DEF.deliveryRate} /></Th>
                <Th className="text-right"><Term label="CPA" definition={DEF.placedCpa} /></Th>
                <Th className="text-right"><Term label="Net profit" definition={DEF.trueNetProfit} /></Th>
                <Th className="text-right"><Term label="POAS" definition={DEF.truePoas} /></Th>
                <Th><Term label="Verdict" definition={DEF.verdict} /></Th>
              </tr>
            </THead>
            <tbody>
              {rows.map((c) => {
                const expanded = open.has(c.key);
                const inherited = c.productSource !== "CAMPAIGN" && c.productId ? productName.get(c.productId) : null;
                const inheritedLabel = inherited ? `${c.productSource === "ACCOUNT" ? "From account" : "From its ads"}: ${inherited}` : null;
                return (
                  <React.Fragment key={c.key}>
                    <Tr className={cn(c.kind === "NO_CAMPAIGN" && "border-t-2 border-border-strong bg-surface-2/40")}>
                      <Td className="whitespace-normal">
                        <div className="flex items-start gap-2">
                          <button type="button" className="mt-0.5 rounded p-0.5 text-muted hover:bg-surface-3 hover:text-fg disabled:opacity-30" aria-expanded={expanded} aria-label={`${expanded ? "Hide" : "Show"} ads of ${c.name ?? c.externalId}`} disabled={!c.ads.length} onClick={() => toggle(c.key)}>
                            {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                          </button>
                          <div className="flex min-w-48 max-w-80 flex-col gap-1">
                            <span className="font-medium">{c.name ?? c.externalId}</span>
                            <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-subtle">
                              {c.kind === "CAMPAIGN" ? <StatusBadge status={c.status} spent={c.metrics.adSpend > 0} /> : null}
                              {c.externalId ? <span className="font-mono">{c.externalId}</span> : <span>Orders without an ad ID, ads Meta hasn&apos;t reported yet, and spend without a campaign ID.</span>}
                              {!account && c.kind === "CAMPAIGN" ? <span>· {accountName(c.adAccountId)}</span> : null}
                              <span>· {c.ads.length} ad{c.ads.length === 1 ? "" : "s"}</span>
                            </span>
                            <span className="num text-[11px] text-muted sm:hidden">
                              <span className="whitespace-nowrap">{money.fmt(c.metrics.adSpend, cur)} spent</span> · <span className="whitespace-nowrap">{c.metrics.placed} orders</span> · <span className={cn("whitespace-nowrap", c.metrics.trueNetProfit < 0 ? "text-negative" : "text-positive")}>{money.fmt(c.metrics.trueNetProfit, cur)} profit</span>
                            </span>
                            {c.otherProductOrders > 0 ? (
                              <Badge tone="warning" className="w-fit" title="These orders came from this campaign's ads, but their own products don't include the campaign's product. Check the campaign's product link.">
                                {c.otherProductOrders} order{c.otherProductOrders === 1 ? "" : "s"} for another product
                              </Badge>
                            ) : null}
                          </div>
                        </div>
                      </Td>
                      <Td>
                        {c.kind !== "CAMPAIGN" ? <span className="text-subtle">—</span> : canLink ? (
                          <Select aria-label={`Product for ${c.name ?? c.externalId}`} value={c.ownProductId ?? ""} disabled={setProduct.isPending} onChange={(e) => setProduct.mutate({ id: c.campaignId!, productId: e.target.value || null })} className="h-8 w-44 text-xs">
                            <option value="">{inheritedLabel ?? "Not linked"}</option>
                            {products.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </Select>
                        ) : (
                          <span className="text-xs">{c.productId ? productName.get(c.productId) : <span className="text-subtle">Not linked</span>}{inherited ? <span className="text-subtle"> ({c.productSource === "ACCOUNT" ? "account" : "its ads"})</span> : null}</span>
                        )}
                      </Td>
                      <MetricCells m={c.metrics} currency={cur} />
                      <Td><VerdictBadge verdict={c.verdict as VerdictValue | null} /></Td>
                    </Tr>
                    {expanded
                      ? c.ads.map((a) => (
                          <Tr key={`${c.key}:${a.key}`} className="bg-surface-2/30 text-xs">
                            <Td className="pl-12">
                              <span className="flex flex-col"><span className="font-mono">{a.externalCreativeId}</span><span className="max-w-64 truncate text-[11px] text-subtle">{a.name ?? "Unnamed ad"}</span></span>
                            </Td>
                            <Td><span className="text-subtle">Ad</span></Td>
                            <MetricCells m={a.metrics} currency={cur} />
                            <Td><VerdictBadge verdict={a.verdict as VerdictValue | null} /></Td>
                          </Tr>
                        ))
                      : null}
                  </React.Fragment>
                );
              })}
              {rows.length === 0 ? (
                <tr><Td colSpan={10} className="py-8 text-center text-muted">No running campaigns in this period. Choose &quot;All campaigns&quot; to see the others.</Td></tr>
              ) : null}
            </tbody>
          </Table>
        )}
        {r ? (
          <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-border px-4 py-3 text-xs text-subtle">
            <span>Running = on in Meta, or spent in the period.{show === "running" && hidden > 0 ? ` ${hidden} other campaign${hidden === 1 ? "" : "s"} hidden.` : ""}</span>
            <span>An order counts for the campaign of the ad in its utm_content.</span>
          </div>
        ) : null}
      </Card>
    </>
  );
}
