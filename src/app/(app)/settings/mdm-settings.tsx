"use client";

import type { NormalizedStatus } from "@prisma/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, KeyRound, Lock, PlugZap, ShieldAlert, ShieldCheck, Trash2 } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { ParcelStatusBadge } from "@/components/app/status";
import { useCan } from "@/components/app/use-can";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { Loading } from "@/components/ui/states";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { DEFAULT_MDM_STATUS_MAP } from "@/domain/statusMapping";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/core";
import { errorMessage, useTRPC } from "@/lib/trpc/client";

const STATUS_TONE = { CONNECTED: "positive", ERROR: "negative", UNTESTED: "warning", NOT_CONFIGURED: "warning", DISABLED: "neutral" } as const;
const STATUS_LABEL = { CONNECTED: msg("Connected"), ERROR: msg("Error"), UNTESTED: msg("Saved, not verified"), NOT_CONFIGURED: msg("Not configured"), DISABLED: msg("Disabled") } as const;
export const NORMALIZED: NormalizedStatus[] = ["PENDING", "CONFIRMED", "SHIPPED", "DELIVERED", "RETURNED", "LOST", "CANCELED", "EXCHANGED"];
const NORMALIZED_LABEL: Record<NormalizedStatus, string> = {
  PENDING: msg("pending"),
  CONFIRMED: msg("confirmed"),
  SHIPPED: msg("shipped"),
  DELIVERED: msg("delivered"),
  RETURNED: msg("returned"),
  LOST: msg("lost"),
  CANCELED: msg("canceled"),
  EXCHANGED: msg("exchanged"),
  UNKNOWN: msg("unknown"),
};

