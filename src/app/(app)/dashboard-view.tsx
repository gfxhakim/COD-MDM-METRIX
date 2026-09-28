"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Boxes, FileWarning, Link2Off, Unlink } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Money, Rate, Ratio } from "@/components/app/format";
import { PageHeader } from "@/components/app/page-header";
import { Sparkline } from "@/components/app/sparkline";
import { VerdictBadge } from "@/components/app/verdict";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { Term } from "@/components/ui/tooltip";
import { DEF } from "@/lib/definitions";
import { formatMoney } from "@/lib/money";
import { errorMessage, useTRPC } from "@/lib/trpc/client";
import { cn, formatDateTime, formatPercent, timeAgo } from "@/lib/utils";

type RevenueView = "DELIVERED" | "REMITTED";

function Kpi({ label, def, children, tone, sub, spark }: { label: string; def: string; children: React.ReactNode; tone?: string; sub?: React.ReactNode; spark?: React.ReactNode }) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <span className="text-xs text-muted"><Term label={label} definition={def} /></span>
      <span className={cn("num text-xl font-semibold tracking-tight sm:text-2xl", tone)}>{children}</span>
      {sub ? <span className="text-[11px] text-subtle">{sub}</span> : null}
      {spark ? <div className="mt-1">{spark}</div> : null}
    </Card>
  );
}

function FunnelStep({ label, value, rate, rateLabel, tone, def, width }: { label: string; value: number; rate?: number | null; rateLabel?: string; tone: string; def: string; width: number }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-muted"><Term label={label} definition={def} /></span>
        <span className="num text-lg font-semibold">{value.toLocaleString("en-US")}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-3">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${Math.max(2, width * 100)}%` }} />
      </div>
      <span className="text-[11px] text-subtle">{rateLabel ? <>{rateLabel} <Rate value={rate} className="text-muted" /></> : " "}</span>
    </div>
  );
}

function HealthRow({ icon, label, value, href, tone }: { icon: React.ReactNode; label: string; value: React.ReactNode; href: string; tone?: "negative" | "warning" }) {
  return (
    <Link href={href} className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-surface-2">
      <span className={cn("text-muted [&_svg]:size-4", tone === "negative" && "text-negative", tone === "warning" && "text-warning")}>{icon}</span>
      <span className="flex-1 text-muted">{label}</span>
      <span className={cn("num font-medium", tone === "negative" && "text-negative", tone === "warning" && "text-warning")}>{value}</span>
      <ArrowRight className="size-3.5 text-subtle" />
    </Link>
  );
}

