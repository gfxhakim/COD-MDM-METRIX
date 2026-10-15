"use client";

import type { SyncItemResult, SyncJobStatus } from "@prisma/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Ban, EyeOff, FlaskConical, History, Link2, Loader2, RefreshCw, RotateCcw, Settings, SlidersHorizontal, Undo2 } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Money } from "@/components/app/format";
import { MoreDetails, useMoreDetails } from "@/components/app/more-details";
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
import { describeCustomSync, readCustomFilters } from "@/domain/customSync";
import { useT } from "@/i18n/client";
import { msg, type TFunction } from "@/i18n/core";
import { errorMessage, useTRPC } from "@/lib/trpc/client";
import { CustomSyncPanel } from "./custom-sync-panel";
import { MdmProductsCard } from "./mdm-products-card";

const JOB_TONE: Record<SyncJobStatus, "positive" | "warning" | "negative" | "neutral" | "info"> = { QUEUED: "info", RUNNING: "info", SUCCEEDED: "positive", PARTIAL: "warning", FAILED: "negative", CANCELED: "neutral" };
const JOB_LABEL: Record<SyncJobStatus, string> = { QUEUED: msg("Queued"), RUNNING: msg("Running"), SUCCEEDED: msg("Succeeded"), PARTIAL: msg("Partial"), FAILED: msg("Failed"), CANCELED: msg("Canceled") };
const active = (s: SyncJobStatus) => s === "QUEUED" || s === "RUNNING";
const MODE_LABEL: Record<string, string> = { FULL: msg("Full"), INCREMENTAL: msg("Incremental"), CUSTOM: msg("Custom") };
const TRIGGER_LABEL: Record<string, string> = { MANUAL: msg("manual"), SCHEDULED: msg("scheduled"), RETRY: msg("retry") };
const RESULT_LABEL: Record<SyncItemResult, string> = { ADDED: msg("added"), UPDATED: msg("updated"), UNCHANGED: msg("unchanged"), FAILED: msg("failed"), UNMATCHED: msg("unmatched"), SKIPPED: msg("skipped") };
const ENTITY_LABEL: Record<string, string> = { order: msg("order"), parcel: msg("parcel") };

/** "Full · manual": how a sync was run, in the picked language. */
const kindOf = (job: { mode: string; trigger: string }, t: TFunction) => `${MODE_LABEL[job.mode] ? t(MODE_LABEL[job.mode]) : job.mode} · ${TRIGGER_LABEL[job.trigger] ? t(TRIGGER_LABEL[job.trigger]) : job.trigger.toLowerCase()}`;

/** A custom sync's choices in a few words, e.g. "Placed 1 Sep 2026 to 30 Sep 2026 · Delivered · Oran". */
function choicesOf(job: { mode: string; filters: unknown }, t: TFunction): string | null {
  const f = job.mode === "CUSTOM" ? readCustomFilters(job.filters) : null;
  return f ? describeCustomSync(f, t).join(" · ") : null;
}

function duration(a: Date | null, b: Date | null, t: TFunction) {
  if (!a || !b) return "—";
  const s = Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 1000));
  return s < 60 ? t("{s}s", { s }) : t("{m}m {s}s", { m: Math.floor(s / 60), s: s % 60 });
}

function useInvalidateSync() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  return () => {
    for (const k of [trpc.sync, trpc.integrations, trpc.orders, trpc.reports, trpc.creatives, trpc.money]) qc.invalidateQueries({ queryKey: k.pathKey() });
    qc.invalidateQueries({ queryKey: trpc.workspace.dataHealth.queryKey() });
  };
}

