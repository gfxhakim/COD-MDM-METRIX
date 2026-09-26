"use client";

import type { Role } from "@prisma/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { switchWorkspaceAction } from "@/app/(auth)/actions";
import { MoneyInput, minorToInput } from "@/components/app/money-input";
import { PageHeader } from "@/components/app/page-header";
import { useCan } from "@/components/app/use-can";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form";
import { ErrorState, Loading } from "@/components/ui/states";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { MdmTab, StatusMappingsTab } from "./mdm-settings";
import { parseToMinor } from "@/lib/money";
import { errorMessage, useTRPC } from "@/lib/trpc/client";
import { formatDateTime, humanize } from "@/lib/utils";

const ROLES: { role: Role; description: string }[] = [
  { role: "OWNER", description: "Everything, including members, roles and integrations." },
  { role: "ADMIN", description: "Operational data, imports, syncs, products, expenses and integrations." },
  { role: "ANALYST", description: "Read-only dashboards, reports and products." },
  { role: "OPERATOR", description: "Orders, sync review and manual matches. No access to credentials." },
];

function WorkspaceTab() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const router = useRouter();
  const ws = useQuery(trpc.workspace.getCurrent.queryOptions());
  const canManage = useCan("workspace.manage");
  const [name, setName] = React.useState<string | null>(null);
  const [newName, setNewName] = React.useState("");
  const update = useMutation(trpc.workspace.updateSettings.mutationOptions({ onSuccess: () => { qc.invalidateQueries({ queryKey: trpc.workspace.pathKey() }); toast("success", "Workspace saved"); router.refresh(); }, onError: (e) => toast("error", errorMessage(e)) }));
  const create = useMutation(
    trpc.workspace.create.mutationOptions({
      onSuccess: async (w) => { await switchWorkspaceAction(w.id); toast("success", `Workspace "${w.name}" created`); router.push("/"); router.refresh(); },
      onError: (e) => toast("error", errorMessage(e)),
    }),
  );
  if (!ws.data) return <Loading />;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Workspace" description="Each business is a separate workspace. Data never crosses workspaces." />
        <CardBody>
          <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (name) update.mutate({ name }); }}>
            <Field label="Business name" htmlFor="wsn"><Input id="wsn" value={name ?? ws.data.name} onChange={(e) => setName(e.target.value)} disabled={!canManage} /></Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Currency" htmlFor="wsc" hint="Set at creation"><Input id="wsc" value={ws.data.currency} disabled /></Field>
              <Field label="Timezone" htmlFor="wst"><Input id="wst" value={ws.data.timezone} disabled /></Field>
            </div>
            {ws.data.isDemo ? <Badge tone="warning" className="self-start">Demo workspace · synthetic data</Badge> : null}
            {canManage ? <Button variant="primary" type="submit" className="self-start" disabled={!name || update.isPending}>Save</Button> : <p className="text-xs text-subtle">Only owners can rename the workspace.</p>}
          </form>
        </CardBody>
      </Card>
      <Card id="new-workspace">
        <CardHeader title="New workspace" description="For another business or brand. You become its owner; nothing is shared with this workspace." />
        <CardBody>
          <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); create.mutate({ name: newName, currency: "DZD" }); }}>
            <Field label="Business name" htmlFor="nwn"><Input id="nwn" value={newName} onChange={(e) => setNewName(e.target.value)} required minLength={2} /></Field>
            <Button type="submit" className="self-start" disabled={create.isPending}>Create and switch</Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}

