"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CircleDot, Link2Off } from "lucide-react";
import Link from "next/link";
import { Tooltip } from "@/components/ui/tooltip";
import { useTRPC } from "@/lib/trpc/client";
import { cn, formatDateTime, timeAgo } from "@/lib/utils";

/** Always-visible data freshness + data quality indicator. */
export function DataFreshness() {
  const trpc = useTRPC();
  const { data } = useQuery({ ...trpc.workspace.dataHealth.queryOptions(), refetchInterval: 60_000 });
  if (!data) return <span className="text-xs text-subtle">Checking data freshness…</span>;
  const issues = data.unmatchedRecords + data.unknownStatusParcels + data.failedSyncItems;
  const connected = data.connectionStatus === "CONNECTED";
  return (
    <div className="flex items-center gap-2 text-xs">
      <Tooltip content={connected ? `Last successful MDM sync: ${formatDateTime(data.lastSuccessfulSyncAt)}` : "MDM Express is not connected. Parcel data may be missing or stale."}>
        <Link href="/syncs" className={cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-1", connected ? "border-border text-muted hover:text-fg" : "border-warning/30 bg-warning-soft text-warning")}>
          {connected ? <CircleDot className="size-3 text-positive" /> : <Link2Off className="size-3" />}
          <span className="hidden sm:inline">MDM</span>
          {connected ? (data.lastSuccessfulSyncAt ? `synced ${timeAgo(data.lastSuccessfulSyncAt)}` : "connected, not synced yet") : data.connectionStatus === "ERROR" ? "error" : "not connected"}
        </Link>
      </Tooltip>
      {issues > 0 ? (
        <Tooltip content={`${data.unmatchedRecords} unmatched records, ${data.unknownStatusParcels} parcels with unknown status, ${data.failedSyncItems} failed sync items.`}>
          <Link href="/syncs" className="inline-flex items-center gap-1.5 rounded-md border border-negative/30 bg-negative-soft px-2 py-1 text-negative">
            <AlertTriangle className="size-3" /> {issues} <span className="hidden sm:inline">need review</span>
          </Link>
        </Tooltip>
      ) : null}
    </div>
  );
}
