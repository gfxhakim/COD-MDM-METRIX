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
import { HelpTip, Term } from "@/components/ui/tooltip";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/core";
import { DEF } from "@/lib/definitions";
import { errorMessage, useTRPC } from "@/lib/trpc/client";
import { PHONE, useMedia } from "@/lib/use-media";
import { cn } from "@/lib/utils";

const NO_ACCOUNT = "__none__";
type RevenueView = "DELIVERED" | "REMITTED";

const STATUS: Record<string, { label: string; tone: "positive" | "neutral" | "info" | "warning" }> = {
  ACTIVE: { label: msg("Active"), tone: "positive" },
  PAUSED: { label: msg("Paused"), tone: "neutral" },
  IN_PROCESS: { label: msg("Starting"), tone: "info" },
  WITH_ISSUES: { label: msg("Has issues"), tone: "warning" },
  NOT_LISTED: { label: msg("Archived or deleted"), tone: "neutral" },
};

function StatusBadge({ status, spent }: { status: string | null; spent: boolean }) {
  const { t } = useT();
  // A status Meta adds later shows as Meta sends it.
  const s = status ? (STATUS[status] ? { ...STATUS[status], label: t(STATUS[status].label) } : { label: status.replaceAll("_", " ").toLowerCase(), tone: "neutral" as const }) : null;
  if (s) return <Badge tone={s.tone}>{s.label}</Badge>;
  return spent ? <Badge tone="info">{t("Spent in period")}</Badge> : null;
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
      <Td className="text-end"><Money value={m.adSpend} currency={currency} /></Td>
      <Td className="num text-end">{m.placed}</Td>
      <Td className="num text-end">{m.delivered}</Td>
      <Td className="text-end"><Rate value={m.deliveryRate} /></Td>
      <Td className="text-end"><Money value={m.placedCpa} currency={currency} /></Td>
      <Td className="text-end"><Money value={m.trueNetProfit} currency={currency} signed /></Td>
      <Td className="text-end"><Ratio value={m.truePoas} /></Td>
    </>
  );
}

