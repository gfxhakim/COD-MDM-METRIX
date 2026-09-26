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
import { errorMessage, useTRPC } from "@/lib/trpc/client";
import { formatDateTime, timeAgo } from "@/lib/utils";

const STATUS_TONE = { CONNECTED: "positive", ERROR: "negative", UNTESTED: "warning", NOT_CONFIGURED: "warning", DISABLED: "neutral" } as const;
const STATUS_LABEL = { CONNECTED: "Connected", ERROR: "Error", UNTESTED: "Saved, not verified", NOT_CONFIGURED: "Not configured", DISABLED: "Disabled" } as const;
export const NORMALIZED: NormalizedStatus[] = ["PENDING", "CONFIRMED", "SHIPPED", "DELIVERED", "RETURNED", "LOST", "CANCELED", "EXCHANGED"];

export function MdmTab() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const canManage = useCan("integrations.manage");
  const q = useQuery(trpc.integrations.mdm.queryOptions());
  const [credential, setCredential] = React.useState("");
  const [baseUrl, setBaseUrl] = React.useState("");
  const [editing, setEditing] = React.useState(false);
  const [confirmRemove, setConfirmRemove] = React.useState(false);
  const [result, setResult] = React.useState<{ ok: boolean; message: string } | null>(null);
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
        toast("success", "Key encrypted and saved. Run the connection test next.");
      },
      onError: (e) => toast("error", errorMessage(e)),
    }),
  );
  const test = useMutation(trpc.integrations.testMdm.mutationOptions({ onSuccess: (r) => { setResult(r); refresh(); }, onError: (e) => toast("error", errorMessage(e)) }));
  const remove = useMutation(trpc.integrations.removeMdmCredential.mutationOptions({ onSuccess: () => { setConfirmRemove(false); setResult(null); refresh(); toast("success", "Key removed"); }, onError: (e) => toast("error", errorMessage(e)) }));
  const interval = useMutation(trpc.integrations.setSyncInterval.mutationOptions({ onSuccess: () => { refresh(); toast("success", "Sync interval saved"); }, onError: (e) => toast("error", errorMessage(e)) }));
  if (!q.data) return <Card><Loading /></Card>;
  const c = q.data;
  const showForm = canManage && (!c.hasCredential || editing);

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
      <Card>
        <CardHeader title="MDM Express connection" description="This workspace's own MDM account. The key is encrypted on the server before it is stored, and the browser never sees it again." />
        <CardBody className="flex flex-col gap-5 text-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><p className="text-xs text-muted">Status</p><Badge tone={STATUS_TONE[c.status]} className="mt-1">{STATUS_LABEL[c.status]}</Badge></div>
            <div><p className="text-xs text-muted">API key</p><p className="mt-1 font-mono text-xs">{c.maskedLabel ?? "None saved"}{c.credentialUpdatedAt ? <span className="ml-2 font-sans text-muted">updated {timeAgo(c.credentialUpdatedAt)}</span> : null}</p></div>
            <div><p className="text-xs text-muted">Last connection test</p><p className="mt-1">{c.lastTestedAt ? formatDateTime(c.lastTestedAt) : "Never"}</p></div>
            <div><p className="text-xs text-muted">Last successful sync</p><p className="mt-1">{c.lastSuccessfulSyncAt ? formatDateTime(c.lastSuccessfulSyncAt) : "Never"}</p></div>
          </div>

          {c.adapter === "mock" ? (
            <p className="flex items-start gap-2 rounded-lg border border-info/30 bg-info-soft p-3 text-info"><FlaskConical className="mt-0.5 size-4 shrink-0" /><span>Demo workspace: syncs use a mocked adapter with clearly labelled demo fixtures. No request is sent to MDM. Any key starting with <code>demo-</code> passes the test; one starting with <code>invalid</code> shows the error path.</span></p>
          ) : !c.liveAdapterReady ? (
            <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft p-3 text-warning"><ShieldAlert className="mt-0.5 size-4 shrink-0" /><span>You can save your key now. The live connection test and sync switch on once the MDM Express API schema has been verified; until then no request is sent to MDM and your key stays encrypted and unused.</span></p>
          ) : null}

          {c.lastError ? <p className="rounded-lg border border-negative/30 bg-negative-soft p-3 text-negative" role="alert">{c.lastError}</p> : null}
          {result ? <p className={`rounded-lg border p-3 ${result.ok ? "border-positive/30 bg-positive-soft text-positive" : "border-negative/30 bg-negative-soft text-negative"}`} role="status">{result.message}</p> : null}

          {!canManage ? <p className="flex items-center gap-2 text-warning"><ShieldAlert className="size-4" /> Only workspace owners and admins can manage this connection.</p> : null}

          {showForm ? (
            <form
              className="flex flex-col gap-4 rounded-lg border border-border bg-surface-2 p-4"
              autoComplete="off"
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate({ credential, baseUrl: baseUrl || undefined });
              }}
            >
              <Field label={c.hasCredential ? "Replace API key" : "MDM Express API key"} htmlFor="mdm-key" hint="Find it in your MDM Express account. It is sent once over HTTPS, encrypted with AES-256-GCM, and never shown again.">
                <Input id="mdm-key" name="mdm-key" type="password" autoComplete="new-password" spellCheck={false} value={credential} onChange={(e) => setCredential(e.target.value)} required minLength={8} maxLength={512} placeholder="Paste your key" />
              </Field>
              <details className="text-xs text-muted">
                <summary className="cursor-pointer">Advanced</summary>
                <Field label="API base URL" htmlFor="mdm-url" hint="Only allowlisted MDM hosts over https are accepted." className="mt-3">
                  <Input id="mdm-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={c.baseUrl} />
                </Field>
              </details>
              <div className="flex gap-2">
                <Button type="submit" variant="primary" disabled={save.isPending || credential.trim().length < 8}><Lock /> Encrypt & save</Button>
                {c.hasCredential ? <Button type="button" variant="ghost" onClick={() => { setEditing(false); setCredential(""); }}>Cancel</Button> : null}
              </div>
            </form>
          ) : null}

          {canManage && c.hasCredential && !editing ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => test.mutate()} disabled={test.isPending}><PlugZap /> {test.isPending ? "Testing…" : "Test connection"}</Button>
              <Button variant="outline" onClick={() => setEditing(true)}><KeyRound /> Replace key</Button>
              <Button variant="ghost" onClick={() => setConfirmRemove(true)}><Trash2 /> Remove key</Button>
              {c.status === "CONNECTED" ? <Button variant="ghost" asChild><Link href="/syncs">Go to sync</Link></Button> : null}
            </div>
          ) : null}
        </CardBody>
      </Card>

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader title="How your key is protected" />
          <CardBody className="flex flex-col gap-2 text-xs text-muted">
            {[
              "Each workspace uses its own key. There is no shared key.",
              "Encrypted at rest with AES-256-GCM and bound to this workspace.",
              "Used only by server-side code. MDM is never called from your browser.",
              "Never returned to the browser, written to logs or put in URLs. Only the last 4 characters are shown.",
              "The connection test is read-only and changes nothing in MDM.",
              "Saving, testing and removing the key are recorded in the audit log.",
            ].map((t) => <p key={t} className="flex gap-2"><ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-positive" />{t}</p>)}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Sync interval" description="Used by scheduled syncs." />
          <CardBody>
            <Select aria-label="Sync interval" disabled={!canManage || interval.isPending} value={String(c.syncIntervalMinutes)} onChange={(e) => interval.mutate({ minutes: Number(e.target.value) })}>
              {[15, 30, 45, 60, 120, 240, 720, 1440].map((m) => <option key={m} value={m}>Every {m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? "s" : ""}`}</option>)}
            </Select>
          </CardBody>
        </Card>
      </div>

      {confirmRemove ? (
        <Dialog open onOpenChange={(o) => !o && setConfirmRemove(false)}>
          <DialogContent title="Remove the MDM key?" description="Syncing stops until a new key is saved. Parcels already synced are kept.">
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirmRemove(false)}>Cancel</Button>
              <Button variant="danger" onClick={() => remove.mutate()} disabled={remove.isPending}>Remove key</Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

export function StatusMappingsTab() {
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
        toast("success", `Mapping saved, ${r.parcels} parcel${r.parcels === 1 ? "" : "s"} updated`);
      },
      onError: (e) => toast("error", errorMessage(e)),
    }),
  );
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader title="Unknown MDM statuses" description="Parcels with these statuses count as UNKNOWN: never delivered or returned. Map each one once and existing parcels update immediately." />
          {!unknown.data ? <Loading /> : !unknown.data.length ? <p className="p-4 text-sm text-muted">No unknown statuses.</p> : (
            <Table>
              <THead><tr><Th>MDM status</Th><Th className="text-right">Parcels</Th><Th>Map to</Th><Th><span className="sr-only">Save</span></Th></tr></THead>
              <tbody>
                {unknown.data.map((u) => {
                  const key = u.providerStatus ?? "";
                  return (
                    <Tr key={key}>
                      <Td className="font-mono text-xs">{u.providerStatus ?? "(empty)"}</Td>
                      <Td className="num text-right">{u.parcels}</Td>
                      <Td>
                        <Select aria-label={`Map ${key}`} disabled={!canEdit || !u.providerStatus} value={picked[key] ?? ""} onChange={(e) => setPicked({ ...picked, [key]: e.target.value as NormalizedStatus })} className="w-36">
                          <option value="">Choose…</option>
                          {NORMALIZED.map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}
                        </Select>
                      </Td>
                      <Td>{canEdit && u.providerStatus ? <Button size="sm" variant="outline" disabled={!picked[key] || map.isPending} onClick={() => map.mutate({ providerStatus: key, normalizedStatus: picked[key] })}>Save</Button> : null}</Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader title="Workspace overrides" />
          {!overrides.data?.length ? <p className="p-4 text-sm text-muted">None yet.</p> : (
            <Table>
              <THead><tr><Th>MDM status</Th><Th>Normalized</Th><Th>Updated</Th></tr></THead>
              <tbody>{overrides.data.map((m) => <Tr key={m.id}><Td className="font-mono text-xs">{m.providerStatus}</Td><Td><ParcelStatusBadge status={m.normalizedStatus} /></Td><Td className="text-xs text-muted">{formatDateTime(m.updatedAt)}</Td></Tr>)}</tbody>
            </Table>
          )}
        </Card>
      </div>
      <Card>
        <CardHeader title="Default mapping" description="Applied when no workspace override exists." />
        <Table>
          <THead><tr><Th>MDM status</Th><Th>Normalized</Th></tr></THead>
          <tbody>{Object.entries(DEFAULT_MDM_STATUS_MAP).map(([k, v]) => <Tr key={k}><Td className="font-mono text-xs">{k}</Td><Td><ParcelStatusBadge status={v} /></Td></Tr>)}</tbody>
        </Table>
      </Card>
    </div>
  );
}