function MembersTab() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const canManage = useCan("members.manage");
  const members = useQuery(trpc.members.list.queryOptions());
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<Role>("ANALYST");
  const invalidate = () => qc.invalidateQueries({ queryKey: trpc.members.list.queryKey() });
  const onError = (e: unknown) => toast("error", errorMessage(e));
  const add = useMutation(trpc.members.add.mutationOptions({ onSuccess: () => { invalidate(); setEmail(""); toast("success", "Member added"); }, onError }));
  const change = useMutation(trpc.members.changeRole.mutationOptions({ onSuccess: () => { invalidate(); toast("success", "Role updated"); }, onError }));
  const remove = useMutation(trpc.members.remove.mutationOptions({ onSuccess: () => { invalidate(); toast("success", "Member removed"); }, onError }));
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <Card>
        <CardHeader title="Members" />
        {members.error ? <ErrorState message={errorMessage(members.error)} /> : !members.data ? <Loading /> : (
          <Table>
            <THead><tr><Th>Name</Th><Th>Email</Th><Th>Role</Th><Th>Since</Th><Th><span className="sr-only">Actions</span></Th></tr></THead>
            <tbody>
              {members.data.map((m) => (
                <Tr key={m.id}>
                  <Td>{m.name}</Td>
                  <Td className="text-muted">{m.email}</Td>
                  <Td>
                    {canManage ? (
                      <Select aria-label={`Role for ${m.name}`} value={m.role} onChange={(e) => change.mutate({ memberId: m.id, role: e.target.value as Role })} className="w-32">
                        {ROLES.map((r) => <option key={r.role} value={r.role}>{humanize(r.role)}</option>)}
                      </Select>
                    ) : <Badge>{humanize(m.role)}</Badge>}
                  </Td>
                  <Td className="text-xs text-muted">{formatDateTime(m.createdAt)}</Td>
                  <Td>{canManage ? <Button size="icon" variant="ghost" aria-label={`Remove ${m.name}`} onClick={() => confirm(`Remove ${m.name} from this workspace?`) && remove.mutate({ memberId: m.id })}><Trash2 /></Button> : null}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        {canManage ? (
          <form className="flex flex-wrap items-end gap-2 border-t border-border p-4" onSubmit={(e) => { e.preventDefault(); add.mutate({ email, role }); }}>
            <Field label="Add existing user by email" htmlFor="me" className="min-w-56 flex-1"><Input id="me" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
            <Field label="Role" htmlFor="mr"><Select id="mr" value={role} onChange={(e) => setRole(e.target.value as Role)} className="w-32">{ROLES.map((r) => <option key={r.role} value={r.role}>{humanize(r.role)}</option>)}</Select></Field>
            <Button type="submit" disabled={add.isPending}>Add member</Button>
          </form>
        ) : null}
      </Card>
      <Card>
        <CardHeader title="Roles" />
        <CardBody className="flex flex-col gap-3 text-sm">
          {ROLES.map((r) => (
            <div key={r.role}><p className="font-medium">{humanize(r.role)}</p><p className="text-xs text-muted">{r.description}</p></div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}

function EconomicsTab() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const canEdit = useCan("settings.economics");
  const ws = useQuery(trpc.workspace.getCurrent.queryOptions());
  const [form, setForm] = React.useState<Record<string, string> | null>(null);
  const update = useMutation(trpc.workspace.updateSettings.mutationOptions({ onSuccess: () => { qc.invalidateQueries({ queryKey: trpc.workspace.pathKey() }); toast("success", "Settings saved"); }, onError: (e) => toast("error", errorMessage(e)) }));
  if (!ws.data) return <Loading />;
  const d = ws.data.economicsDefaults;
  const v = ws.data.verdictThresholds;
  const cur = ws.data.currency;
  const f = form ?? {
    forwardShippingFee: minorToInput(d.forwardShippingFee, cur),
    rtoFee: minorToInput(d.rtoFee, cur),
    callCenterFee: minorToInput(d.callCenterFee, cur),
    packagingFee: minorToInput(d.packagingFee, cur),
    callCenterBasis: d.callCenterBasis,
    overheadPolicy: d.overheadPolicy,
    revenueView: d.revenueView,
    minSampleOrders: String(v.minSampleOrders),
    targetPoas: String(v.targetPoas),
    minDeliveryRate: String(Math.round(v.minDeliveryRate * 100)),
    maxRtoRate: String(Math.round(v.maxRtoRate * 100)),
    acceptablePlacedCpa: minorToInput(v.acceptablePlacedCpa, cur),
  };
  const set = (k: string) => (val: string) => setForm({ ...f, [k]: val });
  function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      update.mutate({
        economicsDefaults: {
          forwardShippingFee: parseToMinor(f.forwardShippingFee, cur),
          rtoFee: parseToMinor(f.rtoFee, cur),
          callCenterFee: parseToMinor(f.callCenterFee, cur),
          packagingFee: parseToMinor(f.packagingFee, cur),
          callCenterBasis: f.callCenterBasis as typeof d.callCenterBasis,
          overheadPolicy: f.overheadPolicy as typeof d.overheadPolicy,
          revenueView: f.revenueView as typeof d.revenueView,
        },
        verdictThresholds: {
          minSampleOrders: Number.parseInt(f.minSampleOrders, 10),
          targetPoas: Number.parseFloat(f.targetPoas),
          minDeliveryRate: Number.parseFloat(f.minDeliveryRate) / 100,
          maxRtoRate: Number.parseFloat(f.maxRtoRate) / 100,
          acceptablePlacedCpa: parseToMinor(f.acceptablePlacedCpa, cur),
        },
      });
    } catch (err) {
      toast("error", (err as Error).message);
    }
  }
  return (
    <form onSubmit={save} className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Economics defaults" description="Fallback fees when a product has no cost version for a date, and how shared costs are applied." />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Forward shipping fee" htmlFor="fsf"><MoneyInput id="fsf" currency={cur} value={f.forwardShippingFee} onChange={set("forwardShippingFee")} disabled={!canEdit} /></Field>
          <Field label="RTO fee" htmlFor="rto"><MoneyInput id="rto" currency={cur} value={f.rtoFee} onChange={set("rtoFee")} disabled={!canEdit} /></Field>
          <Field label="Call-center fee" htmlFor="ccf"><MoneyInput id="ccf" currency={cur} value={f.callCenterFee} onChange={set("callCenterFee")} disabled={!canEdit} /></Field>
          <Field label="Packaging fee" htmlFor="pkf"><MoneyInput id="pkf" currency={cur} value={f.packagingFee} onChange={set("packagingFee")} disabled={!canEdit} /></Field>
          <Field label="Call-center cost basis" htmlFor="ccb">
            <Select id="ccb" value={f.callCenterBasis} onChange={(e) => set("callCenterBasis")(e.target.value)} disabled={!canEdit}>
              <option value="PLACED_LEAD">Per placed lead</option><option value="CONFIRMED_ORDER">Per confirmed order</option><option value="CALL_ATTEMPT">Per call attempt</option>
            </Select>
          </Field>
          <Field label="Overhead allocation" htmlFor="ovh">
            <Select id="ovh" value={f.overheadPolicy} onChange={(e) => set("overheadPolicy")(e.target.value)} disabled={!canEdit}>
              <option value="NONE">Do not allocate</option><option value="BY_DELIVERED_ORDERS">By delivered orders</option><option value="BY_REVENUE">By delivered revenue</option>
            </Select>
          </Field>
          <Field label="Revenue view" htmlFor="rv" hint="Delivered revenue and remitted cash are different views." className="sm:col-span-2">
            <Select id="rv" value={f.revenueView} onChange={(e) => set("revenueView")(e.target.value)} disabled={!canEdit}>
              <option value="DELIVERED">Delivered revenue</option><option value="REMITTED">Cash remitted</option>
            </Select>
          </Field>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Verdict thresholds" description="Used for SCALE / WATCH / KILL / BAD TRAFFIC creative verdicts." />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Minimum sample (orders)" htmlFor="mso"><Input id="mso" type="number" min={1} value={f.minSampleOrders} onChange={(e) => set("minSampleOrders")(e.target.value)} disabled={!canEdit} /></Field>
          <Field label="Target true POAS" htmlFor="tp"><Input id="tp" type="number" step="0.05" min={0} value={f.targetPoas} onChange={(e) => set("targetPoas")(e.target.value)} disabled={!canEdit} /></Field>
          <Field label="Minimum delivery rate (%)" htmlFor="mdr"><Input id="mdr" type="number" min={0} max={100} value={f.minDeliveryRate} onChange={(e) => set("minDeliveryRate")(e.target.value)} disabled={!canEdit} /></Field>
          <Field label="Maximum RTO rate (%)" htmlFor="mrr"><Input id="mrr" type="number" min={0} max={100} value={f.maxRtoRate} onChange={(e) => set("maxRtoRate")(e.target.value)} disabled={!canEdit} /></Field>
          <Field label="Acceptable placed CPA" htmlFor="apc" className="sm:col-span-2"><MoneyInput id="apc" currency={cur} value={f.acceptablePlacedCpa} onChange={set("acceptablePlacedCpa")} disabled={!canEdit} /></Field>
        </CardBody>
      </Card>
      {canEdit ? <div className="lg:col-span-2"><Button variant="primary" type="submit" disabled={update.isPending}>Save economics settings</Button></div> : <p className="text-xs text-subtle">Only owners and admins can change these settings.</p>}
    </form>
  );
}

function AuditTab() {
  const trpc = useTRPC();
  const canRead = useCan("audit.read");
  const q = useQuery({ ...trpc.audit.list.queryOptions({ limit: 100 }), enabled: canRead });
  if (!canRead) return <ErrorState message="Only owners and admins can read the audit log." />;
  return (
    <Card>
      <CardHeader title="Audit log" description="Credential changes, syncs, imports, deletions, role changes and manual matches. Secrets are never recorded." />
      {q.error ? <ErrorState message={errorMessage(q.error)} /> : !q.data ? <Loading /> : (
        <Table>
          <THead><tr><Th>When</Th><Th>Who</Th><Th>Action</Th><Th>Entity</Th><Th>Details</Th></tr></THead>
          <tbody>
            {q.data.items.map((a) => (
              <Tr key={a.id}>
                <Td className="text-xs text-muted">{formatDateTime(a.createdAt)}</Td>
                <Td className="text-xs">{a.actor?.name ?? "system"}</Td>
                <Td><Badge>{a.action}</Badge></Td>
                <Td className="text-xs text-muted">{a.entityType ?? "—"}</Td>
                <Td className="max-w-md truncate font-mono text-[11px] text-subtle">{a.metadata ? JSON.stringify(a.metadata) : ""}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

export function SettingsView({ initialTab }: { initialTab: string }) {
  const tab = initialTab === "new-workspace" ? "workspace" : initialTab;
  return (
    <>
      <PageHeader title="Settings" description="Workspace, people, economics assumptions and integrations." />
      <Tabs defaultValue={tab}>
        <TabsList className="mb-6">
          <TabsTrigger value="workspace">Workspace</TabsTrigger>
          <TabsTrigger value="members">Members & roles</TabsTrigger>
          <TabsTrigger value="economics">Economics & verdicts</TabsTrigger>
          <TabsTrigger value="mdm">MDM Express</TabsTrigger>
          <TabsTrigger value="mappings">Status mappings</TabsTrigger>
          <TabsTrigger value="audit">Audit log</TabsTrigger>
        </TabsList>
        <TabsContent value="workspace"><WorkspaceTab /></TabsContent>
        <TabsContent value="members"><MembersTab /></TabsContent>
        <TabsContent value="economics"><EconomicsTab /></TabsContent>
        <TabsContent value="mdm"><MdmTab /></TabsContent>
        <TabsContent value="mappings"><StatusMappingsTab /></TabsContent>
        <TabsContent value="audit"><AuditTab /></TabsContent>
      </Tabs>
    </>
  );
}
