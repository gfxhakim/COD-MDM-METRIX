"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, History, KeyRound, Lock, PlugZap, RefreshCw, ShieldAlert, ShieldCheck, Trash2 } from "lucide-react";
import * as React from "react";
import { useCan } from "@/components/app/use-can";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { Loading } from "@/components/ui/states";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { formatMoney } from "@/lib/money";
import { errorMessage, useTRPC } from "@/lib/trpc/client";
import { formatDateTime, timeAgo } from "@/lib/utils";

const STATUS_TONE = { CONNECTED: "positive", ERROR: "negative", UNTESTED: "warning", NOT_CONFIGURED: "warning", DISABLED: "neutral" } as const;
const STATUS_LABEL = { CONNECTED: "Connected", ERROR: "Needs attention", UNTESTED: "Saved, not verified", NOT_CONFIGURED: "Not configured", DISABLED: "Disabled" } as const;
const ACCOUNT_STATUS: Record<number, string> = { 1: "Active", 2: "Disabled", 3: "Unsettled", 7: "Under review", 8: "Pending settlement", 9: "Grace period", 100: "Closing", 101: "Closed" };

const SETUP_STEPS = [
  "In Meta for Developers, create an app of type Business (or use one you already have) and connect it to your business.",
  "In Meta Business Settings, open Users → System users and add one, for example \"COD Flow Tracker\".",
  "Choose Assign assets → Ad accounts, select every ad account you run ads from, and give it View performance access.",
  "Choose Generate new token, pick your app, tick the ads_read permission, and set the expiry to Never.",
  "Copy the token and paste it below. Never send it in a chat or an email.",
];