export function CampaignsView() {
  const { t, tx } = useT();
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
  const setProduct = useMutation(trpc.campaigns.setProduct.mutationOptions({ onSuccess: () => { refresh(); toast("success", t("Campaign linked")); }, onError: (e) => toast("error", errorMessage(e)) }));
  const setAccountProduct = useMutation(trpc.campaigns.setAccountProduct.mutationOptions({ onSuccess: () => { refresh(); toast("success", t("Ad account default saved")); }, onError: (e) => toast("error", errorMessage(e)) }));

  const r = report.data;
  const cur = r?.currency ?? "DZD";
  const productName = new Map((products.data ?? []).map((p) => [p.id, p.name]));
  const selected = r?.accounts.find((a) => a.externalId === account) ?? null;
  const accountName = (id: string | null) => {
    if (!id) return t("No ad account");
    const a = r?.accounts.find((x) => x.externalId === id);
    return a?.name ?? id;
  };
  const rows = (r?.rows ?? []).filter((x) => show === "all" || x.running || x.kind === "NO_CAMPAIGN");
  const hidden = (r?.rows.length ?? 0) - rows.length;
  const toggle = (key: string) => setOpen((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const m = r?.total;
  // On phones each campaign is one row: its numbers in a line under its name, its product picker below.
  const phone = useMedia(PHONE);

  return (
    <>
      <PageHeader
        title={t("Ad accounts & campaigns")}
        description={t("Each campaign's spend, orders and profit. Link a campaign to the product it sells so its spend counts in that product's profit.")}
      />
      <Card>
        <div className="grid grid-cols-2 items-center gap-2 border-b border-border p-3 sm:flex sm:flex-wrap">
          <AdsFilter className="col-span-2" />
          <Select aria-label={t("Ad account")} value={account} onChange={(e) => { setAccount(e.target.value); setOpen(new Set()); }} className="col-span-2 w-full sm:w-72">
            <option value="">{t("All ad accounts")}</option>
            {r?.accounts.map((a) => <option key={a.externalId} value={a.externalId}>{a.name ? `${a.name} (${a.externalId.replace("act_", "")})` : a.externalId}</option>)}
            {r?.unassignedCampaigns ? <option value={NO_ACCOUNT}>{t("Imported spend (no ad account)")}</option> : null}
          </Select>
          <Select aria-label={t("Campaigns shown")} value={show} onChange={(e) => setShow(e.target.value as "running" | "all")} className="col-span-2 w-full sm:w-48">
            <option value="running">{t("Running campaigns")}</option>
            <option value="all">{t("All campaigns")}</option>
          </Select>
          <Input aria-label={t("From date")} type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full sm:w-38" />
          <Input aria-label={t("To date")} type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-full sm:w-38" />
          <Select aria-label={t("Revenue basis")} value={view || r?.revenueView || "DELIVERED"} onChange={(e) => setView(e.target.value as RevenueView)} className="col-span-2 w-full sm:w-52">
            <option value="DELIVERED">{t("Delivered revenue view")}</option>
            <option value="REMITTED">{t("Cash remitted view")}</option>
          </Select>
        </div>

        {selected?.id && canLink ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 text-sm">
            <span className="flex items-center gap-1">
              <label htmlFor="acct-product" className="text-muted">{t("Campaigns in this account count for")}</label>
              <HelpTip label={t("Campaigns in this account count for")}>{t("The product this ad account sells. Its campaigns' spend then counts for that product, new campaigns too, so the product's profit and POAS include them.")}</HelpTip>
            </span>
            <Select id="acct-product" value={selected.defaultProductId ?? ""} disabled={setAccountProduct.isPending} onChange={(e) => setAccountProduct.mutate({ id: selected.id!, productId: e.target.value || null })} className="w-56">
              <option value="">{t("No default product")}</option>
              {products.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <span className="text-xs text-subtle">{t("unless a campaign below is linked to its own product.")}</span>
          </div>
        ) : selected?.defaultProductId ? (
          <p className="border-b border-border px-4 py-3 text-sm text-muted">{t("Campaigns in this account count for {product} unless linked to their own.", { product: productName.get(selected.defaultProductId) ?? t("a product") })}</p>
        ) : null}

        {m ? (
          <div className="grid grid-cols-2 border-b border-border sm:grid-cols-3 lg:grid-cols-5">
            <Stat label={t("Ad spend")} def={t(DEF.adSpend)}>{money.fmt(m.adSpend, cur)}</Stat>
            <Stat label={t("Orders placed")} def={t("Orders placed in this period from the ads of these campaigns, running or not. With all ad accounts, orders not linked to a campaign count too.")}>{m.placed.toLocaleString("en-US")}</Stat>
            <Stat label={t("Delivered")} def={t(DEF.deliveryRate)} sub={m.deliveryRate === null ? t("No finished orders yet") : t("{pct}% delivery rate", { pct: Math.round(m.deliveryRate * 100) })}>{m.delivered.toLocaleString("en-US")}</Stat>
            <Stat label={t("True net profit")} def={t(DEF.trueNetProfit)} tone={m.trueNetProfit < 0 ? "text-negative" : "text-positive"}>{money.fmt(m.trueNetProfit, cur)}</Stat>
            <Stat label="POAS" def={t(DEF.truePoas)} tone={m.truePoas !== null && m.truePoas < 0 ? "text-negative" : undefined} sub={account ? t("Whole account, this period") : t("All campaigns, this period")}>{m.truePoas === null ? "—" : m.truePoas.toFixed(2)}</Stat>
          </div>
        ) : null}

        {report.error ? <ErrorState message={errorMessage(report.error)} /> : report.isLoading ? <Loading /> : !r?.rows.length ? (
          <EmptyState
            icon={<Target />}
            title={account ? t("No campaigns in this ad account yet") : t("No campaigns yet")}
            description={tx("Campaigns appear after a Meta sync or an ad spend import. Set up Meta in {settings}.", { settings: <Link className="underline" href="/settings?tab=meta">{t("Settings")}</Link> })}
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>{phone ? <Term label={t("Campaign")} definition={`${t("Under each campaign: what it spent, its orders and its true net profit in this period, its verdict, and the product its spend counts for.")} ${t(DEF.verdict)}`} /> : t("Campaign")}</Th>
                {phone ? null : <>
                <Th><Term label={t("Product")} definition={t("The product this campaign's spend and ads count for. A campaign's own link comes first, then its ad account's default, then the product of its ads.")} /></Th>
                <Th className="text-end">{t("Spend")}</Th>
                <Th className="text-end">{t("Orders")}</Th>
                <Th className="text-end">{t("Delivered")}</Th>
                <Th className="text-end"><Term label={t("Delivery")} definition={t(DEF.deliveryRate)} /></Th>
                <Th className="text-end"><Term label="CPA" definition={t(DEF.placedCpa)} /></Th>
                <Th className="text-end"><Term label={t("Net profit")} definition={t(DEF.trueNetProfit)} /></Th>
                <Th className="text-end"><Term label="POAS" definition={t(DEF.truePoas)} /></Th>
                <Th><Term label={t("Verdict")} definition={t(DEF.verdict)} /></Th>
                </>}
              </tr>
            </THead>
            <tbody>
              {rows.map((c) => {
                const expanded = open.has(c.key);
                const inherited = c.productSource !== "CAMPAIGN" && c.productId ? productName.get(c.productId) : null;
                const inheritedLabel = inherited ? t("From account: {product}", { product: inherited }) : null;
                const name = c.kind === "NO_CAMPAIGN" ? t("Not linked to a campaign") : c.name ?? c.externalId;
                const productControl = c.kind !== "CAMPAIGN" ? <span className="text-subtle">—</span> : canLink ? (
                  <Select aria-label={t("Product for {campaign}", { campaign: name ?? "" })} value={c.ownProductId ?? ""} disabled={setProduct.isPending} onChange={(e) => setProduct.mutate({ id: c.campaignId!, productId: e.target.value || null })} className={cn("h-8 text-xs", phone ? "w-full" : "w-52")}>
                    <option value="">{inheritedLabel ?? t("Not linked")}</option>
                    {products.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </Select>
                ) : (
                  <span className="text-xs">{c.productId ? productName.get(c.productId) : <span className="text-subtle">{t("Not linked")}</span>}{inherited ? <span className="text-subtle"> {t("(account)")}</span> : null}</span>
                );
                return (
                  <React.Fragment key={c.key}>
                    <Tr className={cn(c.kind === "NO_CAMPAIGN" && "border-t-2 border-border-strong bg-surface-2/40")}>
                      <Td className="whitespace-normal">
                        <div className="flex items-start gap-2">
                          <button type="button" className="mt-0.5 rounded p-0.5 text-muted hover:bg-surface-3 hover:text-fg disabled:opacity-30" aria-expanded={expanded} aria-label={expanded ? t("Hide ads of {campaign}", { campaign: name ?? "" }) : t("Show ads of {campaign}", { campaign: name ?? "" })} disabled={!c.ads.length} onClick={() => toggle(c.key)}>
                            {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                          </button>
                          <div className={cn("flex flex-col gap-1", phone ? "min-w-0 flex-1" : "min-w-48 max-w-80")}>
                            <span className="font-medium">{name}</span>
                            <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-subtle">
                              {c.kind === "CAMPAIGN" ? <StatusBadge status={c.status} spent={c.metrics.adSpend > 0} /> : null}
                              {c.externalId ? <span className="font-mono">{c.externalId}</span> : <span>{t("Orders without an ad ID, ads Meta hasn't reported yet, and spend without a campaign ID.")}</span>}
                              {!account && c.kind === "CAMPAIGN" ? <span>· {accountName(c.adAccountId)}</span> : null}
                              <span>· {c.ads.length === 1 ? t("1 ad") : t("{n} ads", { n: c.ads.length })}</span>
                            </span>
                            {phone ? (
                              <>
                                <span className="num flex flex-wrap items-center gap-x-1 text-[11px] text-muted">
                                  <span className="whitespace-nowrap">{t("{amount} spent", { amount: money.fmt(c.metrics.adSpend, cur) })}</span> · <span className="whitespace-nowrap">{t("{n} orders", { n: c.metrics.placed })}</span> · <span className={cn("whitespace-nowrap", c.metrics.trueNetProfit < 0 ? "text-negative" : "text-positive")}>{t("{amount} profit", { amount: money.fmt(c.metrics.trueNetProfit, cur) })}</span>
                                  {c.verdict ? <VerdictBadge verdict={c.verdict as VerdictValue | null} /> : null}
                                </span>
                                {c.kind === "CAMPAIGN" ? <span className="mt-1 block">{productControl}</span> : null}
                              </>
                            ) : null}
                            {c.otherProductOrders > 0 ? (
                              <span className="flex items-center gap-1">
                                <Badge tone="warning" className="w-fit" title={t("These orders came from this campaign's ads, but their own products don't include the campaign's product. Check the campaign's product link.")}>
                                  {c.otherProductOrders === 1 ? t("1 order for another product") : t("{n} orders for another product", { n: c.otherProductOrders })}
                                </Badge>
                                <HelpTip label={c.otherProductOrders === 1 ? t("1 order for another product") : t("{n} orders for another product", { n: c.otherProductOrders })}>{t("These orders came from this campaign's ads, but their own products don't include the campaign's product. Check the campaign's product link.")}</HelpTip>
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </Td>
                      {phone ? null : (
                        <>
                          <Td>{productControl}</Td>
                          <MetricCells m={c.metrics} currency={cur} />
                          <Td><VerdictBadge verdict={c.verdict as VerdictValue | null} /></Td>
                        </>
                      )}
                    </Tr>
                    {expanded
                      ? c.ads.map((a) => (
                          <Tr key={`${c.key}:${a.key}`} className="bg-surface-2/30 text-xs">
                            <Td className={cn(phone ? "ps-10 whitespace-normal" : "ps-12")}>
                              <span className="flex flex-col"><span className="font-mono">{a.externalCreativeId}</span><span className="max-w-64 truncate text-[11px] text-subtle">{a.name ?? t("Unnamed ad")}</span>
                                {phone ? (
                                  <span className="num mt-0.5 flex flex-wrap items-center gap-x-1 text-[11px] text-muted">
                                    <span className="whitespace-nowrap">{t("{amount} spent", { amount: money.fmt(a.metrics.adSpend, cur) })}</span> · <span className="whitespace-nowrap">{t("{n} orders", { n: a.metrics.placed })}</span> · <span className={cn("whitespace-nowrap", a.metrics.trueNetProfit < 0 ? "text-negative" : "text-positive")}>{t("{amount} profit", { amount: money.fmt(a.metrics.trueNetProfit, cur) })}</span>
                                    {a.verdict ? <VerdictBadge verdict={a.verdict as VerdictValue | null} /> : null}
                                  </span>
                                ) : null}
                              </span>
                            </Td>
                            {phone ? null : (
                              <>
                                <Td><span className="text-subtle">{t("Ad")}</span></Td>
                                <MetricCells m={a.metrics} currency={cur} />
                                <Td><VerdictBadge verdict={a.verdict as VerdictValue | null} /></Td>
                              </>
                            )}
                          </Tr>
                        ))
                      : null}
                  </React.Fragment>
                );
              })}
              {rows.length === 0 ? (
                <tr><Td colSpan={phone ? 1 : 10} className="whitespace-normal py-8 text-center text-muted">{t('No running campaigns in this period. Choose "All campaigns" to see the others.')}</Td></tr>
              ) : null}
            </tbody>
          </Table>
        )}
        {r ? (
          <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-border px-4 py-3 text-xs text-subtle">
            <span>{t("Running = on in Meta, or spent in the period.")}{show === "running" && hidden > 0 ? ` ${hidden === 1 ? t("1 other campaign hidden.") : t("{n} other campaigns hidden.", { n: hidden })}` : ""}</span>
            <span>{t("An order counts for the campaign of the ad in its utm_content.")}</span>
          </div>
        ) : null}
      </Card>
    </>
  );
}
