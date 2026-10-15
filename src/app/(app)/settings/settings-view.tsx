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
import { HelpTip, Term } from "@/components/ui/tooltip";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/core";
import { DataTab } from "./data-settings";
import { MdmTab, StatusMappingsTab } from "./mdm-settings";
import { MetaTab } from "./meta-settings";
import { DEF } from "@/lib/definitions";
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
        <CardHeader title={t("Workspace")} description={t("Each business is a separate workspace. Data never crosses workspaces.")} help={t("Everything here belongs to one business: its orders, products, ads, members and settings. Switch between your businesses from the account menu.")} />
        <CardBody>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (changed) update.mutate({ ...(name ? { name } : {}), ...(shownIn !== ws.data.reportCurrency ? { reportCurrency: shownIn as CurrencyCode } : {}) });
            }}
          >
            <Field label={t("Business name")} htmlFor="wsn" help={t("The name shown in the account menu, so you can tell your businesses apart. Example: Bella Shop.")}><Input id="wsn" value={name ?? ws.data.name} onChange={(e) => setName(e.target.value)} disabled={!canManage} /></Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={t("Currency")} htmlFor="wsc" help={t("The currency every page opens in, for everyone in this workspace. Each person can still pick another one for themselves with the currency picker at the top of the page.")} hint={t("Reports and totals are shown in this currency. Amounts stay stored in {currency} and are converted with your exchange rates.", { currency: book })}>
                <Select id="wsc" value={shownIn} onChange={(e) => setReport(e.target.value)} disabled={!canEconomics}>
                  {reportChoices.map((c) => <option key={c} value={c}>{c === book ? t("{currency} (stored)", { currency: c }) : c}</option>)}
                </Select>
              </Field>
              <Field label={t("Timezone")} htmlFor="wst" help={t("Decides when each day starts and ends in reports and date filters, so a late-night order counts on the right day. It can't be changed here.")}><Input id="wst" value={ws.data.timezone} disabled /></Field>
            </div>
            {ws.data.isDemo ? <Badge tone="warning" className="self-start">{t("Demo workspace · synthetic data")}</Badge> : null}
            {reportChoices.length === 1 && canEconomics ? <p className="text-xs text-muted">{t("To show amounts in another currency, add its rate under Economics & currencies first.")}</p> : null}
            {canManage || canEconomics ? <Button variant="primary" type="submit" className="self-start" disabled={!changed || update.isPending}>{t("Save")}</Button> : null}
            {!canManage ? <p className="text-xs text-subtle">{t("Only owners can rename the workspace.")}</p> : null}
          </form>
        </CardBody>
      </Card>
      <Card id="new-workspace">
        <CardHeader title={t("New workspace")} description={t("For another business or brand. You become its owner; nothing is shared with this workspace.")} help={t("Use it for a second brand or shop that you track apart. It starts empty and needs its own MDM key and Meta tokens.")} />
        <CardBody>
          <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); create.mutate({ name: newName, currency: "DZD" }); }}>
            <Field label={t("Business name")} htmlFor="nwn" help={t("The name of the new business, for example your second brand. You can rename it later in Settings > Workspace.")}><Input id="nwn" value={newName} onChange={(e) => setNewName(e.target.value)} required minLength={2} /></Field>
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
        <CardHeader title={t("Members")} help={t("Everyone who can open this workspace, each with their own login and role. Only an owner can add people, remove them or change their role.")} />
        {members.error ? <ErrorState message={errorMessage(members.error)} /> : !members.data ? <Loading /> : (
          <Table>
            <THead><tr><Th>{t("Name")}</Th><Th>{t("Email")}</Th><Th><Term label={t("Role")} definition={t("What each member may see and change. An owner can change it here, and it applies at once. The Roles card explains each one.")} /></Th><Th>{t("Since")}</Th><Th><span className="sr-only">{t("Actions")}</span></Th></tr></THead>
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
            <Field label={t("Add existing user by email")} htmlFor="me" className="min-w-56 flex-1" help={t("The email they used to sign up to this app. They need their own account first; once added, this workspace shows in their account menu.")}><Input id="me" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
            <Field label={t("Role")} htmlFor="mr" help={t("What the new member may see and do. Pick Analyst for someone who only reads reports, Operator for someone who handles orders. The Roles card explains each one.")}><Select id="mr" value={role} onChange={(e) => setRole(e.target.value as Role)} className="w-32">{ROLES.map((r) => <option key={r.role} value={r.role}>{t(ROLE_LABEL[r.role])}</option>)}</Select></Field>
            <Button type="submit" disabled={add.isPending}>{t("Add member")}</Button>
          </form>
        ) : null}
      </Card>
      <Card>
        <CardHeader title={t("Roles")} help={t("Also: Operators don't see Money & stock, and Analysts see customer names and phones partly hidden, without addresses. A workspace always keeps at least one owner.")} />
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
        help={t("Pick a currency in Add a currency, type what one unit costs you in {cur}, then press Save exchange rates. Example: 1 USD = 250.", { cur })}
      />
      <CardBody>
        <form onSubmit={save} className="flex flex-col gap-3">
          {!list.length ? <p className="text-sm text-muted">{t("No rates yet. Add the currencies you pay suppliers, ads or tools in.")}</p> : null}
          {list.map((r, i) => (
            <div key={r.currency} className="flex items-center gap-2 text-sm">
              <label htmlFor={`fx-${r.currency}`} className="w-20 shrink-0 text-muted">1 {r.currency} =<HelpTip label={t("{currency} rate", { currency: r.currency })} className="ms-1 align-middle">{t("How many {cur} you pay for 1 {currency}, for example at the bank or exchange office. Update it when the price you pay changes.", { cur, currency: r.currency })}</HelpTip></label>
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
        <CardHeader title={t("Economics defaults")} description={t("Fallback fees when a product has no cost version for a date, and how shared costs are applied.")} help={t("The four fees are used only when a product has no cost for the order's date and MDM sends none. The three choices apply to every report.")} />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label={t("Forward shipping fee")} htmlFor="fsf" help={t("What the carrier charges to take one parcel to the customer. Counted on every parcel that finished its trip: delivered, returned or lost. Example: 600.")}><MoneyInput id="fsf" currency={cur} value={f.forwardShippingFee} onChange={set("forwardShippingFee")} disabled={!canEdit} /></Field>
          <Field label={t("RTO fee")} htmlFor="rto" help={t("Extra fee the carrier charges when a parcel comes back to you, on top of the delivery fee. Counted on every returned parcel. Example: 200.")}><MoneyInput id="rto" currency={cur} value={f.rtoFee} onChange={set("rtoFee")} disabled={!canEdit} /></Field>
          <Field label={t("Call-center fee")} htmlFor="ccf" help={t("What the call center charges to call a customer and confirm the order. How often it counts is set in Call-center cost basis. Example: 100.")}><MoneyInput id="ccf" currency={cur} value={f.callCenterFee} onChange={set("callCenterFee")} disabled={!canEdit} /></Field>
          <Field label={t("Packaging fee")} htmlFor="pkf" help={t("Cost of the box or bag, tape and label for one parcel. Counted on every parcel that finished its trip: delivered, returned or lost. Example: 50.")}><MoneyInput id="pkf" currency={cur} value={f.packagingFee} onChange={set("packagingFee")} disabled={!canEdit} /></Field>
          <Field label={t("Call-center cost basis")} htmlFor="ccb" help={t("How many times the call-center fee is counted: once for every order placed, once per confirmed order, or once per call attempt recorded on the order.")}>
            <Select id="ccb" value={f.callCenterBasis} onChange={(e) => set("callCenterBasis")(e.target.value)} disabled={!canEdit}>
              <option value="PLACED_LEAD">{t("Per placed lead")}</option><option value="CONFIRMED_ORDER">{t("Per confirmed order")}</option><option value="CALL_ATTEMPT">{t("Per call attempt")}</option>
            </Select>
          </Field>
          <Field label={t("Overhead allocation")} htmlFor="ovh" help={t("How shared expenses like rent or salaries are split between products and ads: by delivered orders, by delivered revenue, or not split. Business totals always count them all.")}>
            <Select id="ovh" value={f.overheadPolicy} onChange={(e) => set("overheadPolicy")(e.target.value)} disabled={!canEdit}>
              <option value="NONE">{t("Do not allocate")}</option><option value="BY_DELIVERED_ORDERS">{t("By delivered orders")}</option><option value="BY_REVENUE">{t("By delivered revenue")}</option>
            </Select>
          </Field>
          <Field label={t("Revenue view")} htmlFor="rv" help={t("Which money profit counts by default: the COD value of delivered parcels, or only the cash the carrier has actually paid you. Dashboard, Creatives and Campaigns can switch it.")} hint={t("Delivered revenue and remitted cash are different views.")} className="sm:col-span-2">
            <Select id="rv" value={f.revenueView} onChange={(e) => set("revenueView")(e.target.value)} disabled={!canEdit}>
              <option value="DELIVERED">{t("Delivered revenue")}</option><option value="REMITTED">{t("Cash remitted")}</option>
            </Select>
          </Field>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t("Verdict thresholds")} description={t("Used for SCALE / WATCH / KILL / BAD TRAFFIC creative verdicts.")} help={t(DEF.verdict)} />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label={t("Minimum sample (orders)")} htmlFor="mso" help={t("Placed orders an ad needs before it can get SCALE or WATCH. With fewer it shows Not enough data, unless it already counts as KILL or BAD TRAFFIC. Example: 20.")}><Input id="mso" type="number" min={1} value={f.minSampleOrders} onChange={(e) => set("minSampleOrders")(e.target.value)} disabled={!canEdit} /></Field>
          <Field label={t("Target true POAS")} htmlFor="tp" help={t("POAS = true net profit ÷ ad spend. An ad at or above this target, with enough orders, gets SCALE. Example: 0.3 means 30% profit on top of what the ads cost.")}><Input id="tp" type="number" step="0.05" min={0} value={f.targetPoas} onChange={(e) => set("targetPoas")(e.target.value)} disabled={!canEdit} /></Field>
          <Field label={t("Minimum delivery rate (%)")} htmlFor="mdr" help={t("If an ad's placed CPA is acceptable but its delivery rate (delivered ÷ finished parcels) is under this, it gets BAD TRAFFIC once 10 parcels have finished. Example: 55.")}><Input id="mdr" type="number" min={0} max={100} value={f.minDeliveryRate} onChange={(e) => set("minDeliveryRate")(e.target.value)} disabled={!canEdit} /></Field>
          <Field label={t("Maximum RTO rate (%)")} htmlFor="mrr" help={t("If an ad's placed CPA is acceptable but its return rate (returned ÷ finished parcels) is above this, it gets BAD TRAFFIC once 10 parcels have finished. Example: 30.")}><Input id="mrr" type="number" min={0} max={100} value={f.maxRtoRate} onChange={(e) => set("maxRtoRate")(e.target.value)} disabled={!canEdit} /></Field>
          <Field label={t("Acceptable placed CPA")} htmlFor="apc" className="sm:col-span-2" help={t("Placed CPA = ad spend ÷ placed orders. At or under this, orders count as cheap for BAD TRAFFIC. An ad losing money after spending minimum sample × this gets KILL. Example: 800.")}><MoneyInput id="apc" currency={cur} value={f.acceptablePlacedCpa} onChange={set("acceptablePlacedCpa")} disabled={!canEdit} /></Field>
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
      <CardHeader title={t("Audit log")} description={t("Credential changes, syncs, imports, deletions, role changes and manual matches. Secrets are never recorded.")} help={t("Use it to check who changed what and when, for example who changed a role or removed a key. It shows the latest 100 actions.")} />
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
