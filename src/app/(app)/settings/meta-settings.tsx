"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, FlaskConical, History, KeyRound, Lock, Pencil, PlugZap, Plus, RefreshCw, ShieldAlert, ShieldCheck, Trash2 } from "lucide-react";
import * as React from "react";
import { useMoney } from "@/components/app/currency";
import { useCan } from "@/components/app/use-can";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { ErrorState, Loading } from "@/components/ui/states";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { Term } from "@/components/ui/tooltip";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/core";
import { errorMessage, useTRPC } from "@/lib/trpc/client";

const STATUS_TONE = { CONNECTED: "positive", ERROR: "negative", UNTESTED: "warning", NOT_CONFIGURED: "warning", DISABLED: "neutral" } as const;
const STATUS_LABEL = { CONNECTED: msg("Connected"), ERROR: msg("Needs attention"), UNTESTED: msg("Saved, not verified"), NOT_CONFIGURED: msg("Not configured"), DISABLED: msg("Disabled") } as const;
const ACCOUNT_STATUS: Record<number, string> = { 1: msg("Active"), 2: msg("Disabled"), 3: msg("Unsettled"), 7: msg("Under review"), 8: msg("Pending settlement"), 9: msg("Grace period"), 100: msg("Closing"), 101: msg("Closed") };

const SETUP_STEPS = [
  msg("In Meta for Developers, create an app of type Business (or use one you already have), add the Marketing API to it, and connect it to this Business Manager."),
  msg("In Meta Business Settings, open Users → System users and add one, for example \"COD Flow Tracker\"."),
  msg("Choose Assign assets: give it the app, then every ad account you run ads from, with View performance access."),
  msg("Choose Generate new token, pick your app, tick the ads_read permission (it only shows once the app has the Marketing API), and set the expiry to Never."),
  msg("Copy the token and paste it below. Never send it in a chat or an email."),
];

/** What the token form is doing: adding a Business Manager, or editing a saved one. */
type Editing = { mode: "add" } | { mode: "replace" | "rename"; id: string; label: string } | null;