export function MdmTab() {
  const { t, tx, dateTime, ago } = useT();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const canManage = useCan("integrations.manage");
  const q = useQuery(trpc.integrations.mdm.queryOptions());
  const [credential, setCredential] = React.useState("");
  const [baseUrl, setBaseUrl] = React.useState("");
  const [editing, setEditing] = React.useState(false);
  const [confirmRemove, setConfirmRemove] = React.useState(false);
  const [result, setResult] = React.useState<{ ok: boolean; message: string; accountLabel?: string | null; unmappedStatuses?: string[] } | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: trpc.integrations.pathKey() });
    qc.invalidateQueries({ queryKey: trpc.workspace.dataHealth.queryKey() });
  };
  const save = useMutation(
    trpc.integrations.saveMdmCredential.mutationOptions({
      onSuccess: () => {
        setCredential("");
        setEditing(false);
        setResult(null);
        refresh();
        toast("success", t("Key encrypted and saved. Run the connection test next."));
      },
      onError: (e) => toast("error", errorMessage(e)),
    }),
  );
  const test = useMutation(trpc.integrations.testMdm.mutationOptions({ onSuccess: (r) => { setResult(r); refresh(); }, onError: (e) => toast("error", errorMessage(e)) }));
  const remove = useMutation(trpc.integrations.removeMdmCredential.mutationOptions({ onSuccess: () => { setConfirmRemove(false); setResult(null); refresh(); toast("success", t("Key removed")); }, onError: (e) => toast("error", errorMessage(e)) }));
  const interval = useMutation(trpc.integrations.setSyncInterval.mutationOptions({ onSuccess: () => { refresh(); toast("success", t("Sync interval saved")); }, onError: (e) => toast("error", errorMessage(e)) }));
  if (!q.data) return <Card><Loading /></Card>;
  const c = q.data;
  const showForm = canManage && (!c.hasCredential || editing);

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
      <Card>
        <CardHeader title={t("MDM Express connection")} description={t("This workspace's own MDM account. The key is encrypted on the server before it is stored, and the browser never sees it again.")} />
        <CardBody className="flex flex-col gap-5 text-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><p className="text-xs text-muted">{t("Status")}</p><Badge tone={STATUS_TONE[c.status]} className="mt-1">{t(STATUS_LABEL[c.status])}</Badge></div>
            <div><p className="text-xs text-muted">{t("API key")}</p><p className="mt-1 font-mono text-xs">{c.maskedLabel ?? t("None saved")}{c.credentialUpdatedAt ? <span className="ms-2 font-sans text-muted">{t("updated {ago}", { ago: ago(c.credentialUpdatedAt) })}</span> : null}</p></div>
            <div><p className="text-xs text-muted">{t("Last connection test")}</p><p className="mt-1">{c.lastTestedAt ? dateTime(c.lastTestedAt) : t("Never")}</p></div>
            <div><p className="text-xs text-muted">{t("Last successful sync")}</p><p className="mt-1">{c.lastSuccessfulSyncAt ? dateTime(c.lastSuccessfulSyncAt) : t("Never")}</p></div>
          </div>

          {c.adapter === "mock" ? (
            <p className="flex items-start gap-2 rounded-lg border border-info/30 bg-info-soft p-3 text-info"><FlaskConical className="mt-0.5 size-4 shrink-0" /><span>{tx("Demo workspace: syncs use a mocked adapter with clearly labelled demo fixtures. No request is sent to MDM. Any key starting with {demo} passes the test; one starting with {invalid} shows the error path.", { demo: <code>demo-</code>, invalid: <code>invalid</code> })}</span></p>
          ) : !c.liveAdapterReady ? (
            <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft p-3 text-warning"><ShieldAlert className="mt-0.5 size-4 shrink-0" /><span>{t("You can save your key now. The live connection test and sync switch on once the MDM Express API schema has been verified; until then no request is sent to MDM and your key stays encrypted and unused.")}</span></p>
          ) : c.status !== "CONNECTED" ? (
            <p className="flex items-start gap-2 rounded-lg border border-info/30 bg-info-soft p-3 text-info"><PlugZap className="mt-0.5 size-4 shrink-0" /><span>{t("Sync unlocks after a successful connection test. The test only reads your MDM profile and status list; it changes nothing in MDM.")}</span></p>
          ) : null}

          {c.lastError ? <p className="rounded-lg border border-negative/30 bg-negative-soft p-3 text-negative" role="alert">{c.lastError}</p> : null}
          {result ? <p className={`rounded-lg border p-3 ${result.ok ? "border-positive/30 bg-positive-soft text-positive" : "border-negative/30 bg-negative-soft text-negative"}`} role="status">{result.message}{result.ok && result.accountLabel ? <span className="mt-1 block text-xs">{result.accountLabel}</span> : null}{result.unmappedStatuses?.length ? <span className="mt-1 block font-mono text-xs">{result.unmappedStatuses.join(", ")}</span> : null}</p> : null}

          {!canManage ? <p className="flex items-center gap-2 text-warning"><ShieldAlert className="size-4" /> {t("Only workspace owners and admins can manage this connection.")}</p> : null}

          {showForm ? (
            <form
              className="flex flex-col gap-4 rounded-lg border border-border bg-surface-2 p-4"
              autoComplete="off"
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate({ credential, baseUrl: baseUrl || undefined });
              }}
            >
              <Field label={c.hasCredential ? t("Replace API key") : t("MDM Express API key")} htmlFor="mdm-key" hint={t("Find it in your MDM Express account. It is sent once over HTTPS, encrypted with AES-256-GCM, and never shown again.")}>
                <Input id="mdm-key" name="mdm-key" type="password" autoComplete="new-password" spellCheck={false} value={credential} onChange={(e) => setCredential(e.target.value)} required minLength={8} maxLength={512} placeholder={t("Paste your key")} />
              </Field>
              <details className="text-xs text-muted">
                <summary className="cursor-pointer">{t("Advanced")}</summary>
                <Field label={t("API base URL")} htmlFor="mdm-url" hint={t("Only allowlisted MDM hosts over https are accepted.")} className="mt-3">
                  <Input id="mdm-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={c.baseUrl} />
                </Field>
              </details>
              <div className="flex gap-2">
                <Button type="submit" variant="primary" disabled={save.isPending || credential.trim().length < 8}><Lock /> {t("Encrypt & save")}</Button>
                {c.hasCredential ? <Button type="button" variant="ghost" onClick={() => { setEditing(false); setCredential(""); }}>{t("Cancel")}</Button> : null}
              </div>
            </form>
          ) : null}

          {canManage && c.hasCredential && !editing ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => test.mutate()} disabled={test.isPending}><PlugZap /> {test.isPending ? t("Testing…") : t("Test connection")}</Button>
              <Button variant="outline" onClick={() => setEditing(true)}><KeyRound /> {t("Replace key")}</Button>
              <Button variant="ghost" onClick={() => setConfirmRemove(true)}><Trash2 /> {t("Remove key")}</Button>
              {c.status === "CONNECTED" ? <Button variant="ghost" asChild><Link href="/syncs">{t("Go to sync")}</Link></Button> : null}
            </div>
          ) : null}
        </CardBody>
      </Card>

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader title={t("How your key is protected")} />
          <CardBody className="flex flex-col gap-2 text-xs text-muted">
            {[
              t("Each workspace uses its own key. There is no shared key."),
              t("Encrypted at rest with AES-256-GCM and bound to this workspace."),
              t("Used only by server-side code. MDM is never called from your browser."),
              t("Never returned to the browser, written to logs or put in URLs. Only the last 4 characters are shown."),
              t("The connection test and syncs only read from MDM and never change anything there."),
              t("Syncs read your MDM orders (status, amount, products, content ID) and parcels. Customer names, addresses and IPs are never stored; phone numbers are kept only in hashed form."),
              t("Saving, testing and removing the key are recorded in the audit log."),
            ].map((line) => <p key={line} className="flex gap-2"><ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-positive" />{line}</p>)}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("Sync interval")} description={t("Once the connection test passes, an incremental sync runs automatically at this interval.")} />
          <CardBody>
            <Select aria-label={t("Sync interval")} disabled={!canManage || interval.isPending} value={String(c.syncIntervalMinutes)} onChange={(e) => interval.mutate({ minutes: Number(e.target.value) })}>
              {[15, 30, 45, 60, 120, 240, 720, 1440].map((m) => <option key={m} value={m}>{m < 60 ? t("Every {n} minutes", { n: m }) : m === 60 ? t("Every 1 hour") : t("Every {n} hours", { n: m / 60 })}</option>)}
            </Select>
          </CardBody>
        </Card>
      </div>

      {confirmRemove ? (
        <Dialog open onOpenChange={(o) => !o && setConfirmRemove(false)}>
          <DialogContent title={t("Remove the MDM key?")} description={t("Syncing stops until a new key is saved. Parcels already synced are kept.")}>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirmRemove(false)}>{t("Cancel")}</Button>
              <Button variant="danger" onClick={() => remove.mutate()} disabled={remove.isPending}>{t("Remove key")}</Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

export function StatusMappingsTab() {
  const { t, dateTime } = useT();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const canEdit = useCan("settings.economics");
  const overrides = useQuery(trpc.sync.statusMappings.queryOptions());
  const unknown = useQuery(trpc.sync.unknownStatuses.queryOptions());
  const [picked, setPicked] = React.useState<Record<string, NormalizedStatus>>({});
  const map = useMutation(
    trpc.sync.mapStatus.mutationOptions({
      onSuccess: (r) => {
        for (const k of [trpc.sync, trpc.reports, trpc.orders, trpc.creatives]) qc.invalidateQueries({ queryKey: k.pathKey() });
        qc.invalidateQueries({ queryKey: trpc.workspace.dataHealth.queryKey() });
        toast("success", r.parcels === 1 ? t("Mapping saved, 1 parcel updated") : t("Mapping saved, {n} parcels updated", { n: r.parcels }));
      },
      onError: (e) => toast("error", errorMessage(e)),
    }),
  );
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-6">
        <Card>
          <CardHeader title={t("Unknown MDM statuses")} description={t("Parcels with these statuses count as UNKNOWN: never delivered or returned. Map each one once and existing parcels update immediately.")} />
          {!unknown.data ? <Loading /> : !unknown.data.length ? <p className="p-4 text-sm text-muted">{t("No unknown statuses.")}</p> : (
            <Table>
              <THead><tr><Th>{t("MDM status")}</Th><Th className="text-end">{t("Parcels")}</Th><Th>{t("Map to")}</Th><Th><span className="sr-only">{t("Save")}</span></Th></tr></THead>
              <tbody>
                {unknown.data.map((u) => {
                  const key = u.providerStatus ?? "";
                  return (
                    <Tr key={key}>
                      <Td className="font-mono text-xs">{u.providerStatus ?? t("(empty)")}</Td>
                      <Td className="num text-end">{u.parcels}</Td>
                      <Td>
                        <Select aria-label={t("Map {status}", { status: key })} disabled={!canEdit || !u.providerStatus} value={picked[key] ?? ""} onChange={(e) => setPicked({ ...picked, [key]: e.target.value as NormalizedStatus })} className="w-36">
                          <option value="">{t("Choose…")}</option>
                          {NORMALIZED.map((s) => <option key={s} value={s}>{t(NORMALIZED_LABEL[s])}</option>)}
                        </Select>
                      </Td>
                      <Td>{canEdit && u.providerStatus ? <Button size="sm" variant="outline" disabled={!picked[key] || map.isPending} onClick={() => map.mutate({ providerStatus: key, normalizedStatus: picked[key] })}>{t("Save")}</Button> : null}</Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader title={t("Workspace overrides")} />
          {!overrides.data?.length ? <p className="p-4 text-sm text-muted">{t("None yet.")}</p> : (
            <Table>
              <THead><tr><Th>{t("MDM status")}</Th><Th>{t("Normalized")}</Th><Th>{t("Updated")}</Th></tr></THead>
              <tbody>{overrides.data.map((m) => <Tr key={m.id}><Td className="font-mono text-xs">{m.providerStatus}</Td><Td><ParcelStatusBadge status={m.normalizedStatus} /></Td><Td className="text-xs text-muted">{dateTime(m.updatedAt)}</Td></Tr>)}</tbody>
            </Table>
          )}
        </Card>
      </div>
      <Card>
        <CardHeader title={t("Default mapping")} description={t("Applied when no workspace override exists.")} />
        <Table>
          <THead><tr><Th>{t("MDM status")}</Th><Th>{t("Normalized")}</Th></tr></THead>
          <tbody>{Object.entries(DEFAULT_MDM_STATUS_MAP).map(([k, v]) => <Tr key={k}><Td className="font-mono text-xs">{k}</Td><Td><ParcelStatusBadge status={v} /></Td></Tr>)}</tbody>
        </Table>
      </Card>
    </div>
  );
}
