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
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/core";
import { DataTab } from "./data-settings";
import { MdmTab, StatusMappingsTab } from "./mdm-settings";
import { MetaTab } from "./meta-settings";
import { CURRENCIES, parseToMinor, type CurrencyCode } from "@/lib/money";
import { errorMessage, useTRPC } from "@/lib/trpc/client";

const ROLE_LABEL: Record<Role, string> = { OWNER: msg("Owner"), ADMIN: msg("Admin"), ANALYST: msg("Analyst"), OPERATOR: msg("Operator") };

const ROLES: { role: Role; description: string }[] = [
  { role: "OWNER", description: msg("Everything, including members, roles and integrations.") },
  { role: "ADMIN", description: msg("Operational data, imports, syncs, products, expenses and integrations.") },
  { role: "ANALYST", description: msg("Read-only dashboards, reports and products.") },
  { role: "OPERATOR", description: msg("Orders, sync review and manual matches. No access to credentials.") },
];

function WorkspaceTab() {
  const { t } = useT();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const router = useRouter();
  const ws = useQuery(trpc.workspace.getCurrent.queryOptions());
  const canManage = useCan("workspace.manage");
  const canEconomics = useCan("settings.economics");
  const [name, setName] = React.useState<string | null>(null);
  const [report, setReport] = React.useState<string | null>(null);
  const [newName, setNewName] = React.useState("");
  const update = useMutation(trpc.workspace.updateSettings.mutationOptions({ onSuccess: () => { qc.invalidateQueries({ queryKey: trpc.workspace.pathKey() }); setName(null); setReport(null); toast("success", t("Workspace saved")); router.refresh(); }, onError: (e) => toast("error", errorMessage(e)) }));
  const create = useMutation(
    trpc.workspace.create.mutationOptions({
      onSuccess: async (w) => { await switchWorkspaceAction(w.id); toast("success", t('Workspace "{name}" created', { name: w.name })); router.push("/"); router.refresh(); },
      onError: (e) => toast("error", errorMessage(e)),
    }),
  );
  if (!ws.data) return <Loading />;
  const book = ws.data.currency;
  const shownIn = report ?? ws.data.reportCurrency;
  const reportChoices = [book, ...Object.keys(ws.data.exchangeRates).filter((c) => c !== book).sort()];
  const changed = !!name || shownIn !== ws.data.reportCurrency;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title={t("Workspace")} description={t("Each business is a separate workspace. Data never crosses workspaces.")} />
        <CardBody>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (changed) update.mutate({ ...(name ? { name } : {}), ...(shownIn !== ws.data.reportCurrency ? { reportCurrency: shownIn as CurrencyCode } : {}) });
            }}
          >
            <Field label={t("Business name")} htmlFor="wsn"><Input id="wsn" value={name ?? ws.data.name} onChange={(e) => setName(e.target.value)} disabled={!canManage} /></Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={t("Currency")} htmlFor="wsc" hint={t("Reports and totals are shown in this currency. Amounts stay stored in {currency} and are converted with your exchange rates.", { currency: book })}>
                <Select id="wsc" value={shownIn} onChange={(e) => setReport(e.target.value)} disabled={!canEconomics}>
                  {reportChoices.map((c) => <option key={c} value={c}>{c === book ? t("{currency} (stored)", { currency: c }) : c}</option>)}
                </Select>
              </Field>
              <Field label={t("Timezone")} htmlFor="wst"><Input id="wst" value={ws.data.timezone} disabled /></Field>
            </div>
            {ws.data.isDemo ? <Badge tone="warning" className="self-start">{t("Demo workspace · synthetic data")}</Badge> : null}
            {reportChoices.length === 1 && canEconomics ? <p className="text-xs text-muted">{t("To show amounts in another currency, add its rate under Economics & currencies first.")}</p> : null}
            {canManage || canEconomics ? <Button variant="primary" type="submit" className="self-start" disabled={!changed || update.isPending}>{t("Save")}</Button> : null}
            {!canManage ? <p className="text-xs text-subtle">{t("Only owners can rename the workspace.")}</p> : null}
          </form>
        </CardBody>
      </Card>
      <Card id="new-workspace">
        <CardHeader title={t("New workspace")} description={t("For another business or brand. You become its owner; nothing is shared with this workspace.")} />
        <CardBody>
          <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); create.mutate({ name: newName, currency: "DZD" }); }}>
            <Field label={t("Business name")} htmlFor="nwn"><Input id="nwn" value={newName} onChange={(e) => setNewName(e.target.value)} required minLength={2} /></Field>
            <Button type="submit" className="self-start" disabled={create.isPending}>{t("Create and switch")}</Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}