export function MetaTab() {
  const { t, tx, dateTime, ago } = useT();
  const money = useMoney();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const canManage = useCan("integrations.manage");
  const canSync = useCan("sync.run");
  const q = useQuery({ ...trpc.integrations.meta.queryOptions(), refetchInterval: (query) => (query.state.data?.syncing ? 3000 : false) });
  const ws = useQuery(trpc.workspace.getCurrent.queryOptions());
  const [editing, setEditing] = React.useState<Editing>(null);
  const [label, setLabel] = React.useState("");
  const [token, setToken] = React.useState("");
  const [confirmRemove, setConfirmRemove] = React.useState<{ id: string; label: string } | null>(null);
  const [result, setResult] = React.useState<{ id: string; ok: boolean; message: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: trpc.integrations.pathKey() });
  const onError = (e: unknown) => toast("error", errorMessage(e));
  const closeForm = () => { setEditing(null); setLabel(""); setToken(""); };
  const save = useMutation(trpc.integrations.saveMetaToken.mutationOptions({ onSuccess: (_d, v) => { closeForm(); setResult(null); refresh(); toast("success", v.token ? t("Token encrypted and saved. Run the connection test next.") : t("Name saved")); }, onError }));
  const test = useMutation(trpc.integrations.testMeta.mutationOptions({ onSuccess: (r, v) => { setResult({ id: v.id, ok: r.ok, message: r.message }); refresh(); }, onError }));
  const remove = useMutation(trpc.integrations.removeMetaToken.mutationOptions({ onSuccess: () => { setConfirmRemove(null); setResult(null); refresh(); toast("success", t("Token removed")); }, onError }));
  const interval = useMutation(trpc.integrations.setMetaInterval.mutationOptions({ onSuccess: () => { refresh(); toast("success", t("Sync interval saved")); }, onError }));
  const toggle = useMutation(trpc.integrations.setAdAccountEnabled.mutationOptions({ onSuccess: refresh, onError }));
  const sync = useMutation(trpc.integrations.syncMeta.mutationOptions({ onSuccess: (r) => { refresh(); toast("success", r.alreadyRunning ? t("A spend sync is already running") : t("Spend sync started")); }, onError }));
  if (q.error && !q.data) return <Card><ErrorState message={t("Meta ads settings could not be loaded: {error}", { error: errorMessage(q.error) })} /></Card>;
  if (!q.data) return <Card><Loading /></Card>;
  const c = q.data;
  const cur = ws.data?.currency ?? "DZD";
  const s = c.lastSyncSummary;
  const working = c.tokens.filter((tok) => tok.status === "CONNECTED").length;
  const form = canManage ? (!c.tokens.length ? ({ mode: "add" } as const) : editing) : null;
  const groups = [
    ...c.tokens.map((tok) => ({ key: tok.id, title: tok.label, accounts: c.accounts.filter((a) => a.tokenId === tok.id) })),
    { key: "none", title: t("No saved token can read these now"), accounts: c.accounts.filter((a) => !a.tokenId) },
  ].filter((g) => g.accounts.length);

  const tokenForm = form ? (
    <form
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface-2 p-4"
      autoComplete="off"
      onSubmit={(e) => {
        e.preventDefault();
        if (form.mode === "add") save.mutate({ label, token });
        else if (form.mode === "replace") save.mutate({ id: form.id, token });
        else save.mutate({ id: form.id, label });
      }}
    >
      {form.mode !== "rename" ? (
        <details className="text-xs text-muted" open={!c.tokens.length}>
          <summary className="cursor-pointer font-medium text-fg">{t("How to get a read-only token")}</summary>
          <ol className="mt-2 flex list-decimal flex-col gap-1 ps-5">{SETUP_STEPS.map((step) => <li key={step}>{t(step)}</li>)}</ol>
          <p className="mt-2">{t("Meta sometimes renames these menus; the permission you need is always ads_read. Using several Business Managers? Repeat these steps in each one and add each token here.")}</p>
        </details>
      ) : null}
      {form.mode !== "replace" ? (
        <Field label={t("Name")} htmlFor="meta-label" help={t("Example: Main brand. Left empty, it is called Business Manager 1, 2 and so on. It is never sent to Meta.")} hint={t("Only for you, to tell your Business Managers apart.")}>
          <Input id="meta-label" name="meta-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} required={form.mode === "rename"} placeholder={`Business Manager ${c.tokens.length + 1}`} />
        </Field>
      ) : null}
      {form.mode !== "rename" ? (
        <Field label={form.mode === "replace" ? t("New access token for {name}", { name: form.label }) : t("Meta system user access token")} htmlFor="meta-token" help={t("A long code made in Meta Business Settings for a system user, with ads_read. It lets this app read your ad spend, never change your ads. Paste it only here.")} hint={t("Sent once over HTTPS, encrypted with AES-256-GCM, and never shown again.")}>
          <Input id="meta-token" name="meta-token" type="password" autoComplete="new-password" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)} required minLength={20} maxLength={1024} placeholder={t("Paste the token")} />
        </Field>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={save.isPending || (form.mode === "rename" ? !label.trim() : token.trim().length < 20)}>
          {form.mode === "rename" ? <><Pencil /> {t("Save name")}</> : <><Lock /> {t("Encrypt & save")}</>}
        </Button>
        {c.tokens.length ? <Button type="button" variant="ghost" onClick={closeForm}>{t("Cancel")}</Button> : null}
      </div>
    </form>
  ) : null;

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex min-w-0 flex-col gap-6">
        <Card>
          <CardHeader title={t("Meta ads connection")} description={t("Reads what each ad spent per day, from every ad account you allow, and puts it on the creative whose content ID is the ad ID. Nothing is ever changed in your ad accounts.")} help={t("Profit, POAS and cost per order all need your ad spend. Once a token passes its test, spend comes in by itself, with no files to upload.")} />
          <CardBody className="flex flex-col gap-5 text-sm">
            <div className="grid gap-3 sm:grid-cols-3">
              <div><p className="text-xs text-muted"><Term label={t("Status")} definition={t("Connected: at least one token passed Test connection and spend syncs run. Needs attention: a token failed; read its message. Saved, not verified: press Test connection.")} /></p><Badge tone={STATUS_TONE[c.status]} className="mt-1">{t(STATUS_LABEL[c.status])}</Badge></div>
              <div><p className="text-xs text-muted"><Term label={t("Business Managers")} definition={t("Saved: the tokens you added. Working: tokens that passed their test and that Meta still accepts. Only working tokens are used to read spend.")} /></p><p className="mt-1">{c.tokens.length ? t("{saved} saved, {working} working", { saved: c.tokens.length, working }) : t("None yet")}</p></div>
              <div><p className="text-xs text-muted"><Term label={t("Last successful spend sync")} definition={t("When the last spend sync finished with no error. Spend after that is not in your numbers yet; press Sync spend now to bring it in.")} /></p><p className="mt-1">{c.syncing ? <span className="text-info">{t("Syncing now…")}</span> : c.lastSuccessfulSyncAt ? dateTime(c.lastSuccessfulSyncAt) : t("Never")}</p></div>
            </div>

            {c.adapter === "mock" ? (
              <p className="flex items-start gap-2 rounded-lg border border-info/30 bg-info-soft p-3 text-info"><FlaskConical className="mt-0.5 size-4 shrink-0" /><span>{tx("Demo workspace: a mocked Meta account with no spend is used. No request is sent to Meta. Any token of 20 or more characters passes the test; one starting with {invalid} shows the error path.", { invalid: <code>invalid</code> })}</span></p>
            ) : c.tokens.length && !working ? (
              <p className="flex items-start gap-2 rounded-lg border border-info/30 bg-info-soft p-3 text-info"><PlugZap className="mt-0.5 size-4 shrink-0" /><span>{t("Spend syncs start after a token passes its connection test. The test only lists the ad accounts the token can read.")}</span></p>
            ) : null}

            {c.lastError ? <p className="rounded-lg border border-negative/30 bg-negative-soft p-3 text-negative" role="alert">{c.lastError}</p> : null}
            {!canManage ? <p className="flex items-center gap-2 text-warning"><ShieldAlert className="size-4" /> {t("Only workspace owners and admins can manage this connection.")}</p> : null}

            {canSync && c.status === "CONNECTED" ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" onClick={() => sync.mutate({ full: false })} disabled={sync.isPending || c.syncing}><RefreshCw /> {t("Sync spend now")}</Button>
                <Button variant="ghost" onClick={() => sync.mutate({ full: true })} disabled={sync.isPending || c.syncing} title={t("Re-read the last 180 days")}><History /> {t("Re-read 180 days")}</Button>
              </div>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t("Business Managers")} description={t("One read-only token per Business Manager. Every ad account each token can read shows up below. When two tokens can read the same account, it is read once, with the token saved first.")} help={t("A Business Manager is the Meta account that owns your ad accounts. Add one token for each of yours, then press Test connection on it.")} />
          <CardBody className="flex flex-col gap-4 text-sm">
            {c.tokens.map((tok) => {
              const line = {
                key: <span className="font-mono">{tok.maskedLabel}</span>,
                ago: ago(tok.credentialUpdatedAt),
                tested: tok.lastTestedAt ? dateTime(tok.lastTestedAt) : t("never"),
                n: tok.accounts,
              };
              return (
                <div key={tok.id} className="flex flex-col gap-3 rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 font-medium"><Building2 className="size-4 shrink-0 text-muted" /><span className="truncate">{tok.label}</span></p>
                      <p className="mt-1 text-xs text-muted">{tok.accounts === 1 ? tx("{key} · updated {ago} · 1 ad account · last test {tested}", line) : tx("{key} · updated {ago} · {n} ad accounts · last test {tested}", line)}</p>
                    </div>
                    <Badge tone={STATUS_TONE[tok.status]}>{t(STATUS_LABEL[tok.status])}</Badge>
                  </div>
                  {tok.lastError ? <p className="rounded-lg border border-negative/30 bg-negative-soft p-2 text-xs text-negative">{tok.lastError}</p> : null}
                  {/* A failed test is saved as the token's error above: show it once. */}
                  {result?.id === tok.id && (result.ok || result.message !== tok.lastError) ? <p className={`rounded-lg border p-2 text-xs ${result.ok ? "border-positive/30 bg-positive-soft text-positive" : "border-negative/30 bg-negative-soft text-negative"}`} role="status">{result.message}</p> : null}
                  {canManage ? (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant={tok.status === "CONNECTED" ? "outline" : "primary"} onClick={() => test.mutate({ id: tok.id })} disabled={test.isPending}><PlugZap /> {test.isPending && test.variables?.id === tok.id ? t("Testing…") : t("Test connection")}</Button>
                      <Button size="sm" variant="ghost" onClick={() => { setToken(""); setEditing({ mode: "replace", id: tok.id, label: tok.label }); }}><KeyRound /> {t("Replace token")}</Button>
                      <Button size="sm" variant="ghost" onClick={() => { setLabel(tok.label); setEditing({ mode: "rename", id: tok.id, label: tok.label }); }}><Pencil /> {t("Rename")}</Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmRemove({ id: tok.id, label: tok.label })}><Trash2 /> {t("Remove")}</Button>
                    </div>
                  ) : null}
                  {form && form.mode !== "add" && form.id === tok.id ? tokenForm : null}
                </div>
              );
            })}
            {form?.mode === "add" ? tokenForm : null}
            {canManage && c.tokens.length && !form ? (
              <div><Button variant="outline" onClick={() => { setLabel(""); setToken(""); setEditing({ mode: "add" }); }}><Plus /> {t("Add Business Manager")}</Button></div>
            ) : null}
          </CardBody>
        </Card>

        {groups.length ? (
          <Card>
            <CardHeader title={t("Ad accounts")} description={t("Every ad account your tokens can read is synced. Switch one off to stop reading its spend; spend already read still counts.")} help={t("An ad account is where Meta bills your ads. Each one is listed under the Business Manager whose token reads it.")} />
            <div className="overflow-x-auto">
              <Table>
                <THead><tr><Th><Term label={t("Sync")} definition={t("Ticked: this account's spend is read at every sync. Unticked: no new spend is read from it; spend already read stays in your numbers.")} /></Th><Th>{t("Account")}</Th><Th>{t("Currency")}</Th><Th>{t("Meta status")}</Th><Th>{t("Last synced")}</Th></tr></THead>
                {groups.map((g) => (
                  <tbody key={g.key}>
                    <tr className="bg-surface-2"><td colSpan={5} className={`px-3 py-2 text-xs font-medium ${g.key === "none" ? "text-warning" : "text-muted"}`}>{g.title}</td></tr>
                    {g.accounts.map((a) => (
                      <Tr key={a.id}>
                        <Td><input type="checkbox" className="size-4 accent-[#e1182c]" aria-label={t("Sync {name}", { name: a.name ?? a.externalId })} checked={a.enabled} disabled={!canManage || toggle.isPending} onChange={(e) => toggle.mutate({ id: a.id, enabled: e.target.checked })} /></Td>
                        <Td><p className="font-medium">{a.name ?? t("Unnamed account")}</p><p className="font-mono text-xs text-muted">{a.externalId}</p>{a.lastError ? <p className="mt-1 text-xs text-negative">{a.lastError}</p> : null}</Td>
                        <Td className="text-xs">{a.currency ?? "—"}{a.currency && a.currency !== cur ? <span className="block text-muted">{t("converted to {cur}", { cur })}</span> : null}</Td>
                        <Td className="text-xs">{a.accountStatus != null ? (ACCOUNT_STATUS[a.accountStatus] ? t(ACCOUNT_STATUS[a.accountStatus]) : t("Code {n}", { n: a.accountStatus })) : "—"}</Td>
                        <Td className="text-xs text-muted">{a.lastSyncedAt ? dateTime(a.lastSyncedAt) : t("Never")}</Td>
                      </Tr>
                    ))}
                  </tbody>
                ))}
              </Table>
            </div>
          </Card>
        ) : null}

        {s ? (
          <Card>
            <CardHeader title={t("Last spend sync")} description={c.lastSyncAttemptAt ? dateTime(c.lastSyncAttemptAt) : undefined} help={t("What the most recent spend sync read. Check it after Sync spend now to see if new days and spend came in.")} />
            <CardBody className="flex flex-col gap-3 text-sm">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  [t("Days read"), s.from && s.until ? `${s.from} → ${s.until}` : "—", t("The first and last day this sync asked Meta for, across all ad accounts.")],
                  [t("Ad accounts"), String(s.accounts ?? 0), t("Switched-on ad accounts this sync read with a working token.")],
                  [t("New / updated rows"), `${s.added ?? 0} / ${s.updated ?? 0}`, t("One row is one ad on one day. New: read for the first time. Updated: Meta changed its numbers since the last read.")],
                  [t("Spend read"), money.fmt(s.spend ?? 0, cur), t("Worked out as: the spend of every ad and day this sync read, changed or not, added up. Spend billed in another currency is converted with your exchange rates.")],
                ].map(([l, v, h]) => (
                  <div key={l} className="rounded-lg border border-border bg-surface-2 p-2"><p className="text-[11px] text-muted"><Term label={l} definition={h} /></p><p className="num font-semibold">{v}</p></div>
                ))}
              </div>
              {s.superseded ? <p className="text-xs text-muted">{s.superseded === 1 ? t("1 uploaded spend row for the same ads and days now count Meta's numbers instead, so nothing is counted twice.") : t("{n} uploaded spend rows for the same ads and days now count Meta's numbers instead, so nothing is counted twice.", { n: s.superseded })}</p> : null}
            </CardBody>
          </Card>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-col gap-6">
        <Card>
          <CardHeader title={t("How your tokens are protected")} help={t("Only owners and admins can add, test or remove tokens. To cut access at once, press Remove on the token, or delete the system user in Meta Business Settings.")} />
          <CardBody className="flex flex-col gap-2 text-xs text-muted">
            {[
              t("Each workspace uses its own tokens. There is no shared token."),
              t("Each token is encrypted at rest with AES-256-GCM and bound to this workspace."),
              t("Used only by server-side code, sent to Meta in a request header, never in a URL."),
              t("Never returned to the browser or written to logs. Only the last 4 characters are shown."),
              t("Read-only: the app only reads ad accounts and their spend. It never creates, edits or pauses anything."),
              t("Saving, testing, removing a token and every sync are recorded in the audit log."),
            ].map((line) => <p key={line} className="flex gap-2"><ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-positive" />{line}</p>)}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("How spend is matched")} help={t("Orders and spend meet on the ad ID. If an ad's link doesn't send its ID as utm_content, its orders can't be matched to its spend.")} />
          <CardBody className="flex flex-col gap-2 text-xs text-muted">
            <p>{t("Each ad's spend goes to the creative whose content ID is the ad ID, the same ID your ad links send as utm_content. Orders from MDM carry that ID, so each creative gets its own spend, orders and deliveries, whichever ad account or Business Manager the ad runs in.")}</p>
            <p>{t("The first sync reads the last 180 days. After that, each sync re-reads the days since the previous one plus the last 3 days, because Meta keeps adjusting recent numbers.")}</p>
            <p>{t("Accounts billed in another currency are converted with the rate in Economics & currencies.")}</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("Sync interval")} description={t("Once a token passes its connection test, spend is synced automatically at this interval.")} help={t("How often spend is read by itself. Shorter keeps today's spend fresher in your reports. Sync spend now still works at any time.")} />
          <CardBody>
            <Select aria-label={t("Meta sync interval")} disabled={!canManage || interval.isPending} value={String(c.syncIntervalMinutes)} onChange={(e) => interval.mutate({ minutes: Number(e.target.value) })}>
              {[15, 30, 45, 60, 120, 240, 720, 1440].map((m) => <option key={m} value={m}>{m < 60 ? t("Every {n} minutes", { n: m }) : m === 60 ? t("Every 1 hour") : t("Every {n} hours", { n: m / 60 })}</option>)}
            </Select>
          </CardBody>
        </Card>
      </div>

      {confirmRemove ? (
        <Dialog open onOpenChange={(o) => !o && setConfirmRemove(null)}>
          <DialogContent title={t("Remove the token for {name}?", { name: confirmRemove.label })} description={t("Its ad accounts stop syncing until another saved token can read them. Spend already synced is kept.")}>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirmRemove(null)}>{t("Cancel")}</Button>
              <Button variant="danger" onClick={() => remove.mutate({ id: confirmRemove.id })} disabled={remove.isPending}>{t("Remove token")}</Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