function CustomSummary({ job }: { job: { filters: unknown; ordersMatchedCount: number; skippedCount: number } }) {
  const { t, tx } = useT();
  const f = readCustomFilters(job.filters);
  if (!f) return null;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-brand/20 bg-brand-soft/40 p-3">
      <p className="text-xs font-medium text-muted">{t("Custom sync of")}</p>
      <div className="flex flex-wrap gap-1.5">
        {describeCustomSync(f, t).map((p) => <span key={p} className="rounded-full bg-surface px-2.5 py-1 text-xs font-medium shadow-card">{p}</span>)}
      </div>
      <p className="num text-xs text-muted">{tx("{matched} MDM orders matched · {skipped} read and left alone because they didn't match", { matched: <span className="font-semibold text-fg">{job.ordersMatchedCount}</span>, skipped: <span className="font-semibold text-fg">{job.skippedCount}</span> })}</p>
      {f.fallbackOrders || f.fallbackParcels ? <p className="text-xs text-muted">{f.fallbackOrders ? t("MDM didn't narrow its search as asked, so the app read more orders and kept only the matching ones. The result is the same; it just took longer.") : t("MDM didn't narrow its search as asked, so the app read more parcels and kept only the matching ones. The result is the same; it just took longer.")}</p> : null}
    </div>
  );
}

function JobDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, tx, dateTime } = useT();
  const trpc = useTRPC();
  const toast = useToast();
  const invalidate = useInvalidateSync();
  const canRun = useCan("sync.run");
  const q = useQuery({ ...trpc.sync.get.queryOptions({ id }), refetchInterval: (query) => (query.state.data && active(query.state.data.job.status) ? 2000 : false) });
  const retry = useMutation(trpc.sync.retry.mutationOptions({ onSuccess: (r) => { invalidate(); toast("success", r.alreadyRunning ? t("A sync is already running") : t("Retry started")); onClose(); }, onError: (e) => toast("error", errorMessage(e)) }));
  const d = q.data;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={t("Sync details")} description={d ? `${dateTime(d.job.createdAt)} · ${kindOf(d.job, t)}` : undefined} className="max-w-3xl">
        {q.error ? <ErrorState message={errorMessage(q.error)} /> : !d ? <Loading /> : (
          <div className="flex flex-col gap-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={JOB_TONE[d.job.status]}>{t(JOB_LABEL[d.job.status])}</Badge>
              {d.job.adapter === "mock" ? <Badge tone="info"><FlaskConical className="size-3" /> {t("Demo fixtures")}</Badge> : null}
              {d.job.attempt ? <span className="text-xs text-muted">{t("attempt {n}", { n: d.job.attempt + 1 })}</span> : null}
              {d.job.updatedSince ? <span className="text-xs text-muted">{t("changes since {date}", { date: dateTime(d.job.updatedSince) })}</span> : null}
            </div>
            {d.job.error ? <p className="rounded-lg border border-negative/30 bg-negative-soft p-3 text-negative">{d.job.error}</p> : null}
            {d.job.ordersNote ? <p className="rounded-lg border border-info/30 bg-info-soft p-3 text-info">{d.job.ordersNote}</p> : null}
            {d.job.mode === "CUSTOM" ? <CustomSummary job={d.job} /> : d.job.skippedCount ? (
              <p className="rounded-lg border border-border bg-surface-2 p-3 text-muted">{d.job.skippedCount === 1
                ? tx("{n} MDM order was left out because its products aren't brought in (see What to bring from MDM).", { n: <span className="num font-semibold text-fg">{d.job.skippedCount}</span> })
                : tx("{n} MDM orders were left out because their products aren't brought in (see What to bring from MDM).", { n: <span className="num font-semibold text-fg">{d.job.skippedCount}</span> })}</p>
            ) : null}
            <p className="text-xs font-medium text-muted">{t("Orders")}</p>
            <div className="grid grid-cols-3 gap-2">
              {[[t("New"), d.job.ordersAddedCount], [t("Updated"), d.job.ordersUpdatedCount], [t("With a content ID"), d.job.ordersWithContentCount]].map(([l, v]) => (
                <div key={l} className="rounded-lg border border-border bg-surface-2 p-2"><p className="text-[11px] text-muted">{l}</p><p className="num text-lg font-semibold">{v}</p></div>
              ))}
            </div>
            <p className="text-xs font-medium text-muted">{t("Parcels")}</p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {[[t("Added"), d.job.addedCount], [t("Updated"), d.job.updatedCount], [t("Unchanged"), d.job.unchangedCount], [t("Failed"), d.job.failedCount], [t("Unknown status"), d.job.unknownStatusCount], [t("Unmatched"), d.job.unmatchedCount]].map(([l, v]) => (
                <div key={l} className="rounded-lg border border-border bg-surface-2 p-2"><p className="text-[11px] text-muted">{l}</p><p className="num text-lg font-semibold">{v}</p></div>
              ))}
            </div>
            {d.items.length ? (
              <div className="max-h-80 overflow-auto rounded-lg border border-border">
                <Table>
                  <THead><tr><Th>{t("Tracking ID")}</Th><Th>{t("Type")}</Th><Th>{t("Result")}</Th><Th>{t("Note")}</Th></tr></THead>
                  <tbody>
                    {d.items.map((i) => (
                      <Tr key={i.id}>
                        <Td className="font-mono text-xs">{i.providerId}</Td>
                        <Td className="text-xs text-muted">{ENTITY_LABEL[i.entityType] ? t(ENTITY_LABEL[i.entityType]) : i.entityType}</Td>
                        <Td><Badge tone={i.result === "FAILED" ? "negative" : i.result === "UNMATCHED" ? "warning" : i.result === "ADDED" ? "positive" : "info"}>{t(RESULT_LABEL[i.result])}</Badge></Td>
                        <Td className="text-xs text-muted">{i.error ?? ""}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            ) : <p className="text-muted">{t("No orders or parcels were added, changed or failed in this sync.")}</p>}
            {canRun && (d.job.status === "FAILED" || d.job.status === "PARTIAL") ? (
              <div className="flex justify-end"><Button variant="primary" onClick={() => retry.mutate({ id: d.job.id })} disabled={retry.isPending}><RotateCcw /> {t("Retry this sync")}</Button></div>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function LinkDialog({ trackingId, reference, onClose }: { trackingId: string; reference: string | null; onClose: () => void }) {
  const { t, tx, dateTime } = useT();
  const trpc = useTRPC();
  const toast = useToast();
  const invalidate = useInvalidateSync();
  const [search, setSearch] = React.useState(reference ?? "");
  const orders = useQuery({ ...trpc.orders.list.queryOptions({ search: search.trim() || undefined, page: 1, pageSize: 10 }), enabled: search.trim().length >= 2 });
  const link = useMutation(trpc.orders.manualMatchParcel.mutationOptions({ onSuccess: () => { invalidate(); toast("success", t("Parcel {id} linked", { id: trackingId })); onClose(); }, onError: (e) => toast("error", errorMessage(e)) }));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={t("Link parcel to an order")}
        description={reference
          ? tx("Parcel {id} · MDM reference {reference}. Manual links are kept by future syncs.", { id: <span className="font-mono">{trackingId}</span>, reference })
          : tx("Parcel {id}. Manual links are kept by future syncs.", { id: <span className="font-mono">{trackingId}</span> })}
      >
        <Field label={t("Find order")} htmlFor="lk"><Input id="lk" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("Order number or tracking ID")} autoFocus /></Field>
        <div className="mt-3 max-h-72 overflow-auto">
          {search.trim().length < 2 ? <p className="text-sm text-muted">{t("Type at least 2 characters.")}</p> : !orders.data ? <Loading /> : !orders.data.items.length ? <p className="text-sm text-muted">{t("No matching orders.")}</p> : (
            <Table>
              <tbody>
                {orders.data.items.map((o) => (
                  <Tr key={o.id}>
                    <Td className="font-medium">{o.orderNumber}</Td>
                    <Td className="text-xs text-muted">{dateTime(o.placedAt)}</Td>
                    <Td className="text-xs text-muted">{o.wilaya ?? "—"}</Td>
                    <Td className="text-end"><Button size="sm" variant="outline" disabled={link.isPending} onClick={() => link.mutate({ orderId: o.id, trackingId })}>{t("Link")}</Button></Td>
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
  const { t } = useT();
  const trpc = useTRPC();
  const toast = useToast();
  const invalidate = useInvalidateSync();
  const canMatch = useCan("orders.match");
  const [status, setStatus] = React.useState<"OPEN" | "IGNORED" | "RESOLVED">("OPEN");
  const q = useQuery(trpc.sync.unmatched.queryOptions({ status }));
  const [linking, setLinking] = React.useState<{ trackingId: string; reference: string | null } | null>(null);
  const ignore = useMutation(trpc.sync.ignoreUnmatched.mutationOptions({ onSuccess: () => invalidate(), onError: (e) => toast("error", errorMessage(e)) }));
  return (
    <Card id="unmatched" className="scroll-mt-24">
      <CardHeader title={t("Unmatched parcels")} description={t("Parcels MDM knows about that could not be tied to an order by order reference, earlier tracking-ID link or store order ID. They are never guessed.")} />
      <Tabs value={status} onValueChange={(v) => setStatus(v as typeof status)}>
        <TabsList className="px-3"><TabsTrigger value="OPEN">{t("To review")}</TabsTrigger><TabsTrigger value="IGNORED">{t("Ignored")}</TabsTrigger><TabsTrigger value="RESOLVED">{t("Resolved")}</TabsTrigger></TabsList>
      </Tabs>
      {q.error ? <ErrorState message={errorMessage(q.error)} /> : !q.data ? <Loading /> : !q.data.length ? (
        <EmptyState icon={<Link2 />} title={status === "OPEN" ? t("Nothing to review") : t("No records")} />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <THead><tr><Th>{t("Tracking ID")}</Th><Th>{t("MDM reference")}</Th><Th>{t("Status")}</Th><Th className="text-end">{t("COD")}</Th><Th>{t("Wilaya")}</Th><Th>{t("Why")}</Th><Th><span className="sr-only">{t("Actions")}</span></Th></tr></THead>
            <tbody>
              {q.data.map((r) => (
                <Tr key={r.id}>
                  <Td className="font-mono text-xs">{r.externalId}{r.parcel?.isDemoFixture ? <Badge tone="info" className="ms-1.5">{t("demo")}</Badge> : null}</Td>
                  <Td>{r.reference ?? "—"}</Td>
                  <Td>{r.parcel ? <ParcelStatusBadge status={r.parcel.normalizedStatus} /> : "—"}</Td>
                  <Td className="text-end">{r.parcel ? <Money value={r.parcel.codAmount} currency={r.parcel.currency} /> : "—"}</Td>
                  <Td className="text-xs text-muted">{r.parcel?.wilaya ?? "—"}</Td>
                  <Td className="min-w-60 max-w-80 whitespace-normal text-xs text-muted">{r.reason}</Td>
                  <Td>
                    {canMatch ? (
                      <div className="flex justify-end gap-1">
                        {status === "OPEN" ? (
                          <>
                            <Button size="sm" variant="outline" onClick={() => setLinking({ trackingId: r.externalId, reference: r.reference })}><Link2 /> {t("Link")}</Button>
                            <Button size="sm" variant="ghost" onClick={() => ignore.mutate({ id: r.id, ignore: true })}><EyeOff /> {t("Ignore")}</Button>
                          </>
                        ) : status === "IGNORED" ? <Button size="sm" variant="ghost" onClick={() => ignore.mutate({ id: r.id, ignore: false })}><Undo2 /> {t("Reopen")}</Button> : null}
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
  const { t, tx, dateTime, ago } = useT();
  const trpc = useTRPC();
  const toast = useToast();
  const invalidate = useInvalidateSync();
  const canRun = useCan("sync.run");
  const conn = useQuery(trpc.integrations.mdm.queryOptions());
  const workspace = useQuery(trpc.workspace.getCurrent.queryOptions());
  const [customOpen, setCustomOpen] = React.useState(false);
  const jobs = useQuery({ ...trpc.sync.list.queryOptions({ limit: 30 }), refetchInterval: (query) => (query.state.data?.some((j) => active(j.status)) ? 2000 : false) });
  const unknown = useQuery(trpc.sync.unknownStatuses.queryOptions());
  const toReview = useQuery(trpc.sync.unmatched.queryOptions({ status: "OPEN" }));
  const [more, setMore] = useMoreDetails("syncs");
  const [viewing, setViewing] = React.useState<string | null>(null);
  const running = jobs.data?.find((j) => active(j.status));
  const wasRunning = React.useRef(false);
  React.useEffect(() => {
    if (wasRunning.current && !running) invalidate();
    wasRunning.current = !!running;
  }, [running, invalidate]);
  const start = useMutation(trpc.sync.start.mutationOptions({ onSuccess: (r) => { invalidate(); toast(r.alreadyRunning ? "error" : "success", r.alreadyRunning ? t("A sync is already running for this workspace") : t("Sync started")); }, onError: (e) => toast("error", errorMessage(e)) }));
  const cancel = useMutation(trpc.sync.cancel.mutationOptions({ onSuccess: () => invalidate(), onError: (e) => toast("error", errorMessage(e)) }));
  const c = conn.data;
  const connected = c?.status === "CONNECTED";
  const unknownCount = unknown.data?.reduce((a, u) => a + u.parcels, 0) ?? 0;
  const reviewCount = toReview.data?.length ?? 0;
  // The newest run, when it didn't fully work: said up here, since the history is folded.
  const last = jobs.data?.[0];
  const lastBad = !running && last && (last.status === "FAILED" || last.status === "PARTIAL") ? last : null;
  const review = () => {
    setMore(true);
    setTimeout(() => document.getElementById("unmatched")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };
  // What the running sync does now, e.g. "Syncing orders, page 2 of 5".
  const runningTitle = (r: NonNullable<typeof running>) => {
    const doing = r.mode === "CUSTOM" ? (r.phase === "ORDERS" ? t("reading orders") : t("reading parcels")) : r.phase === "ORDERS" ? t("Syncing orders") : t("Syncing parcels");
    const now = r.status === "QUEUED"
      ? (r.nextRunAt && new Date(r.nextRunAt) > new Date() ? t("Waiting to retry ({when})", { when: ago(r.nextRunAt).replace(" ago", "") }) : t("Queued"))
      : r.phase === "ACCOUNT" ? t("Syncing money and stock")
        : r.totalCount ? t("{doing}, page {page} of {pages}", { doing, page: r.page + 1, pages: Math.max(1, Math.ceil(r.totalCount / 100)) })
          : t("{doing}, page {page}", { doing, page: r.page + 1 });
    return r.mode === "CUSTOM" ? t("Custom sync: {now}", { now }) : now;
  };

  return (
    <>
      <PageHeader
        title={t("MDM Express sync")}
        description={t("Your orders, parcels, money and stock come from MDM. It syncs by itself, and Sync now brings in what changed right away.")}
        actions={canRun ? (
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
            <Button variant="outline" disabled={!connected || !!running || !workspace.data} onClick={() => setCustomOpen(true)} title={t("Sync only the orders you pick, by date, status and more")}><SlidersHorizontal /> {t("Custom sync")}</Button>
            <Button variant="outline" disabled={!connected || !!running || start.isPending} onClick={() => start.mutate({ mode: "FULL" })} title={t("Re-read every parcel")}>{t("Full resync")}</Button>
            <Button variant="primary" className="order-first col-span-2 sm:order-none" disabled={!connected || !!running || start.isPending} onClick={() => start.mutate({ mode: "INCREMENTAL" })}><RefreshCw className={running ? "animate-spin" : ""} /> {t("Sync now")}</Button>
          </div>
        ) : null}
      />

      <div className={`mb-6 grid gap-4 ${unknownCount ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
        <Card className="p-4">
          <p className="text-xs text-muted">{t("Connection")}</p>
          {!c ? <Loading /> : (
            <>
              <p className="mt-1 flex items-center gap-2 text-lg font-semibold">{connected ? t("Connected") : c.status === "ERROR" ? t("Error") : c.hasCredential ? t("Not verified") : t("Not connected")}{c.adapter === "mock" ? <Badge tone="info"><FlaskConical className="size-3" /> {t("Demo fixtures")}</Badge> : null}</p>
              <p className="mt-1 text-xs text-muted">{c.maskedLabel ? <span className="font-mono">{c.maskedLabel}</span> : t("No key saved")}{c.lastError ? <span className="block text-negative">{c.lastError}</span> : null}</p>
              {!connected ? <Link href="/settings?tab=mdm" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-strong hover:underline"><Settings className="size-3" /> {c.hasCredential ? t("Test the connection in Settings") : t("Add your MDM key in Settings")}</Link> : null}
            </>
          )}
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted">{t("Last successful sync")}</p>
          <p className="mt-1 text-lg font-semibold">{c?.lastSuccessfulSyncAt ? ago(c.lastSuccessfulSyncAt) : t("Never")}</p>
          <p className="mt-1 text-xs text-muted">{c?.lastSuccessfulSyncAt ? dateTime(c.lastSuccessfulSyncAt) : t("Parcel data shown in reports may be missing.")}</p>
          {c?.status === "CONNECTED" ? <p className="mt-1 text-xs text-muted">{c.syncIntervalMinutes < 60 ? t("Syncs automatically every {n} min.", { n: c.syncIntervalMinutes }) : t("Syncs automatically every {n} h.", { n: c.syncIntervalMinutes / 60 })}</p> : null}
        </Card>
        {unknownCount ? (
          <Card className="p-4">
            <p className="text-xs text-muted">{t("Unknown MDM statuses")}</p>
            <p className="num mt-1 text-lg font-semibold text-warning">{unknownCount === 1 ? t("1 parcel") : t("{n} parcels", { n: unknownCount })}</p>
            <p className="mt-1 text-xs text-muted">{t("Counted as neither delivered nor returned.")} <Link href="/settings?tab=mappings" className="font-semibold text-brand-strong hover:underline">{t("Map statuses")}</Link></p>
          </Card>
        ) : null}
      </div>

      {running ? (
        <Card className="mb-6 border-info/30">
          <CardBody className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-3">
              <Loader2 className="size-5 animate-spin text-info" />
              <div>
                <p className="font-medium">{runningTitle(running)}</p>
                {running.mode === "CUSTOM" ? <p className="text-xs text-muted">{choicesOf(running, t)}</p> : c?.ordersFullReadPending ? <p className="text-xs text-muted">{t("Reading every MDM order once to fill in customer names, phones, addresses and order details, so this sync takes longer than usual.")}</p> : null}
                <p className="text-xs text-muted">{t("Orders: {orders} · Parcels: {added} added · {updated} updated · {unchanged} unchanged · {failed} failed", {
                  orders: running.mode === "CUSTOM"
                    ? t("{matched} matched ({added} new, {updated} updated) · {skipped} left alone", { matched: running.ordersMatchedCount, added: running.ordersAddedCount, updated: running.ordersUpdatedCount, skipped: running.skippedCount })
                    : running.skippedCount
                      ? t("{added} new · {updated} updated · {skipped} left out", { added: running.ordersAddedCount, updated: running.ordersUpdatedCount, skipped: running.skippedCount })
                      : t("{added} new · {updated} updated", { added: running.ordersAddedCount, updated: running.ordersUpdatedCount }),
                  added: running.addedCount,
                  updated: running.updatedCount,
                  unchanged: running.unchangedCount,
                  failed: running.failedCount,
                })}{running.error ? ` · ${running.error}` : ""}</p>
              </div>
            </div>
            {canRun ? <Button size="sm" variant="ghost" disabled={running.cancelRequested} onClick={() => cancel.mutate({ id: running.id })}><Ban /> {running.cancelRequested ? t("Canceling…") : t("Cancel")}</Button> : null}
          </CardBody>
        </Card>
      ) : null}

      {c?.ordersFullReadPending && !running ? (
        <Card className="mb-6 border-info/30">
          <CardBody className="flex items-start gap-3 text-sm">
            <RefreshCw className="mt-0.5 size-5 shrink-0 text-info" />
            <div>
              <p className="font-medium">{t("The next sync fills in customer details")}</p>
              <p className="text-xs text-muted">{t("It reads every MDM order once to add customer names, phones, addresses and order details to the orders already synced, so it takes longer than usual. Syncs after that are quick again.")}</p>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {lastBad ? (
        <Card className={`mb-6 ${lastBad.status === "FAILED" ? "border-negative/30" : "border-warning/30"}`}>
          <CardBody className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="flex items-start gap-2">
              <AlertTriangle className={`mt-0.5 size-4 shrink-0 ${lastBad.status === "FAILED" ? "text-negative" : "text-warning"}`} aria-hidden="true" />
              <span>
                <b>{lastBad.status === "FAILED" ? t("The last sync failed") : t("The last sync brought in only part of the data")}</b>
                <span className="block text-xs text-muted">{t("{date}. The next sync tries again.", { date: dateTime(lastBad.createdAt) })}</span>
              </span>
            </p>
            <Button size="sm" variant="outline" onClick={() => setViewing(lastBad.id)}>{t("See what happened")}</Button>
          </CardBody>
        </Card>
      ) : null}

      <div className="flex flex-col gap-6">
        {workspace.data ? <MdmProductsCard timezone={workspace.data.timezone} /> : null}
        {reviewCount && !more ? (
          <Card className="border-warning/30">
            <CardBody className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <p>{reviewCount === 1
                ? tx("{n} parcel from MDM couldn't be tied to an order. It waits for you to link or ignore it.", { n: <b className="num">{reviewCount}</b> })
                : tx("{n} parcels from MDM couldn't be tied to an order. They wait for you to link or ignore them.", { n: <b className="num">{reviewCount}</b> })}</p>
              <Button size="sm" variant="outline" onClick={review}>{reviewCount === 1 ? t("Review it") : t("Review them")}</Button>
            </CardBody>
          </Card>
        ) : null}
        <MoreDetails id="syncs" hint={t("Parcels to review, and every past sync with what it brought in.")}>
          <UnmatchedQueue />
          <Card>
            <CardHeader title={t("Sync history")} />
            {jobs.error ? <ErrorState message={errorMessage(jobs.error)} /> : !jobs.data ? <Loading /> : !jobs.data.length ? (
              <EmptyState icon={<History />} title={t("No syncs yet")} description={connected ? t("Run your first sync with Sync now.") : t("Connect MDM Express in Settings, then run a sync.")} />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <THead><tr><Th>{t("Started")}</Th><Th>{t("Type")}</Th><Th>{t("Status")}</Th><Th className="text-end">{t("New orders")}</Th><Th className="text-end">{t("Parcels added")}</Th><Th className="text-end">{t("Updated")}</Th><Th className="text-end">{t("Unchanged")}</Th><Th className="text-end">{t("Failed")}</Th><Th className="text-end">{t("Unmatched")}</Th><Th>{t("Duration")}</Th></tr></THead>
                  <tbody>
                    {jobs.data.map((j) => (
                      <Tr key={j.id} className="cursor-pointer" onClick={() => setViewing(j.id)}>
                        <Td className="whitespace-nowrap text-xs text-muted">{dateTime(j.createdAt)}</Td>
                        <Td className="text-xs">
                          {kindOf(j, t)}{j.adapter === "mock" ? <Badge tone="info" className="ms-1.5">{t("demo")}</Badge> : null}
                          {j.mode === "CUSTOM" ? <span className="block max-w-64 truncate text-[11px] text-muted" title={choicesOf(j, t) ?? undefined}>{choicesOf(j, t)}</span> : null}
                        </Td>
                        <Td><Badge tone={JOB_TONE[j.status]}>{t(JOB_LABEL[j.status])}</Badge></Td>
                        <Td className="num text-end">{j.ordersAddedCount}</Td>
                        <Td className="num text-end">{j.addedCount}</Td>
                        <Td className="num text-end">{j.updatedCount}</Td>
                        <Td className="num text-end text-muted">{j.unchangedCount}</Td>
                        <Td className={`num text-end ${j.failedCount ? "text-negative" : "text-muted"}`}>{j.failedCount}</Td>
                        <Td className={`num text-end ${j.unmatchedCount ? "text-warning" : "text-muted"}`}>{j.unmatchedCount}</Td>
                        <Td className="text-xs text-muted">{duration(j.startedAt, j.finishedAt, t)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </Card>
        </MoreDetails>
      </div>
      {viewing ? <JobDialog id={viewing} onClose={() => setViewing(null)} /> : null}
      {customOpen && workspace.data ? <CustomSyncPanel workspaceId={workspace.data.id} timezone={workspace.data.timezone} demo={c?.adapter === "mock"} onClose={() => setCustomOpen(false)} onStarted={invalidate} /> : null}
    </>
  );
}