function MembersTab() {
  const { t, dateTime } = useT();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const canManage = useCan("members.manage");
  const members = useQuery(trpc.members.list.queryOptions());
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<Role>("ANALYST");
  const invalidate = () => qc.invalidateQueries({ queryKey: trpc.members.list.queryKey() });
  const onError = (e: unknown) => toast("error", errorMessage(e));
  const add = useMutation(trpc.members.add.mutationOptions({ onSuccess: () => { invalidate(); setEmail(""); toast("success", t("Member added")); }, onError }));
  const change = useMutation(trpc.members.changeRole.mutationOptions({ onSuccess: () => { invalidate(); toast("success", t("Role updated")); }, onError }));
  const remove = useMutation(trpc.members.remove.mutationOptions({ onSuccess: () => { invalidate(); toast("success", t("Member removed")); }, onError }));
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <Card>
        <CardHeader title={t("Members")} />
        {members.error ? <ErrorState message={errorMessage(members.error)} /> : !members.data ? <Loading /> : (
          <Table>
            <THead><tr><Th>{t("Name")}</Th><Th>{t("Email")}</Th><Th>{t("Role")}</Th><Th>{t("Since")}</Th><Th><span className="sr-only">{t("Actions")}</span></Th></tr></THead>
            <tbody>
              {members.data.map((m) => (
                <Tr key={m.id}>
                  <Td>{m.name}</Td>
                  <Td className="text-muted">{m.email}</Td>
                  <Td>
                    {canManage ? (
                      <Select aria-label={t("Role for {name}", { name: m.name })} value={m.role} onChange={(e) => change.mutate({ memberId: m.id, role: e.target.value as Role })} className="w-32">
                        {ROLES.map((r) => <option key={r.role} value={r.role}>{t(ROLE_LABEL[r.role])}</option>)}
                      </Select>
                    ) : <Badge>{t(ROLE_LABEL[m.role])}</Badge>}
                  </Td>
                  <Td className="text-xs text-muted">{dateTime(m.createdAt)}</Td>
                  <Td>{canManage ? <Button size="icon" variant="ghost" aria-label={t("Remove {name}", { name: m.name })} onClick={() => confirm(t("Remove {name} from this workspace?", { name: m.name })) && remove.mutate({ memberId: m.id })}><Trash2 /></Button> : null}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        {canManage ? (
          <form className="flex flex-wrap items-end gap-2 border-t border-border p-4" onSubmit={(e) => { e.preventDefault(); add.mutate({ email, role }); }}>
            <Field label={t("Add existing user by email")} htmlFor="me" className="min-w-56 flex-1"><Input id="me" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
            <Field label={t("Role")} htmlFor="mr"><Select id="mr" value={role} onChange={(e) => setRole(e.target.value as Role)} className="w-32">{ROLES.map((r) => <option key={r.role} value={r.role}>{t(ROLE_LABEL[r.role])}</option>)}</Select></Field>
            <Button type="submit" disabled={add.isPending}>{t("Add member")}</Button>
          </form>
        ) : null}
      </Card>
      <Card>
        <CardHeader title={t("Roles")} />
        <CardBody className="flex flex-col gap-3 text-sm">
          {ROLES.map((r) => (
            <div key={r.role}><p className="font-medium">{t(ROLE_LABEL[r.role])}</p><p className="text-xs text-muted">{t(r.description)}</p></div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}

function ExchangeRatesCard() {
  const { t } = useT();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const canEdit = useCan("settings.economics");
  const ws = useQuery(trpc.workspace.getCurrent.queryOptions());
  const [rows, setRows] = React.useState<{ currency: string; rate: string }[] | null>(null);
  const update = useMutation(
    trpc.workspace.updateSettings.mutationOptions({
      onSuccess: () => { qc.invalidateQueries({ queryKey: trpc.workspace.pathKey() }); setRows(null); toast("success", t("Exchange rates saved")); },
      onError: (e) => toast("error", errorMessage(e)),
    }),
  );
  if (!ws.data) return null;
  const cur = ws.data.currency;
  const list = rows ?? Object.entries(ws.data.exchangeRates).map(([currency, rate]) => ({ currency, rate: String(rate) }));
  const unused = CURRENCIES.filter((c) => c !== cur && !list.some((r) => r.currency === c));
  function save(e: React.FormEvent) {
    e.preventDefault();
    const out: Partial<Record<(typeof CURRENCIES)[number], number>> = {};
    for (const r of list) {
      const n = Number(r.rate);
      if (!(n > 0)) return toast("error", t("Enter how many {cur} one {currency} costs", { cur, currency: r.currency }));
      out[r.currency as (typeof CURRENCIES)[number]] = n;
    }
    update.mutate({ exchangeRates: out });
  }
  return (
    <Card>
      <CardHeader
        title={t("Exchange rates")}
        description={t('How many {cur} one unit of each currency costs you. They fill in product costs, expenses and ad spend paid in another currency; a saved amount keeps the rate it was entered with, so changing a rate here never changes past profit. They also let you show reports in that currency (Workspace, or "Show in" at the top of every page). Orders synced from MDM keep their own currency.', { cur })}
      />
      <CardBody>
        <form onSubmit={save} className="flex flex-col gap-3">
          {!list.length ? <p className="text-sm text-muted">{t("No rates yet. Add the currencies you pay suppliers, ads or tools in.")}</p> : null}
          {list.map((r, i) => (
            <div key={r.currency} className="flex items-center gap-2 text-sm">
              <label htmlFor={`fx-${r.currency}`} className="w-20 shrink-0 text-muted">1 {r.currency} =</label>
              <Input id={`fx-${r.currency}`} inputMode="decimal" className="num w-32" value={r.rate} disabled={!canEdit} required onChange={(e) => setRows(list.map((x, j) => (j === i ? { ...x, rate: e.target.value.replace(/[^\d.]/g, "") } : x)))} />
              <span className="text-muted">{cur}</span>
              {canEdit ? <Button type="button" size="icon" variant="ghost" aria-label={t("Remove the {currency} rate", { currency: r.currency })} onClick={() => setRows(list.filter((_, j) => j !== i))}><Trash2 /></Button> : null}
            </div>
          ))}
          {canEdit ? (
            <div className="flex flex-wrap items-center gap-2">
              {unused.length ? (
                <Select aria-label={t("Add a currency")} className="w-44" value="" onChange={(e) => e.target.value && setRows([...list, { currency: e.target.value, rate: "" }])}>
                  <option value="">{t("Add a currency…")}</option>
                  {unused.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              ) : null}
              <Button type="submit" variant="primary" disabled={update.isPending || rows === null}>{t("Save exchange rates")}</Button>
            </div>
          ) : <p className="text-xs text-subtle">{t("Only owners and admins can change exchange rates.")}</p>}
        </form>
      </CardBody>
    </Card>
  );
}

function EconomicsTab() {
  const { t } = useT();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const canEdit = useCan("settings.economics");
  const ws = useQuery(trpc.workspace.getCurrent.queryOptions());
  const [form, setForm] = React.useState<Record<string, string> | null>(null);
  const update = useMutation(trpc.workspace.updateSettings.mutationOptions({ onSuccess: () => { qc.invalidateQueries({ queryKey: trpc.workspace.pathKey() }); toast("success", t("Settings saved")); }, onError: (e) => toast("error", errorMessage(e)) }));
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
        <CardHeader title={t("Economics defaults")} description={t("Fallback fees when a product has no cost version for a date, and how shared costs are applied.")} />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label={t("Forward shipping fee")} htmlFor="fsf"><MoneyInput id="fsf" currency={cur} value={f.forwardShippingFee} onChange={set("forwardShippingFee")} disabled={!canEdit} /></Field>
          <Field label={t("RTO fee")} htmlFor="rto"><MoneyInput id="rto" currency={cur} value={f.rtoFee} onChange={set("rtoFee")} disabled={!canEdit} /></Field>
          <Field label={t("Call-center fee")} htmlFor="ccf"><MoneyInput id="ccf" currency={cur} value={f.callCenterFee} onChange={set("callCenterFee")} disabled={!canEdit} /></Field>
          <Field label={t("Packaging fee")} htmlFor="pkf"><MoneyInput id="pkf" currency={cur} value={f.packagingFee} onChange={set("packagingFee")} disabled={!canEdit} /></Field>
          <Field label={t("Call-center cost basis")} htmlFor="ccb">
            <Select id="ccb" value={f.callCenterBasis} onChange={(e) => set("callCenterBasis")(e.target.value)} disabled={!canEdit}>
              <option value="PLACED_LEAD">{t("Per placed lead")}</option><option value="CONFIRMED_ORDER">{t("Per confirmed order")}</option><option value="CALL_ATTEMPT">{t("Per call attempt")}</option>
            </Select>
          </Field>
          <Field label={t("Overhead allocation")} htmlFor="ovh">
            <Select id="ovh" value={f.overheadPolicy} onChange={(e) => set("overheadPolicy")(e.target.value)} disabled={!canEdit}>
              <option value="NONE">{t("Do not allocate")}</option><option value="BY_DELIVERED_ORDERS">{t("By delivered orders")}</option><option value="BY_REVENUE">{t("By delivered revenue")}</option>
            </Select>
          </Field>
          <Field label={t("Revenue view")} htmlFor="rv" hint={t("Delivered revenue and remitted cash are different views.")} className="sm:col-span-2">
            <Select id="rv" value={f.revenueView} onChange={(e) => set("revenueView")(e.target.value)} disabled={!canEdit}>
              <option value="DELIVERED">{t("Delivered revenue")}</option><option value="REMITTED">{t("Cash remitted")}</option>
            </Select>
          </Field>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t("Verdict thresholds")} description={t("Used for SCALE / WATCH / KILL / BAD TRAFFIC creative verdicts.")} />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label={t("Minimum sample (orders)")} htmlFor="mso"><Input id="mso" type="number" min={1} value={f.minSampleOrders} onChange={(e) => set("minSampleOrders")(e.target.value)} disabled={!canEdit} /></Field>
          <Field label={t("Target true POAS")} htmlFor="tp"><Input id="tp" type="number" step="0.05" min={0} value={f.targetPoas} onChange={(e) => set("targetPoas")(e.target.value)} disabled={!canEdit} /></Field>
          <Field label={t("Minimum delivery rate (%)")} htmlFor="mdr"><Input id="mdr" type="number" min={0} max={100} value={f.minDeliveryRate} onChange={(e) => set("minDeliveryRate")(e.target.value)} disabled={!canEdit} /></Field>
          <Field label={t("Maximum RTO rate (%)")} htmlFor="mrr"><Input id="mrr" type="number" min={0} max={100} value={f.maxRtoRate} onChange={(e) => set("maxRtoRate")(e.target.value)} disabled={!canEdit} /></Field>
          <Field label={t("Acceptable placed CPA")} htmlFor="apc" className="sm:col-span-2"><MoneyInput id="apc" currency={cur} value={f.acceptablePlacedCpa} onChange={set("acceptablePlacedCpa")} disabled={!canEdit} /></Field>
        </CardBody>
      </Card>
      {canEdit ? <div className="lg:col-span-2"><Button variant="primary" type="submit" disabled={update.isPending}>{t("Save economics settings")}</Button></div> : <p className="text-xs text-subtle">{t("Only owners and admins can change these settings.")}</p>}
    </form>
  );
}

function EconomicsAndRates() {
  return (
    <div className="flex flex-col gap-6">
      <EconomicsTab />
      <div className="grid gap-6 lg:grid-cols-2"><ExchangeRatesCard /></div>
    </div>
  );
}

function AuditTab() {
  const { t, dateTime } = useT();
  const trpc = useTRPC();
  const canRead = useCan("audit.read");
  const q = useQuery({ ...trpc.audit.list.queryOptions({ limit: 100 }), enabled: canRead });
  if (!canRead) return <ErrorState message={t("Only owners and admins can read the audit log.")} />;
  return (
    <Card>
      <CardHeader title={t("Audit log")} description={t("Credential changes, syncs, imports, deletions, role changes and manual matches. Secrets are never recorded.")} />
      {q.error ? <ErrorState message={errorMessage(q.error)} /> : !q.data ? <Loading /> : (
        <Table>
          <THead><tr><Th>{t("When")}</Th><Th>{t("Who")}</Th><Th>{t("Action")}</Th><Th>{t("Entity")}</Th><Th>{t("Details")}</Th></tr></THead>
          <tbody>
            {q.data.items.map((a) => (
              <Tr key={a.id}>
                <Td className="text-xs text-muted">{dateTime(a.createdAt)}</Td>
                <Td className="text-xs">{a.actor?.name ?? t("system")}</Td>
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
  const { t } = useT();
  const tab = initialTab === "new-workspace" ? "workspace" : initialTab;
  const canDeleteData = useCan("data.delete");
  return (
    <>
      <PageHeader title={t("Settings")} description={t("Workspace, people, economics assumptions, integrations and your data.")} />
      <Tabs defaultValue={tab}>
        <TabsList className="mb-6">
          <TabsTrigger value="workspace">{t("Workspace")}</TabsTrigger>
          <TabsTrigger value="members">{t("Members & roles")}</TabsTrigger>
          <TabsTrigger value="economics">{t("Economics & currencies")}</TabsTrigger>
          <TabsTrigger value="mdm">MDM Express</TabsTrigger>
          <TabsTrigger value="meta">{t("Meta ads")}</TabsTrigger>
          <TabsTrigger value="mappings">{t("Status mappings")}</TabsTrigger>
          <TabsTrigger value="audit">{t("Audit log")}</TabsTrigger>
          {canDeleteData ? <TabsTrigger value="data">{t("Your data")}</TabsTrigger> : null}
        </TabsList>
        <TabsContent value="workspace"><WorkspaceTab /></TabsContent>
        <TabsContent value="members"><MembersTab /></TabsContent>
        <TabsContent value="economics"><EconomicsAndRates /></TabsContent>
        <TabsContent value="mdm"><MdmTab /></TabsContent>
        <TabsContent value="meta"><MetaTab /></TabsContent>
        <TabsContent value="mappings"><StatusMappingsTab /></TabsContent>
        <TabsContent value="audit"><AuditTab /></TabsContent>
        <TabsContent value="data"><DataTab /></TabsContent>
      </Tabs>
    </>
  );
}
