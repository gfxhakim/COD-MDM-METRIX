"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CircleDot, Link2Off } from "lucide-react";
import Link from "next/link";
import { Tooltip } from "@/components/ui/tooltip";
import { useT } from "@/i18n/client";
import { useTRPC } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

/** Always-visible data freshness + data quality indicator. */
export function DataFreshness() {
  const trpc = useTRPC();
  const { t, dateTime, ago } = useT();
  const { data } = useQuery({ ...trpc.workspace.dataHealth.queryOptions(), refetchInterval: 60_000 });
  if (!data) return <span className="whitespace-nowrap text-xs text-subtle">{t("Checking data…")}</span>;
  const issues = data.unmatchedRecords + data.unknownStatusParcels + data.failedSyncItems;
  const connected = data.connectionStatus === "CONNECTED";
  return (
    <div className="flex items-center gap-2 text-xs">
      <Tooltip content={connected ? t("Last successful MDM sync: {when}", { when: dateTime(data.lastSuccessfulSyncAt) }) : t("MDM Express is not connected. Parcel data may be missing or stale.")}>
        <Link href="/syncs" className={cn("inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-full px-3.5 font-medium shadow-card", connected ? "bg-surface text-muted hover:text-fg" : "bg-warning-soft text-warning")}>
          {connected ? <CircleDot className="size-3 rounded-full text-positive shadow-[0_0_8px_rgb(34_197_94/0.7)]" /> : <Link2Off className="size-3.5" />}
          <span>MDM</span>
          {connected ? (data.lastSuccessfulSyncAt ? t("synced {ago}", { ago: ago(data.lastSuccessfulSyncAt) }) : t("connected, not synced yet")) : data.connectionStatus === "ERROR" ? t("error") : t("not connected")}
        </Link>
      </Tooltip>
      {issues > 0 ? (
        <Tooltip content={t("{unmatched} unmatched records, {unknown} parcels with unknown status, {failed} failed sync items.", { unmatched: data.unmatchedRecords, unknown: data.unknownStatusParcels, failed: data.failedSyncItems })}>
          <Link href="/syncs" className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full bg-brand-soft px-3.5 font-semibold text-brand-strong shadow-card">
            <AlertTriangle className="size-3.5" /> {issues} <span className="hidden sm:inline lg:hidden 2xl:inline">{t("need review")}</span>
          </Link>
        </Tooltip>
      ) : null}
    </div>
  );
}