export function DashboardView() {
  const trpc = useTRPC();
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [productId, setProductId] = React.useState("");
  const [creativeId, setCreativeId] = React.useState("");
  const [view, setView] = React.useState<RevenueView | "">("");
  const facets = useQuery(trpc.orders.facets.queryOptions());
  const report = useQuery({
    ...trpc.reports.dashboard.queryOptions({
      from: from ? new Date(`${from}T00:00:00Z`) : undefined,
      to: to ? new Date(`${to}T23:59:59Z`) : undefined,
      productId: productId || undefined,
      creativeId: creativeId || undefined,
      revenueView: view || undefined,
    }),
    placeholderData: keepPreviousData,
  });
  const r = report.data;
  const m = r?.metrics;
  const cur = r?.currency ?? "DZD";
  const fmt = (v: number) => formatMoney(v, cur);
  const labels = r?.series.map((s) => s.date) ?? [];
  const h = r?.health;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Placed orders are not profit. This view follows every order through confirmation, shipping, delivery and cash."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Input aria-label="From date" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-38" />
            <span className="text-subtle" aria-hidden>→</span>
            <Input aria-label="To date" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-38" />
            <Select aria-label="Product" value={productId} onChange={(e) => { setProductId(e.target.value); setCreativeId(""); }} className="w-40">
              <option value="">All products</option>
              {facets.data?.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <Select aria-label="Creative" value={creativeId} onChange={(e) => setCreativeId(e.target.value)} className="w-40">
              <option value="">All creatives</option>
              {facets.data?.creatives.map((c) => <option key={c.id} value={c.id}>{c.externalCreativeId}</option>)}
            </Select>
            <Select aria-label="Revenue basis" value={view || r?.revenueView || "DELIVERED"} onChange={(e) => setView(e.target.value as RevenueView)} className="w-52">
              <option value="DELIVERED">Delivered revenue view</option>
              <option value="REMITTED">Cash remitted view</option>
            </Select>
          </div>
        }
      />

      {report.error ? <ErrorState message={errorMessage(report.error)} /> : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-7">
        {!m ? Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-28" />) : (
          <>
            <Kpi label="True net profit" def={DEF.trueNetProfit} tone={m.trueNetProfit < 0 ? "text-negative" : "text-positive"} sub={`Based on ${m.revenueView === "DELIVERED" ? "delivered revenue" : "cash remitted"}`}>{fmt(m.trueNetProfit)}</Kpi>
            <Kpi label="Blended POAS" def={DEF.truePoas} tone={m.truePoas !== null && m.truePoas < 0 ? "text-negative" : undefined} sub={m.truePoas === null ? "Not enough data" : "profit ÷ ad spend"}>{m.truePoas === null ? "—" : m.truePoas.toFixed(2)}</Kpi>
            <Kpi label="Net cash collected" def={DEF.netCashCollected} sub={m.deliveredRevenue > 0 ? `${formatPercent(m.remittedCash / m.deliveredRevenue, 0)} of delivered remitted` : undefined}>{fmt(m.remittedCash)}</Kpi>
            <Kpi label="Cash in transit" def={DEF.cashInTransit} tone="text-warning" sub={`${m.inTransit} parcels`}>{fmt(m.cashInTransit)}</Kpi>
            <Kpi label="Delivered revenue" def={DEF.deliveredRevenue} sub={`${m.delivered} parcels`} spark={<Sparkline ariaLabel="Delivered parcels per day" values={r.series.map((s) => s.delivered)} labels={labels} format={(v) => `${v} delivered`} color="var(--color-positive)" />}>{fmt(m.deliveredRevenue)}</Kpi>
            <Kpi label="Ad spend" def={DEF.adSpend} sub={<>CPDO <Money value={m.cpdo} currency={cur} /></>} spark={<Sparkline ariaLabel="Ad spend per day" values={r.series.map((s) => s.adSpend)} labels={labels} format={fmt} color="var(--color-info)" />}>{fmt(m.adSpend)}</Kpi>
            <Kpi label="RTO loss" def={DEF.rtoLoss} tone="text-negative" sub={`${m.returned} returned`}>{fmt(m.rtoLoss)}</Kpi>
          </>
        )}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Order → parcel funnel" description="Orders and parcels are counted separately: one order can ship as several parcels." />
          <CardBody>
            {!m ? <Skeleton className="h-24" /> : m.placed === 0 ? (
              <EmptyState icon={<Boxes />} title="No orders in this period" description="Change the filters, import orders, or add one manually." />
            ) : (
              <div className="grid grid-cols-2 gap-5 md:grid-cols-5">
                <FunnelStep label="Placed" value={m.placed} width={1} tone="bg-fg/60" def="Distinct orders placed in the period." />
                <FunnelStep label="Confirmed" value={m.confirmed} width={m.confirmed / m.placed} rate={m.confirmationRate} rateLabel="Confirmation" tone="bg-info" def={DEF.confirmationRate} />
                <FunnelStep label="Shipped" value={m.shipped} width={m.shipped / m.placed} rate={m.shippingRate} rateLabel="Shipping" tone="bg-warning" def="Parcels that entered the carrier flow. Shipping rate = shipped ÷ confirmed." />
                <FunnelStep label="Delivered" value={m.delivered} width={m.delivered / m.placed} rate={m.deliveryRate} rateLabel="Delivery" tone="bg-positive" def={DEF.deliveryRate} />
                <FunnelStep label="Returned" value={m.returned} width={m.returned / m.placed} rate={m.returnRate} rateLabel="RTO" tone="bg-negative" def={DEF.returnRate} />
              </div>
            )}
            {m && (m.unknownStatus > 0 || m.missingCostOrders > 0) ? (
              <p className="mt-4 flex items-center gap-2 text-xs text-warning">
                <AlertTriangle className="size-3.5" />
                {m.unknownStatus > 0 ? `${m.unknownStatus} parcels have an unknown carrier status and are not counted as delivered or returned. ` : ""}
                {m.missingCostOrders > 0 ? `${m.missingCostOrders} orders have no cost version for their date; their COGS is counted as 0.` : ""}
              </p>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Profit breakdown" description={m ? `Revenue basis: ${m.revenueView === "DELIVERED" ? "delivered revenue" : "cash remitted"}` : undefined} />
          <CardBody className="p-3">
            {!m ? <Skeleton className="h-48" /> : (
              <dl className="flex flex-col text-sm">
                {[
                  ["Revenue", m.revenue, DEF.deliveredRevenue],
                  ["Ad spend", -m.adSpend, DEF.adSpend],
                  ["COGS", -m.cogs, DEF.cogs],
                  ["Outbound shipping", -m.outboundShipping, "Forward shipping on every shipped parcel (observed carrier fee when available)."],
                  ["RTO fees", -m.rtoCost, "RTO fee on returned parcels."],
                  ["Call center", -m.callCenterCost, "Call-center fee × the configured basis (lead, confirmed order or call attempt)."],
                  ["Packaging", -m.packagingCost, "Packaging fee on every shipped parcel."],
                  ["Overhead", -m.allocatedOverhead, DEF.overhead],
                ].map(([label, v, def]) => (
                  <div key={label as string} className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-surface-2">
                    <dt className="text-muted"><Term label={label as string} definition={def as string} /></dt>
                    <dd className={cn("num", (v as number) < 0 ? "text-fg" : "text-positive")}>{fmt(v as number)}</dd>
                  </div>
                ))}
                <div className="mt-1 flex items-center justify-between border-t border-border px-2 pt-2 font-semibold">
                  <dt>True net profit</dt>
                  <dd className={cn("num", m.trueNetProfit < 0 ? "text-negative" : "text-positive")}>{fmt(m.trueNetProfit)}</dd>
                </div>
              </dl>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2 2xl:grid-cols-3">
        <Card>
          <CardHeader title="Top profitable creatives" actions={<Link href="/creatives" className="text-xs text-positive hover:underline">Matrix</Link>} />
          {!r ? <Skeleton className="m-4 h-40" /> : r.topCreatives.length === 0 ? <EmptyState title="No attributed orders" /> : (
            <Table>
              <THead><tr><Th>Creative</Th><Th className="text-right">Profit</Th><Th className="text-right">POAS</Th><Th>Verdict</Th></tr></THead>
              <tbody>
                {r.topCreatives.map((c) => (
                  <Tr key={c.key}><Td className="font-mono text-xs">{c.externalCreativeId}</Td><Td className="text-right"><Money value={c.trueNetProfit} currency={cur} signed /></Td><Td className="text-right"><Ratio value={c.truePoas} /></Td><Td><VerdictBadge verdict={c.verdict} /></Td></Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader title="Worst RTO creatives" description="Cheap orders that come back cost twice." />
          {!r ? <Skeleton className="m-4 h-40" /> : r.worstRtoCreatives.length === 0 ? <EmptyState title="No shipped parcels yet" /> : (
            <Table>
              <THead><tr><Th>Creative</Th><Th className="text-right">RTO</Th><Th className="text-right">Returned</Th></tr></THead>
              <tbody>
                {r.worstRtoCreatives.map((c) => (
                  <Tr key={c.key}>
                    <Td className="font-mono text-xs">{c.externalCreativeId} {c.belowSample ? <Badge className="ml-1" title="Fewer shipped parcels than the BAD TRAFFIC threshold">small n</Badge> : null}</Td>
                    <Td className="text-right"><Rate value={c.returnRate} className={(c.returnRate ?? 0) > 0.3 ? "text-negative" : undefined} /></Td>
                    <Td className="num text-right text-muted">{c.returned}/{c.shipped}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader title="Data health" description="What could make these numbers wrong." />
          <CardBody className="flex flex-col gap-1 p-3">
            {!h ? <Skeleton className="h-40" /> : (
              <>
                <HealthRow icon={<Link2Off />} label="MDM connection" value={h.connectionStatus === "CONNECTED" ? `synced ${timeAgo(h.lastSuccessfulSyncAt)}` : h.connectionStatus.replace("_", " ").toLowerCase()} href="/settings?tab=mdm" tone={h.connectionStatus === "CONNECTED" ? undefined : "warning"} />
                <HealthRow icon={<Unlink />} label="Unmatched records" value={h.unmatchedRecords} href="/syncs" tone={h.unmatchedRecords ? "negative" : undefined} />
                <HealthRow icon={<AlertTriangle />} label="Unknown parcel statuses" value={h.unknownStatusParcels} href="/orders?parcelStatus=UNKNOWN" tone={h.unknownStatusParcels ? "negative" : undefined} />
                <HealthRow icon={<FileWarning />} label="Import / sync errors" value={h.importRowErrors + h.failedSyncItems} href="/imports" tone={h.importRowErrors + h.failedSyncItems ? "warning" : undefined} />
                <HealthRow icon={<FileWarning />} label="Unmatched ad spend rows" value={h.unmatchedSpendRows} href="/creatives" tone={h.unmatchedSpendRows ? "warning" : undefined} />
                <HealthRow icon={<FileWarning />} label="Bank rows awaiting review" value={h.pendingBankRows} href="/expenses" tone={h.pendingBankRows ? "warning" : undefined} />
                <p className="px-2 pt-2 text-[11px] text-subtle">Last successful MDM sync: {formatDateTime(h.lastSuccessfulSyncAt)}</p>
              </>
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="By wilaya" description="Contribution before ads = revenue − COGS − shipping − RTO − call center − packaging. Ad spend is not split by wilaya." />
        {!r ? <Skeleton className="m-4 h-40" /> : r.wilayas.length === 0 ? <EmptyState title="No wilaya data" /> : (
          <Table>
            <THead><tr><Th>Wilaya</Th><Th className="text-right">Placed</Th><Th className="text-right">Shipped</Th><Th className="text-right">Delivery rate</Th><Th className="text-right">RTO rate</Th><Th className="text-right">Delivered revenue</Th><Th className="text-right">Contribution before ads</Th></tr></THead>
            <tbody>
              {r.wilayas.map((w) => (
                <Tr key={w.wilaya}>
                  <Td>{w.wilaya}</Td>
                  <Td className="num text-right">{w.placed}</Td>
                  <Td className="num text-right">{w.shipped}</Td>
                  <Td className="text-right"><Rate value={w.deliveryRate} /></Td>
                  <Td className="text-right"><Rate value={w.returnRate} className={(w.returnRate ?? 0) > 0.3 ? "text-negative" : undefined} /></Td>
                  <Td className="text-right"><Money value={w.deliveredRevenue} currency={cur} /></Td>
                  <Td className="text-right"><Money value={w.contributionBeforeAds} currency={cur} signed /></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
