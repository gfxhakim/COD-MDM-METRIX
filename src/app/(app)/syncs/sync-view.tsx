"use client";

import type { SyncJobStatus } from "@prisma/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, EyeOff, FlaskConical, History, Link2, Loader2, RefreshCw, RotateCcw, Settings, Undo2 } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Money } from "@/components/app/format";
import { PageHeader } from "@/components/app/page-header";
import { ParcelStatusBadge } from "@/components/app/status";
import { useCan } from "@/components/app/use-can";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { EmptyState, ErrorState, Loading } from "@/components/ui/states";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { errorMessage, useTRPC } from "@/lib/trpc/client";
import { formatDateTime, timeAgo } from "@/lib/utils";

const JOB_TONE: Record<SyncJobStatus, "positive" | "warning" | "negative" | "neutral" | "info"> = { QUEUED: "info", RUNNING: "info", SUCCEEDED: "positive", PARTIAL: "warning", FAILED: "negative", CANCELED: "neutral" };
const JOB_LABEL: Record<SyncJobStatus, string> = { QUEUED: "Queued", RUNNING: "Running", SUCCEEDED: "Succeeded", PARTIAL: "Partial", FAILED: "Failed", CANCELED: "Canceled" };
const active = (s: SyncJobStatus) => s === "QUEUED" || s === "RUNNING";

function duration(a: Date | null, b: Date | null) {
  if (!a || !b) return "—";
  const s = Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function useInvalidateSync() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  return () => {
    for (const k of [trpc.sync, trpc.integrations, trpc.orders, trpc.reports, trpc.creatives]) qc.invalidateQueries({ queryKey: k.pathKey() });
    qc.invalidateQueries({ queryKey: trpc.workspace.dataHealth.queryKey() });
  };
}

function JobDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const trpc = useTRPC();
  const toast = useToast();
  const invalidate = useInvalidateSync();
  const canRun = useCan("sync.run");
  const q = useQuery({ ...trpc.sync.get.queryOptions({ id }), refetchInterval: (query) => (query.state.data && active(query.state.data.job.status) ? 2000 : false) });
  const retry = useMutation(trpc.sync.retry.mutationOptions({ onSuccess: (r) => { invalidate(); toast("success", r.alreadyRunning ? "A sync is already running" : "Retry started"); onClose(); }, onError: (e) => toast("error", errorMessage(e)) }));
  const d = q.data;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Sync details" description={d ? `${formatDateTime(d.job.createdAt)} · ${d.job.mode === "FULL" ? "Full" : "Incremental"} · ${d.job.trigger.toLowerCase()}` : undefined} className="max-w-3xl">
        {q.error ? <ErrorState message={errorMessage(q.error)} /> : !d ? <Loading /> : (
          <div className="flex flex-col gap-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={JOB_TONE[d.job.status]}>{JOB_LABEL[d.job.status]}</Badge>
              {d.job.adapter === "mock" ? <Badge tone="info"><FlaskConical className="size-3" /> Demo fixtures</Badge> : null}
              {d.job.attempt ? <span className="text-xs text-muted">attempt {d.job.attempt + 1}</span> : null}
              {d.job.updatedSince ? <span className="text-xs text-muted">changes since {formatDateTime(d.job.updatedSince)}</span> : null}
            </div>
            {d.job.error ? <p className="rounded-lg border border-negative/30 bg-negative-soft p-3 text-negative">{d.job.error}</p> : null}
            {d.job.ordersNote ? <p className="rounded-lg border border-info/30 bg-info-soft p-3 text-info">{d.job.ordersNote}</p> : null}
            <p className="text-xs font-medium text-muted">Orders</p>
            <div className="grid grid-cols-3 gap-2">
              {[["New", d.job.ordersAddedCount], ["Updated", d.job.ordersUpdatedCount], ["With a content ID", d.job.ordersWithContentCount]].map(([l, v]) => (
                <div key={l} className="rounded-lg border border-border bg-surface-2 p-2"><p className="text-[11px] text-muted">{l}</p><p className="num text-lg font-semibold">{v}</p></div>
              ))}
            </div>
            <p className="text-xs font-medium text-muted">Parcels</p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {[["Added", d.job.addedCount], ["Updated", d.job.updatedCount], ["Unchanged", d.job.unchangedCount], ["Failed", d.job.failedCount], ["Unknown status", d.job.unknownStatusCount], ["Unmatched", d.job.unmatchedCount]].map(([l, v]) => (
                <div key={l} className="rounded-lg border border-border bg-surface-2 p-2"><p className="text-[11px] text-muted">{l}</p><p className="num text-lg font-semibold">{v}</p></div>
              ))}
            </div>
            {d.items.length ? (
              <div className="max-h-80 overflow-auto rounded-lg border border-border">
                <Table>
                  <THead><tr><Th>Tracking ID</Th><Th>Type</Th><Th>Result</Th><Th>Note</Th></tr></THead>
                  <tbody>
                    {d.items.map((i) => (
                      <Tr key={i.id}>
                        <Td className="font-mono text-xs">{i.providerId}</Td>
                        <Td className="text-xs text-muted">{i.entityType}</Td>
                        <Td><Badge tone={i.result === "FAILED" ? "negative" : i.result === "UNMATCHED" ? "warning" : i.result === "ADDED" ? "positive" : "info"}>{i.result.toLowerCase()}</Badge></Td>
                        <Td className="text-xs text-muted">{i.error ?? ""}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            ) : <p className="text-muted">No orders or parcels were added, changed or failed in this sync.</p>}
            {canRun && (d.job.status === "FAILED" || d.job.status === "PARTIAL") ? (
              <div className="flex justify-end"><Button variant="primary" onClick={() => retry.mutate({ id: d.job.id })} disabled={retry.isPending}><RotateCcw /> Retry this sync</Button></div>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function LinkDialog({ trackingId, reference, onClose }: { trackingId: string; reference: string | null; onClose: () => void }) {
  const trpc = useTRPC();
  const toast = useToast();
  const invalidate = useInvalidateSync();
  const [search, setSearch] = React.useState(reference ?? "");
  const orders = useQuery({ ...trpc.orders.list.queryOptions({ search: search.trim() || undefined, page: 1, pageSize: 10 }), enabled: search.trim().length >= 2 });
  const link = useMutation(trpc.orders.manualMatchParcel.mutationOptions({ onSuccess: () => { invalidate(); toast("success", `Parcel ${trackingId} linked`); onClose(); }, onError: (e) => toast("error", errorMessage(e)) }));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Link parcel to an order" description={<>Parcel <span className="font-mono">{trackingId}</span>{reference ? <> · MDM reference {reference}</> : null}. Manual links are kept by future syncs.</>}>
        <Field label="Find order" htmlFor="lk"><Input id="lk" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Order number or tracking ID" autoFocus /></Field>
        <div className="mt-3 max-h-72 overflow-auto">
          {search.trim().length < 2 ? <p className="text-sm text-muted">Type at least 2 characters.</p> : !orders.data ? <Loading /> : !orders.data.items.length ? <p className="text-sm text-muted">No matching orders.</p> : (
            <Table>
              <tbody>
                {orders.data.items.map((o) => (
                  <Tr key={o.id}>
                    <Td className="font-medium">{o.orderNumber}</Td>
                    <Td className="text-xs text-muted">{formatDateTime(o.placedAt)}</Td>
                    <Td className="text-xs text-muted">{o.wilaya ?? "—"}</Td>
                    <Td className="text-right"><Button size="sm" variant="outline" disabled={link.isPending} onClick={() => link.mutate({ orderId: o.id, trackingId })}>Link</Button></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function UnmatchedQueue() {
  const trpc = useTRPC();
  const toast = useToast();
  const invalidate = useInvalidateSync();
  const canMatch = useCan("orders.match");
  const [status, setStatus] = React.useState<"OPEN" | "IGNORED" | "RESOLVED">("OPEN");
  const q = useQuery(trpc.sync.unmatched.queryOptions({ status }));
  const [linking, setLinking] = React.useState<{ trackingId: string; reference: string | null } | null>(null);
  const ignore = useMutation(trpc.sync.ignoreUnmatched.mutationOptions({ onSuccess: () => invalidate(), onError: (e) => toast("error", errorMessage(e)) }));
  return (
    <Card>
      <CardHeader title="Unmatched parcels" description="Parcels MDM knows about that could not be tied to an order by order reference, earlier tracking-ID link or store order ID. They are never guessed." />
      <Tabs value={status} onValueChange={(v) => setStatus(v as typeof status)}>
        <TabsList className="px-3"><TabsTrigger value="OPEN">To review</TabsTrigger><TabsTrigger value="IGNORED">Ignored</TabsTrigger><TabsTrigger value="RESOLVED">Resolved</TabsTrigger></TabsList>
      </Tabs>
      {q.error ? <ErrorState message={errorMessage(q.error)} /> : !q.data ? <Loading /> : !q.data.length ? (
        <EmptyState icon={<Link2 />} title={status === "OPEN" ? "Nothing to review" : "No records"} />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <THead><tr><Th>Tracking ID</Th><Th>MDM reference</Th><Th>Status</Th><Th className="text-right">COD</Th><Th>Wilaya</Th><Th>Why</Th><Th><span className="sr-only">Actions</span></Th></tr></THead>
            <tbody>
              {q.data.map((r) => (
                <Tr key={r.id}>
                  <Td className="font-mono text-xs">{r.externalId}{r.parcel?.isDemoFixture ? <Badge tone="info" className="ml-1.5">demo</Badge> : null}</Td>
                  <Td>{r.reference ?? "—"}</Td>
                  <Td>{r.parcel ? <ParcelStatusBadge status={r.parcel.normalizedStatus} /> : "—"}</Td>
                  <Td className="text-right">{r.parcel ? <Money value={r.parcel.codAmount} currency={r.parcel.currency} /> : "—"}</Td>
                  <Td className="text-xs text-muted">{r.parcel?.wilaya ?? "—"}</Td>
                  <Td className="min-w-60 max-w-80 whitespace-normal text-xs text-muted">{r.reason}</Td>
                  <Td>
                    {canMatch ? (
                      <div className="flex justify-end gap-1">
                        {status === "OPEN" ? (
                          <>
                            <Button size="sm" variant="outline" onClick={() => setLinking({ trackingId: r.externalId, reference: r.reference })}><Link2 /> Link</Button>
                            <Button size="sm" variant="ghost" onClick={() => ignore.mutate({ id: r.id, ignore: true })}><EyeOff /> Ignore</Button>
                          </>
                        ) : status === "IGNORED" ? <Button size="sm" variant="ghost" onClick={() => ignore.mutate({ id: r.id, ignore: false })}><Undo2 /> Reopen</Button> : null}
                      </div>
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
      {linking ? <LinkDialog {...linking} onClose={() => setLinking(null)} /> : null}
    </Card>
  );
}

export function SyncView() {
  const trpc = useTRPC();
  const toast = useToast();
  const invalidate = useInvalidateSync();
  const canRun = useCan("sync.run");
  const conn = useQuery(trpc.integrations.mdm.queryOptions());
  const jobs = useQuery({ ...trpc.sync.list.queryOptions({ limit: 30 }), refetchInterval: (query) => (query.state.data?.some((j) => active(j.status)) ? 2000 : false) });
  const unknown = useQuery(trpc.sync.unknownStatuses.queryOptions());
  const [viewing, setViewing] = React.useState<string | null>(null);
  const running = jobs.data?.find((j) => active(j.status));
  const wasRunning = React.useRef(false);
  React.useEffect(() => {
    if (wasRunning.current && !running) invalidate();
    wasRunning.current = !!running;
  }, [running, invalidate]);
  const start = useMutation(trpc.sync.start.mutationOptions({ onSuccess: (r) => { invalidate(); toast(r.alreadyRunning ? "error" : "success", r.alreadyRunning ? "A sync is already running for this workspace" : "Sync started"); }, onError: (e) => toast("error", errorMessage(e)) }));
  const cancel = useMutation(trpc.sync.cancel.mutationOptions({ onSuccess: () => invalidate(), onError: (e) => toast("error", errorMessage(e)) }));
  const c = conn.data;
  const connected = c?.status === "CONNECTED";
  const unknownCount = unknown.data?.reduce((a, u) => a + u.parcels, 0) ?? 0;

  return (
    <>
      <PageHeader
        title="MDM Express sync"
        description="Parcels and their status history come from MDM in the background. Every run is recorded, re-running never duplicates anything, and parcels that can't be matched wait for review."
        actions={canRun ? (
          <div className="flex gap-2">
            <Button variant="outline" disabled={!connected || !!running || start.isPending} onClick={() => start.mutate({ mode: "FULL" })} title="Re-read every parcel">Full resync</Button>
            <Button variant="primary" disabled={!connected || !!running || start.isPending} onClick={() => start.mutate({ mode: "INCREMENTAL" })}><RefreshCw className={running ? "animate-spin" : ""} /> Sync now</Button>
          </div>
        ) : null}
      />

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs text-muted">Connection</p>
          {!c ? <Loading /> : (
            <>
              <p className="mt-1 flex items-center gap-2 text-lg font-semibold">{connected ? "Connected" : c.status === "ERROR" ? "Error" : c.hasCredential ? "Not verified" : "Not connected"}{c.adapter === "mock" ? <Badge tone="info"><FlaskConical className="size-3" /> Demo fixtures</Badge> : null}</p>
              <p className="mt-1 text-xs text-muted">{c.maskedLabel ? <span className="font-mono">{c.maskedLabel}</span> : "No key saved"}{c.lastError ? <span className="block text-negative">{c.lastError}</span> : null}</p>
              {!connected ? <Link href="/settings?tab=mdm" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-strong hover:underline"><Settings className="size-3" /> {c.hasCredential ? "Test the connection in Settings" : "Add your MDM key in Settings"}</Link> : null}
            </>
          )}
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted">Last successful sync</p>
          <p className="mt-1 text-lg font-semibold">{c?.lastSuccessfulSyncAt ? timeAgo(c.lastSuccessfulSyncAt) : "Never"}</p>
          <p className="mt-1 text-xs text-muted">{c?.lastSuccessfulSyncAt ? formatDateTime(c.lastSuccessfulSyncAt) : "Parcel data shown in reports may be missing."}</p>
          {c?.status === "CONNECTED" ? <p className="mt-1 text-xs text-muted">Syncs automatically every {c.syncIntervalMinutes < 60 ? `${c.syncIntervalMinutes} min` : `${c.syncIntervalMinutes / 60} h`}.</p> : null}
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted">Unknown MDM statuses</p>
          <p className={`num mt-1 text-lg font-semibold ${unknownCount ? "text-warning" : ""}`}>{unknownCount} parcel{unknownCount === 1 ? "" : "s"}</p>
          <p className="mt-1 text-xs text-muted">Counted as neither delivered nor returned. {unknownCount ? <Link href="/settings?tab=mappings" className="font-semibold text-brand-strong hover:underline">Map statuses</Link> : null}</p>
        </Card>
      </div>

      {running ? (
        <Card className="mb-6 border-info/30">
          <CardBody className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-3">
              <Loader2 className="size-5 animate-spin text-info" />
              <div>
                <p className="font-medium">{running.status === "QUEUED" ? (running.nextRunAt && new Date(running.nextRunAt) > new Date() ? `Waiting to retry (${timeAgo(running.nextRunAt).replace(" ago", "")})` : "Queued") : `Syncing ${running.phase === "ORDERS" ? "orders" : "parcels"}, page ${running.page + 1}${running.totalCount ? ` of ${Math.max(1, Math.ceil(running.totalCount / 100))}` : ""}`}</p>
                <p className="text-xs text-muted">Orders: {running.ordersAddedCount} new · {running.ordersUpdatedCount} updated · Parcels: {running.addedCount} added · {running.updatedCount} updated · {running.unchangedCount} unchanged · {running.failedCount} failed{running.error ? ` · ${running.error}` : ""}</p>
              </div>
            </div>
            {canRun ? <Button size="sm" variant="ghost" disabled={running.cancelRequested} onClick={() => cancel.mutate({ id: running.id })}><Ban /> {running.cancelRequested ? "Canceling…" : "Cancel"}</Button> : null}
          </CardBody>
        </Card>
      ) : null}

      <div className="flex flex-col gap-6">
        <UnmatchedQueue />
        <Card>
          <CardHeader title="Sync history" />
          {jobs.error ? <ErrorState message={errorMessage(jobs.error)} /> : !jobs.data ? <Loading /> : !jobs.data.length ? (
            <EmptyState icon={<History />} title="No syncs yet" description={connected ? "Run your first sync with Sync now." : "Connect MDM Express in Settings, then run a sync."} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <THead><tr><Th>Started</Th><Th>Type</Th><Th>Status</Th><Th className="text-right">New orders</Th><Th className="text-right">Parcels added</Th><Th className="text-right">Updated</Th><Th className="text-right">Unchanged</Th><Th className="text-right">Failed</Th><Th className="text-right">Unmatched</Th><Th>Duration</Th></tr></THead>
                <tbody>
                  {jobs.data.map((j) => (
                    <Tr key={j.id} className="cursor-pointer" onClick={() => setViewing(j.id)}>
                      <Td className="whitespace-nowrap text-xs text-muted">{formatDateTime(j.createdAt)}</Td>
                      <Td className="text-xs">{j.mode === "FULL" ? "Full" : "Incremental"} · {j.trigger.toLowerCase()}{j.adapter === "mock" ? <Badge tone="info" className="ml-1.5">demo</Badge> : null}</Td>
                      <Td><Badge tone={JOB_TONE[j.status]}>{JOB_LABEL[j.status]}</Badge></Td>
                      <Td className="num text-right">{j.ordersAddedCount}</Td>
                      <Td className="num text-right">{j.addedCount}</Td>
                      <Td className="num text-right">{j.updatedCount}</Td>
                      <Td className="num text-right text-muted">{j.unchangedCount}</Td>
                      <Td className={`num text-right ${j.failedCount ? "text-negative" : "text-muted"}`}>{j.failedCount}</Td>
                      <Td className={`num text-right ${j.unmatchedCount ? "text-warning" : "text-muted"}`}>{j.unmatchedCount}</Td>
                      <Td className="text-xs text-muted">{duration(j.startedAt, j.finishedAt)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </Card>
      </div>
      {viewing ? <JobDialog id={viewing} onClose={() => setViewing(null)} /> : null}
    </>
  );
}