export function MetaTab() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const canManage = useCan("integrations.manage");
  const canSync = useCan("sync.run");
  const q = useQuery({ ...trpc.integrations.meta.queryOptions(), refetchInterval: (query) => (query.state.data?.syncing ? 3000 : false) });
  const ws = useQuery(trpc.workspace.getCurrent.queryOptions());
  const [token, setToken] = React.useState("");
  const [editing, setEditing] = React.useState(false);
  const [confirmRemove, setConfirmRemove] = React.useState(false);
  const [result, setResult] = React.useState<{ ok: boolean; message: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: trpc.integrations.pathKey() });
  const onError = (e: unknown) => toast("error", errorMessage(e));
  const save = useMutation(trpc.integrations.saveMetaToken.mutationOptions({ onSuccess: () => { setToken(""); setEditing(false); setResult(null); refresh(); toast("success", "Token encrypted and saved. Run the connection test next."); }, onError }));
  const test = useMutation(trpc.integrations.testMeta.mutationOptions({ onSuccess: (r) => { setResult(r); refresh(); }, onError }));
  const remove = useMutation(trpc.integrations.removeMetaToken.mutationOptions({ onSuccess: () => { setConfirmRemove(false); setResult(null); refresh(); toast("success", "Token removed"); }, onError }));
  const interval = useMutation(trpc.integrations.setMetaInterval.mutationOptions({ onSuccess: () => { refresh(); toast("success", "Sync interval saved"); }, onError }));
  const toggle = useMutation(trpc.integrations.setAdAccountEnabled.mutationOptions({ onSuccess: refresh, onError }));
  const sync = useMutation(trpc.integrations.syncMeta.mutationOptions({ onSuccess: (r) => { refresh(); toast("success", r.alreadyRunning ? "A spend sync is already running" : "Spend sync started"); }, onError }));
  if (!q.data) return <Card><Loading /></Card>;
  const c = q.data;
  const cur = ws.data?.currency ?? "DZD";
  const s = c.lastSyncSummary;
  const showForm = canManage && (!c.hasToken || editing);

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex min-w-0 flex-col gap-6">
        <Card>
          <CardHeader title="Meta ads connection" description="Reads what each ad spent per day, from every ad account you allow, and puts it on the creative whose content ID is the ad ID. Nothing is ever changed in your ad accounts." />
          <CardBody className="flex flex-col gap-5 text-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              <div><p className="text-xs text-muted">Status</p><Badge tone={STATUS_TONE[c.status]} className="mt-1">{STATUS_LABEL[c.status]}</Badge></div>
              <div><p className="text-xs text-muted">Access token</p><p className="mt-1 font-mono text-xs">{c.maskedLabel ?? "None saved"}{c.credentialUpdatedAt ? <span className="ml-2 font-sans text-muted">updated {timeAgo(c.credentialUpdatedAt)}</span> : null}</p></div>
              <div><p className="text-xs text-muted">Last connection test</p><p className="mt-1">{c.lastTestedAt ? formatDateTime(c.lastTestedAt) : "Never"}</p></div>
              <div><p className="text-xs text-muted">Last successful spend sync</p><p className="mt-1">{c.syncing ? <span className="text-info">Syncing now…</span> : c.lastSuccessfulSyncAt ? formatDateTime(c.lastSuccessfulSyncAt) : "Never"}</p></div>
            </div>

            {c.adapter === "mock" ? (
              <p className="flex items-start gap-2 rounded-lg border border-info/30 bg-info-soft p-3 text-info"><FlaskConical className="mt-0.5 size-4 shrink-0" /><span>Demo workspace: a mocked Meta account with no spend is used. No request is sent to Meta. Any token of 20 or more characters passes the test; one starting with <code>invalid</code> shows the error path.</span></p>
            ) : c.hasToken && c.status !== "CONNECTED" ? (
              <p className="flex items-start gap-2 rounded-lg border border-info/30 bg-info-soft p-3 text-info"><PlugZap className="mt-0.5 size-4 shrink-0" /><span>Spend syncs start after a successful connection test. The test only lists the ad accounts the token can read.</span></p>
            ) : null}

            {c.lastError ? <p className="rounded-lg border border-negative/30 bg-negative-soft p-3 text-negative" role="alert">{c.lastError}</p> : null}
            {result ? <p className={`rounded-lg border p-3 ${result.ok ? "border-positive/30 bg-positive-soft text-positive" : "border-negative/30 bg-negative-soft text-negative"}`} role="status">{result.message}</p> : null}
            {!canManage ? <p className="flex items-center gap-2 text-warning"><ShieldAlert className="size-4" /> Only workspace owners and admins can manage this connection.</p> : null}

            {showForm ? (
              <form className="flex flex-col gap-4 rounded-lg border border-border bg-surface-2 p-4" autoComplete="off" onSubmit={(e) => { e.preventDefault(); save.mutate({ token }); }}>
                <details className="text-xs text-muted" open={!c.hasToken}>
                  <summary className="cursor-pointer font-medium text-fg">How to get a read-only token</summary>
                  <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5">{SETUP_STEPS.map((t) => <li key={t}>{t}</li>)}</ol>
                  <p className="mt-2">Meta sometimes renames these menus; the permission you need is always ads_read.</p>
                </details>
                <Field label={c.hasToken ? "Replace access token" : "Meta system user access token"} htmlFor="meta-token" hint="Sent once over HTTPS, encrypted with AES-256-GCM, and never shown again.">
                  <Input id="meta-token" name="meta-token" type="password" autoComplete="new-password" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)} required minLength={20} maxLength={1024} placeholder="Paste the token" />
                </Field>
                <div className="flex gap-2">
                  <Button type="submit" variant="primary" disabled={save.isPending || token.trim().length < 20}><Lock /> Encrypt & save</Button>
                  {c.hasToken ? <Button type="button" variant="ghost" onClick={() => { setEditing(false); setToken(""); }}>Cancel</Button> : null}
                </div>
              </form>
            ) : null}

            {c.hasToken && !editing ? (
              <div className="flex flex-wrap gap-2">
                {canManage ? <Button variant={c.status === "CONNECTED" ? "outline" : "primary"} onClick={() => test.mutate()} disabled={test.isPending}><PlugZap /> {test.isPending ? "Testing…" : "Test connection"}</Button> : null}
                {canSync && c.status === "CONNECTED" ? <Button variant="primary" onClick={() => sync.mutate({ full: false })} disabled={sync.isPending || c.syncing}><RefreshCw /> Sync spend now</Button> : null}
                {canSync && c.status === "CONNECTED" ? <Button variant="ghost" onClick={() => sync.mutate({ full: true })} disabled={sync.isPending || c.syncing} title="Re-read the last 180 days"><History /> Re-read 180 days</Button> : null}
                {canManage ? <Button variant="ghost" onClick={() => setEditing(true)}><KeyRound /> Replace token</Button> : null}
                {canManage ? <Button variant="ghost" onClick={() => setConfirmRemove(true)}><Trash2 /> Remove token</Button> : null}
              </div>
            ) : null}
          </CardBody>
        </Card>

        {c.accounts.length ? (
          <Card>
            <CardHeader title="Ad accounts" description="Every ad account the token can read is synced. Switch one off to leave its spend out." />
            <div className="overflow-x-auto">
              <Table>
                <THead><tr><Th>Sync</Th><Th>Account</Th><Th>Currency</Th><Th>Meta status</Th><Th>Last synced</Th></tr></THead>
                <tbody>
                  {c.accounts.map((a) => (
                    <Tr key={a.id}>
                      <Td><input type="checkbox" className="size-4 accent-[#b6f24a]" aria-label={`Sync ${a.name ?? a.externalId}`} checked={a.enabled} disabled={!canManage || toggle.isPending} onChange={(e) => toggle.mutate({ id: a.id, enabled: e.target.checked })} /></Td>
                      <Td><p className="font-medium">{a.name ?? "Unnamed account"}</p><p className="font-mono text-xs text-muted">{a.externalId}</p>{a.lastError ? <p className="mt-1 text-xs text-negative">{a.lastError}</p> : null}</Td>
                      <Td className="text-xs">{a.currency ?? "—"}{a.currency && a.currency !== cur ? <span className="block text-muted">converted to {cur}</span> : null}</Td>
                      <Td className="text-xs">{a.accountStatus != null ? ACCOUNT_STATUS[a.accountStatus] ?? `Code ${a.accountStatus}` : "—"}{c.lastTestedAt && a.lastSeenAt && new Date(a.lastSeenAt) < new Date(c.lastTestedAt) ? <span className="block text-warning">no longer visible to the token</span> : null}</Td>
                      <Td className="text-xs text-muted">{a.lastSyncedAt ? formatDateTime(a.lastSyncedAt) : "Never"}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </Card>
        ) : null}

        {s ? (
          <Card>
            <CardHeader title="Last spend sync" description={c.lastSyncAttemptAt ? formatDateTime(c.lastSyncAttemptAt) : undefined} />
            <CardBody className="flex flex-col gap-3 text-sm">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[["Days read", s.from && s.until ? `${s.from} → ${s.until}` : "—"], ["Ad accounts", String(s.accounts ?? 0)], ["New / updated rows", `${s.added ?? 0} / ${s.updated ?? 0}`], ["Spend read", formatMoney(s.spend ?? 0, cur)]].map(([l, v]) => (
                  <div key={l} className="rounded-lg border border-border bg-surface-2 p-2"><p className="text-[11px] text-muted">{l}</p><p className="num font-semibold">{v}</p></div>
                ))}
              </div>
              {s.superseded ? <p className="text-xs text-muted">{s.superseded} uploaded spend row{s.superseded === 1 ? "" : "s"} for the same ads and days now count Meta&apos;s numbers instead, so nothing is counted twice.</p> : null}
            </CardBody>
          </Card>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-col gap-6">
        <Card>
          <CardHeader title="How your token is protected" />
          <CardBody className="flex flex-col gap-2 text-xs text-muted">
            {[
              "Each workspace uses its own token. There is no shared token.",
              "Encrypted at rest with AES-256-GCM and bound to this workspace.",
              "Used only by server-side code, sent to Meta in a request header, never in a URL.",
              "Never returned to the browser or written to logs. Only the last 4 characters are shown.",
              "Read-only: the app only reads ad accounts and their spend. It never creates, edits or pauses anything.",
              "Saving, testing, removing the token and every sync are recorded in the audit log.",
            ].map((t) => <p key={t} className="flex gap-2"><ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-positive" />{t}</p>)}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="How spend is matched" />
          <CardBody className="flex flex-col gap-2 text-xs text-muted">
            <p>Each ad&apos;s spend goes to the creative whose content ID is the ad ID, the same ID your ad links send as utm_content. Orders from MDM carry that ID, so each creative gets its own spend, orders and deliveries.</p>
            <p>The first sync reads the last 180 days. After that, each sync re-reads the days since the previous one plus the last 3 days, because Meta keeps adjusting recent numbers.</p>
            <p>Accounts billed in another currency are converted with the rate in Economics &amp; currencies.</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Sync interval" description="Once the connection test passes, spend is synced automatically at this interval." />
          <CardBody>
            <Select aria-label="Meta sync interval" disabled={!canManage || interval.isPending} value={String(c.syncIntervalMinutes)} onChange={(e) => interval.mutate({ minutes: Number(e.target.value) })}>
              {[15, 30, 45, 60, 120, 240, 720, 1440].map((m) => <option key={m} value={m}>Every {m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? "s" : ""}`}</option>)}
            </Select>
          </CardBody>
        </Card>
      </div>

      {confirmRemove ? (
        <Dialog open onOpenChange={(o) => !o && setConfirmRemove(false)}>
          <DialogContent title="Remove the Meta token?" description="Spend syncing stops until a new token is saved. Spend already synced is kept.">
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirmRemove(false)}>Cancel</Button>
              <Button variant="danger" onClick={() => remove.mutate()} disabled={remove.isPending}>Remove token</Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
