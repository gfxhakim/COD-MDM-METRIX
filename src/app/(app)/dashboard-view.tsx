"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Boxes, FileWarning, Link2Off, MapPin, Unlink } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { Term } from "@/components/ui/tooltip";
import { errorMessage, useTRPC } from "@/lib/trpc/client";
import { cn, formatDateTime, formatPercent, timeAgo } from "@/lib/utils";

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

function FunnelStep({ label, value, rate, rateLabel, tone, definition }: { label: string; value: number; rate?: number | null; rateLabel?: string; tone: string; definition: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 rounded-lg border border-border bg-surface-2 p-4">
      <span className="text-xs text-muted"><Term label={label} definition={definition} /></span>
      <span className={cn("num text-2xl font-semibold", tone)}>{value.toLocaleString("en-US")}</span>
      {rateLabel ? (
        <span className="text-[11px] text-subtle">
          {rateLabel} <span className="num text-muted">{rate === null || rate === undefined ? "Not enough data" : formatPercent(rate)}</span>
        </span>
      ) : <span className="text-[11px] text-subtle">&nbsp;</span>}
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
  const range = { from: from ? new Date(from) : undefined, to: to ? new Date(`${to}T23:59:59`) : undefined };
  const counts = useQuery(trpc.workspace.operationalCounts.queryOptions(range));
  const health = useQuery(trpc.workspace.dataHealth.queryOptions());

  const c = counts.data;
  const shipped = c ? ["SHIPPED", "DELIVERED", "RETURNED", "LOST", "EXCHANGED"].reduce((a, s) => a + (c.parcelsByStatus[s] ?? 0), 0) : 0;
  const delivered = c?.parcelsByStatus.DELIVERED ?? 0;
  const returned = c?.parcelsByStatus.RETURNED ?? 0;
  const maxWilaya = Math.max(1, ...(c?.wilayas.map((w) => w.orders) ?? [1]));

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Placed orders are not profit. Follow each order through confirmation, shipping and delivery."
        actions={
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor="from">From</label>
            <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
            <span className="text-subtle">→</span>
            <label className="sr-only" htmlFor="to">To</label>
            <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
          </div>
        }
      />

      {counts.error ? <ErrorState message={errorMessage(counts.error)} /> : null}

      <Card>
        <CardHeader title="Order → parcel funnel" description="Orders and parcels are counted separately: one order can ship as several parcels." />
        <CardBody>
          {!c ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</div>
          ) : c.placed === 0 ? (
            <EmptyState icon={<Boxes />} title="No orders in this period" description="Import orders or add one manually to start tracking the funnel." action={<Link className="text-sm text-positive hover:underline" href="/orders">Go to orders</Link>} />
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <FunnelStep label="Placed" value={c.placed} tone="text-fg" definition="Distinct imported or manually created orders." />
              <FunnelStep label="Confirmed" value={c.confirmed} rate={ratio(c.confirmed, c.placed)} rateLabel="Confirmation" tone="text-info" definition="Orders with an explicit confirmation. Confirmation rate = confirmed ÷ placed." />
              <FunnelStep label="Shipped" value={shipped} rate={ratio(shipped, c.confirmed)} rateLabel="Shipping" tone="text-warning" definition="Parcels dispatched into the carrier flow (in transit, delivered, returned, lost or exchanged). Shipping rate = shipped ÷ confirmed." />
              <FunnelStep label="Delivered" value={delivered} rate={ratio(delivered, shipped)} rateLabel="Delivery" tone="text-positive" definition="Parcels with a delivered status. Delivery rate = delivered ÷ shipped." />
              <FunnelStep label="Returned" value={returned} rate={ratio(returned, shipped)} rateLabel="RTO" tone="text-negative" definition="Parcels returned to origin. RTO rate = returned ÷ shipped." />
            </div>
          )}
        </CardBody>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Profit metrics" description="Net cash collected, cash in transit, true net profit and POAS." />
          <CardBody>
            <EmptyState
              icon={<AlertTriangle />}
              title="Economics engine arrives in Milestone 2"
              description="Profit, POAS, CPDO and cash-in-transit will be calculated server-side from stored facts (orders, parcels, spend, cost versions and expenses), never from browser-side formulas."
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Data health" description="What could make these numbers wrong." />
          <CardBody className="flex flex-col gap-1 p-3">
            {!health.data ? (
              <Skeleton className="h-40" />
            ) : (
              <>
                <HealthRow icon={<Link2Off />} label="MDM connection" value={health.data.connectionStatus === "CONNECTED" ? `synced ${timeAgo(health.data.lastSuccessfulSyncAt)}` : health.data.connectionStatus.replace("_", " ").toLowerCase()} href="/settings?tab=mdm" tone={health.data.connectionStatus === "CONNECTED" ? undefined : "warning"} />
                <HealthRow icon={<Unlink />} label="Unmatched records" value={health.data.unmatchedRecords} href="/syncs" tone={health.data.unmatchedRecords ? "negative" : undefined} />
                <HealthRow icon={<AlertTriangle />} label="Unknown parcel statuses" value={health.data.unknownStatusParcels} href="/orders?parcelStatus=UNKNOWN" tone={health.data.unknownStatusParcels ? "negative" : undefined} />
                <HealthRow icon={<FileWarning />} label="Import row errors" value={health.data.importRowErrors} href="/imports" tone={health.data.importRowErrors ? "warning" : undefined} />
                <HealthRow icon={<FileWarning />} label="Unmatched ad spend rows" value={health.data.unmatchedSpendRows} href="/creatives" tone={health.data.unmatchedSpendRows ? "warning" : undefined} />
                <HealthRow icon={<FileWarning />} label="Bank rows awaiting review" value={health.data.pendingBankRows} href="/expenses" tone={health.data.pendingBankRows ? "warning" : undefined} />
                <p className="px-2 pt-2 text-[11px] text-subtle">
                  Last successful MDM sync: {formatDateTime(health.data.lastSuccessfulSyncAt)}
                </p>
              </>
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Orders by wilaya" description="Top destinations in the selected period." />
        <CardBody>
          {!c ? <Skeleton className="h-40" /> : c.wilayas.length === 0 ? (
            <EmptyState icon={<MapPin />} title="No wilaya data yet" />
          ) : (
            <ul className="flex flex-col gap-2.5">
              {c.wilayas.map((w) => (
                <li key={w.wilaya} className="grid grid-cols-[8rem_1fr_3rem] items-center gap-3 text-sm">
                  <span className="truncate text-muted">{w.wilaya}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-surface-3">
                    <span className="block h-full rounded-full bg-mint/70" style={{ width: `${(w.orders / maxWilaya) * 100}%` }} />
                  </span>
                  <span className="num text-right">{w.orders}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </>
  );
}
