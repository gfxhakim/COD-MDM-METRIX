"use client";

import type { inferRouterOutputs } from "@trpc/server";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Lock, PackageOpen, Pencil, RotateCcw, Save } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { useMoney } from "@/components/app/currency";
import { FitMoney } from "@/components/app/fit-money";
import { MoneyInput, minorToInput } from "@/components/app/money-input";
import { PageHeader } from "@/components/app/page-header";
import { useCan } from "@/components/app/use-can";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Chip } from "@/components/ui/choice";
import { Field, Input, Select } from "@/components/ui/form";
import { useSlidingPill } from "@/components/ui/sliding-pill";
import { EmptyState, ErrorState, Loading } from "@/components/ui/states";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { Term } from "@/components/ui/tooltip";
import {
  ACTUAL_LABEL,
  actualBreakdown,
  feesPerOrder,
  GAP_LABEL,
  productSummary,
  roundRate,
  seedFor,
  STOCK_SOURCE_LABEL,
  STOCK_SOURCES,
  stockPotential,
  stockProjection,
  stockUnitsFor,
  type CallCenterBasis,
  type FieldSource,
  type PlanOverrides,
  type ProfitPlan,
  type ProjectionInput,
  type Seed,
  type StockSource,
} from "@/domain/profitTracker";
import { RANGES, rangeDays, todayIn, type RangeKey } from "@/lib/dateRanges";
import { currencyExponent, parseToMinor } from "@/lib/money";
import { errorMessage, useTRPC } from "@/lib/trpc/client";
import { cn, formatPercent, timeAgo } from "@/lib/utils";
import type { AppRouter } from "@/server/trpc/root";
import { CostVersionDialog } from "../products/products-view";

type Tracker = inferRouterOutputs<AppRouter>["profit"]["tracker"];
type Row = Tracker["products"][number];

const count = (n: number) => Math.round(n).toLocaleString("en-US");

// ─────────────────────────── The form ───────────────────────────

type MoneyKey = "salePrice" | "unitCost" | "cpa" | "forwardShippingFee" | "rtoFee" | "callCenterFee" | "packagingFee" | "extraFeePerDelivered" | "otherCosts";
type RateKey = "confirmationRate" | "shippingRate" | "deliveryRate" | "returnRate" | "lostRate";
const MONEY_KEYS: MoneyKey[] = ["salePrice", "unitCost", "cpa", "forwardShippingFee", "rtoFee", "callCenterFee", "packagingFee", "extraFeePerDelivered", "otherCosts"];

type Form = Record<MoneyKey | RateKey | "unitsPerOrder" | "stockUnits", string> & {
  stockSource: StockSource;
  returnAuto: boolean;
  callCenterBasis: CallCenterBasis;
  includeFees: boolean;
};

const pctText = (v: number) => String(Math.round(v * 1000) / 10);

function toForm(seed: Seed, currency: string): Form {
  const i = seed.inputs;
  const money = Object.fromEntries(MONEY_KEYS.map((k) => [k, minorToInput(i[k], currency)])) as Record<MoneyKey, string>;
  return {
    ...money,
    stockSource: seed.stockSource,
    stockUnits: String(seed.units),
    unitsPerOrder: String(i.unitsPerOrder),
    confirmationRate: pctText(i.confirmationRate),
    shippingRate: pctText(i.shippingRate),
    deliveryRate: pctText(i.deliveryRate),
    returnAuto: i.returnRate === null,
    returnRate: pctText(i.returnRate ?? Math.max(0, 1 - i.deliveryRate - i.lostRate)),
    lostRate: pctText(i.lostRate),
    callCenterBasis: i.callCenterBasis,
    includeFees: seed.includeFees,
  };
}

type Parsed = { units: number; inputs: ProjectionInput; includeFees: boolean; problem: string | null };

function parseForm(f: Form, row: Row, currency: string): Parsed {
  let problem: string | null = null;
  const m = (k: MoneyKey) => {
    try {
      const v = parseToMinor(f[k] || "0", currency);
      if (v < 0) throw new Error();
      return v;
    } catch {
      problem ??= "One of the amounts isn't a number.";
      return 0;
    }
  };
  const p = (s: string) => {
    const v = Number.parseFloat((s || "0").replace(",", "."));
    if (!Number.isFinite(v) || v < 0 || v > 100) {
      problem ??= "Rates go from 0 to 100%.";
      return 0;
    }
    return roundRate(v / 100);
  };
  const typed = Number.parseInt(f.stockUnits || "0", 10);
  const units = f.stockSource === "TYPED" ? (Number.isFinite(typed) && typed >= 0 ? typed : 0) : stockUnitsFor(f.stockSource, row.stock, null);
  const u = Number.parseFloat((f.unitsPerOrder || "1").replace(",", "."));
  const inputs: ProjectionInput = {
    units,
    salePrice: m("salePrice"),
    unitCost: m("unitCost"),
    unitsPerOrder: Number.isFinite(u) && u >= 1 ? Math.min(u, 100) : 1,
    confirmationRate: p(f.confirmationRate),
    shippingRate: p(f.shippingRate),
    deliveryRate: p(f.deliveryRate),
    returnRate: f.returnAuto ? null : p(f.returnRate),
    lostRate: p(f.lostRate),
    cpa: m("cpa"),
    forwardShippingFee: m("forwardShippingFee"),
    rtoFee: m("rtoFee"),
    callCenterFee: m("callCenterFee"),
    callCenterBasis: f.callCenterBasis,
    packagingFee: m("packagingFee"),
    extraFeePerDelivered: m("extraFeePerDelivered"),
    otherCosts: m("otherCosts"),
  };
  return { units, inputs, includeFees: f.includeFees, problem };
}

/**
 * What to save for the product: only what differs from the data's own values (`base`, read through
 * the same form so rounded rates compare equal). Null when nothing does.
 */
function planOf(parsed: Parsed, f: Form, base: { form: Form; parsed: Parsed }): ProfitPlan | null {
  const o: PlanOverrides = {};
  const i = parsed.inputs;
  const d = base.parsed.inputs;
  for (const k of MONEY_KEYS) if (i[k] !== d[k]) o[k] = i[k];
  for (const k of ["confirmationRate", "shippingRate", "deliveryRate", "lostRate"] as const) if (Math.abs(i[k] - d[k]) > 1e-9) o[k] = i[k];
  if (i.returnRate !== null) o.returnRate = i.returnRate;
  if (i.unitsPerOrder !== d.unitsPerOrder) o.unitsPerOrder = i.unitsPerOrder;
  if (i.callCenterBasis !== d.callCenterBasis) o.callCenterBasis = i.callCenterBasis;
  if (parsed.includeFees) o.includeFees = true;
  const typed = f.stockSource === "TYPED";
  const sameStock = f.stockSource === base.form.stockSource && (!typed || parsed.units === base.parsed.units);
  if (Object.keys(o).length === 0 && sameStock) return null;
  return { stockSource: f.stockSource, stockUnits: typed ? parsed.units : null, overrides: o };
}

const samePlan = (a: ProfitPlan | null, b: ProfitPlan | null) => {
  if (!a || !b) return a === b;
  const sorted = (p: ProfitPlan) => JSON.stringify({ ...p, overrides: Object.fromEntries(Object.entries(p.overrides).sort(([x], [y]) => x.localeCompare(y))) });
  return sorted(a) === sorted(b);
};

// ─────────────────────────── Small pieces ───────────────────────────

const SOURCE_TEXT: Record<FieldSource, string> = {
  you: "Saved by you",
  orders: "From your orders",
  product: "From product details",
  mdm: "From MDM stock",
  default: "Default, no data yet",
};

function PctInput({ id, value, onChange, disabled }: { id: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <div className="relative">
      <Input id={id} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="num pr-8" />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-subtle">%</span>
    </div>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex items-start gap-2 text-sm text-muted">
      <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[#e1182c]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-3">
      <legend className="mb-1 text-xs font-bold uppercase tracking-[0.08em] text-subtle">{title}</legend>
      {children}
    </fieldset>
  );
}

function Stat({ label, def, children, sub, tone }: { label: string; def?: string; children: React.ReactNode; sub?: React.ReactNode; tone?: "good" | "bad" }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-2xl bg-surface-2 p-3.5">
      <span className="text-xs text-muted">{def ? <Term label={label} definition={def} /> : label}</span>
      <span className={cn("num truncate text-lg font-extrabold leading-tight", tone === "good" && "text-positive", tone === "bad" && "text-negative")}>{children}</span>
      {sub ? <span className="text-[11px] text-subtle">{sub}</span> : null}
    </div>
  );
}

function Hero({ label, def, value, currency, sub }: { label: string; def: string; value: number; currency: string; sub: React.ReactNode }) {
  return (
    <section className="relative flex min-w-0 flex-col gap-4 overflow-hidden rounded-[22px] bg-brand-hero p-5 text-white shine shadow-[0_16px_34px_rgb(204_19_37/0.35),inset_0_1px_0_rgb(255_255_255/0.35)]">
      <span className="pointer-events-none absolute -right-12 -top-16 size-44 rounded-full border-[20px] border-white/10" aria-hidden="true" />
      <span className="relative text-[15px] font-semibold"><Term label={label} definition={def} iconClassName="text-white/70 hover:text-white" /></span>
      <div className="relative min-w-0">
        <FitMoney value={Math.round(value / 10 ** currencyExponent(currency)) * 10 ** currencyExponent(currency)} currency={currency} max={38} signed codeClassName="text-white/85" className="[text-shadow:0_2px_14px_rgb(255_170_178/0.55)]" />
      </div>
      <span className="relative text-xs text-white/85">{sub}</span>
    </section>
  );
}

type Step = { label: string; amount: number; kind: "start" | "cost" | "gain" | "end"; note?: string };

/** Where each bar starts and ends: totals stand on zero, costs and gains hang from the running total. */
function bridgeSpans(steps: Step[]) {
  return steps.reduce<{ run: number; spans: (Step & { a: number; b: number })[] }>(
    (acc, s) => {
      if (s.kind === "start" || s.kind === "end") return { run: s.amount, spans: [...acc.spans, { ...s, a: 0, b: s.amount }] };
      const b = s.kind === "cost" ? acc.run - s.amount : acc.run + s.amount;
      return { run: b, spans: [...acc.spans, { ...s, a: acc.run, b }] };
    },
    { run: 0, spans: [] },
  ).spans;
}

/**
 * A bridge from one total to another: each cost is a bar hanging from the running total, so the
 * bars line up end to end. Every amount is also written out, so the bars are never the only clue.
 */
function Bridge({ steps, currency, label }: { steps: Step[]; currency: string; label: string }) {
  const money = useMoney();
  const spans = bridgeSpans(steps);
  const lo = Math.min(0, ...spans.flatMap((s) => [s.a, s.b]));
  const hi = Math.max(0, ...spans.flatMap((s) => [s.a, s.b]));
  const width = hi - lo || 1;
  const pos = (v: number) => ((v - lo) / width) * 100;
  return (
    <ol aria-label={label} className="flex flex-col gap-2.5">
      {spans.map((s) => {
        const left = pos(Math.min(s.a, s.b));
        const w = Math.max(0.6, pos(Math.max(s.a, s.b)) - left);
        const total = s.kind === "start" || s.kind === "end";
        return (
          <li key={s.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_7.5rem]">
            <span className={cn("min-w-0 text-[13px] leading-snug", total ? "font-bold text-fg" : "text-muted")}>
              {s.label}
              {s.note ? <span className="block text-[11px] text-subtle">{s.note}</span> : null}
            </span>
            <span className={cn("num whitespace-nowrap text-right text-[13px] sm:order-3", total ? "font-extrabold" : "font-semibold", s.kind === "cost" && "text-negative", s.kind === "gain" && "text-positive", total && s.amount < 0 && "text-negative")}>
              {s.kind === "cost" || (total && s.amount < 0) ? "−" : s.kind === "gain" ? "+" : ""}
              {money.fmt(Math.abs(s.amount), currency, { decimals: false })}
            </span>
            <span className="relative col-span-2 h-3.5 sm:order-2 sm:col-span-1" aria-hidden="true">
              {lo < 0 ? <span className="absolute inset-y-[-3px] w-px bg-border-strong" style={{ left: `${pos(0)}%` }} /> : null}
              <span
                className={cn(
                  "animate-grow-x absolute inset-y-0 rounded-full",
                  s.kind === "start" && "bg-[linear-gradient(90deg,#ff4254,#c8102e)]",
                  s.kind === "end" && (s.amount >= 0 ? "bg-positive" : "bg-negative"),
                  s.kind === "cost" && "bg-[#f3a3ac]",
                  s.kind === "gain" && "bg-positive/45",
                )}
                style={{ left: `${left}%`, width: `${w}%` }}
              />
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// ─────────────────────────── One product ───────────────────────────

const TABS = [
  { key: "potential", label: "1 · Before ads", short: "Before ads" },
  { key: "real", label: "2 · With ads, rates and fees", short: "With ads & fees" },
  { key: "actual", label: "3 · Real orders so far", short: "Real orders" },
] as const;
type Tab = (typeof TABS)[number]["key"];

function ProductCalculator({ row, data, canSave, canEdit, onEditDetails }: { row: Row; data: Tracker; canSave: boolean; canEdit: boolean; onEditDetails: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const money = useMoney();
  const cur = data.currency;
  const fmt = (v: number) => money.fmt(v, cur, { decimals: false });
  const [tab, setTab] = React.useState<Tab>("potential");
  const { boxRef, pill } = useSlidingPill<HTMLDivElement>();

  // Values read from the data alone, and with what was saved for the product on top.
  const fromData = React.useMemo(() => seedFor({ ...row, plan: null }, data.defaults), [row, data.defaults]);
  const saved = React.useMemo(() => seedFor(row, data.defaults), [row, data.defaults]);
  const savedForm = React.useMemo(() => toForm(saved, cur), [saved, cur]);
  const dataForm = React.useMemo(() => toForm(fromData, cur), [fromData, cur]);
  // Only what was typed here is kept: every other field follows the data (and the days picked).
  const [edits, setEdits] = React.useState<Partial<Form>>({});
  const form: Form = { ...savedForm, ...edits };
  const set = <K extends keyof Form>(k: K) => (v: Form[K]) => setEdits((e) => ({ ...e, [k]: v }));

  const parsed = parseForm(form, row, cur);
  const base = React.useMemo(() => ({ form: dataForm, parsed: parseForm(dataForm, row, cur) }), [dataForm, row, cur]);
  const plan = planOf(parsed, form, base);
  const changed = !samePlan(plan, row.plan);
  const potential = stockPotential({ units: parsed.units, salePrice: parsed.inputs.salePrice, unitCost: parsed.inputs.unitCost, unitsPerOrder: parsed.inputs.unitsPerOrder, feesPerOrder: feesPerOrder(parsed.inputs), includeFees: parsed.includeFees });
  const projection = stockProjection(parsed.inputs);
  const actual = actualBreakdown(row.actual, parsed.inputs.salePrice > 0 ? parsed.inputs.salePrice : null);

  const save = useMutation(
    trpc.profit.savePlan.mutationOptions({
      onSuccess: async (_r, vars) => {
        await qc.invalidateQueries({ queryKey: trpc.profit.pathKey() });
        setEdits({});
        toast("success", vars.plan ? `Saved for ${row.name}` : `${row.name} follows your data again`);
      },
      onError: (e) => toast("error", errorMessage(e)),
    }),
  );

  /** Under each field: where its value comes from, and the data's value when someone typed another. */
  const hint = (key: keyof ProjectionInput, formKey: keyof Form, show: (v: string) => string) => {
    const differs = form[formKey] !== dataForm[formKey];
    const source = fromData.sources[key] ?? "default";
    if (!differs) return SOURCE_TEXT[source];
    return (
      <>
        {SOURCE_TEXT[source]}: {show(String(dataForm[formKey]))}.{" "}
        <button type="button" className="font-semibold text-brand-strong hover:underline" onClick={() => set(formKey)(dataForm[formKey] as never)}>Use it</button>
      </>
    );
  };
  const moneyHint = (k: MoneyKey) => hint(k, k, (v) => fmt(parseToMinor(v || "0", cur)));
  const rateHint = (k: RateKey) => hint(k, k, (v) => `${v}%`);

  const stockField = (
    <div className="grid grid-cols-[minmax(0,1fr)_7.5rem] gap-2">
      <Field label="Stock to count" htmlFor="stock-src" hint={form.stockSource === "TYPED" ? (row.stock.read ? undefined : "MDM hasn't sent stock for this product yet. Type how many units you have.") : `${count(parsed.units)} units in MDM`}>
        <Select id="stock-src" value={form.stockSource} onChange={(e) => setEdits((x) => ({ ...x, stockSource: e.target.value as StockSource, stockUnits: e.target.value === "TYPED" ? form.stockUnits : String(stockUnitsFor(e.target.value as StockSource, row.stock, null)) }))}>
          {STOCK_SOURCES.map((s) => <option key={s} value={s} disabled={s !== "TYPED" && !row.stock.read}>{STOCK_SOURCE_LABEL[s]}</option>)}
        </Select>
      </Field>
      <Field label="Units" htmlFor="stock-units">
        <Input id="stock-units" inputMode="numeric" className="num" value={form.stockSource === "TYPED" ? form.stockUnits : String(parsed.units)} disabled={form.stockSource !== "TYPED"} onChange={(e) => set("stockUnits")(e.target.value.replace(/[^\d]/g, ""))} />
      </Field>
    </div>
  );
  const priceFields = (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Sale price per unit" htmlFor="pt-price" hint={moneyHint("salePrice")}><MoneyInput id="pt-price" currency={cur} value={form.salePrice} onChange={set("salePrice")} /></Field>
      <Field label="Cost per unit" htmlFor="pt-cost" hint={moneyHint("unitCost")}><MoneyInput id="pt-cost" currency={cur} value={form.unitCost} onChange={set("unitCost")} /></Field>
    </div>
  );
  const unitsPerOrder = (
    <Field label="Units per order" htmlFor="pt-upo" hint={hint("unitsPerOrder", "unitsPerOrder", (v) => v)}>
      <Input id="pt-upo" inputMode="decimal" className="num" value={form.unitsPerOrder} onChange={(e) => set("unitsPerOrder")(e.target.value)} />
    </Field>
  );

  const noCost = !row.cost;
  return (
    <Card role="region" aria-labelledby="pt-name" className="min-w-0 overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
        <div className="min-w-0">
          <h2 id="pt-name" className="text-[20px] font-extrabold tracking-[-0.02em]">{row.name}</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
            {row.fromMdm ? <Badge tone="brand">From MDM</Badge> : null}
            {noCost ? <Badge tone="warning">No price or cost in product details</Badge> : null}
            {row.plan ? <Badge tone="info">Your numbers saved</Badge> : null}
            {row.stockDetail?.at ? <span>MDM stock read {timeAgo(row.stockDetail.at)}</span> : <span>No MDM stock yet</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit ? <Button variant="ghost" className="-ml-3 sm:ml-0" onClick={onEditDetails}><Pencil /> {noCost ? "Add price and costs" : "Edit product details"}</Button> : null}
        </div>
      </div>

      {row.stock.read ? (
        <dl className="mx-5 mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {[
            ["Available", row.stock.available],
            ["On the way", row.stock.incoming],
            ["Received in total", row.stock.received],
            ["In delivery", row.stockDetail?.inDelivery ?? 0],
            ["Coming back", row.stockDetail?.returning ?? 0],
          ].map(([l, v]) => (
            <div key={l} className="rounded-2xl bg-surface-2 px-3 py-2.5">
              <dt className="text-[11px] text-subtle">{l}</dt>
              <dd className="num text-[17px] font-bold">{count(v as number)}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <div ref={boxRef} data-slide="" role="tablist" aria-label="Calculation" className="no-scrollbar relative mx-5 mt-5 flex gap-0.5 overflow-x-auto rounded-[22px] bg-surface-2 p-1 sm:rounded-full">
        {pill}
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`pt-tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls={`pt-panel-${t.key}`}
            data-active={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn("slide-item press min-h-9 flex-1 rounded-full px-2.5 py-1.5 text-[12px] font-semibold leading-tight sm:whitespace-nowrap sm:px-3.5 sm:text-[13px]", tab === t.key ? "bg-brand glow" : "text-muted hover:text-fg")}
          >
            <span className="hidden sm:inline">{t.label}</span>
            <span className="sm:hidden">{t.short}</span>
          </button>
        ))}
      </div>

      <div className="p-5">
        {parsed.problem ? <p className="mb-4 rounded-2xl bg-warning-soft px-4 py-3 text-sm text-warning" role="alert">{parsed.problem}</p> : null}

        {tab === "potential" ? (
          <div role="tabpanel" id="pt-panel-potential" aria-labelledby="pt-tab-potential" className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted">Every unit sells at its price: no ads, no cancelled or returned orders. This is the most the stock can earn.</p>
              {stockField}
              {priceFields}
              <Check checked={form.includeFees} onChange={set("includeFees")}>Also take off each order&apos;s delivery, packaging and call center fees</Check>
              {form.includeFees ? unitsPerOrder : null}
            </div>
            <div className="flex min-w-0 flex-col gap-3">
              <Hero label="Benefit before ads" def="Units × (sale price − cost per unit). What the stock earns if every unit sells at its price, before ads, rates and fees." value={potential.benefit} currency={cur} sub={`${count(potential.units)} units × ${fmt(potential.benefitPerUnit)} each`} />
              <div className="grid grid-cols-2 gap-3 2xl:grid-cols-4">
                <Stat label="Sales" def="Units × sale price.">{fmt(potential.revenue)}</Stat>
                <Stat label="Stock cost" def="Units × cost per unit.">{fmt(potential.purchaseCost)}</Stat>
                <Stat label="Per unit">{fmt(potential.benefitPerUnit)}</Stat>
                <Stat label="Margin" def="(Sale price − cost per unit) ÷ sale price.">{formatPercent(potential.margin)}</Stat>
              </div>
              {form.includeFees ? (
                <div className="grid grid-cols-2 gap-3">
                  <Stat label="Fees" sub={`${count(potential.orders)} orders × ${fmt(feesPerOrder(parsed.inputs))}`}>{fmt(potential.fees)}</Stat>
                  <Stat label="Benefit after fees" tone={potential.benefitAfterFees < 0 ? "bad" : undefined}>{fmt(potential.benefitAfterFees)}</Stat>
                </div>
              ) : null}
              {potential.units > 0 && parsed.inputs.salePrice > 0 ? (
                <p className="text-sm text-muted">
                  If all {count(potential.units)} units sell at {fmt(parsed.inputs.salePrice)}, you collect <b className="text-fg">{fmt(potential.revenue)}</b> for stock that cost <b className="text-fg">{fmt(potential.purchaseCost)}</b>.{" "}
                  <button type="button" className="font-semibold text-brand-strong hover:underline" onClick={() => setTab("real")}>See it with ads and rates</button>
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        {tab === "real" ? (
          <div role="tabpanel" id="pt-panel-real" aria-labelledby="pt-tab-real" className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
            <div className="flex flex-col gap-6">
              <Group title="Stock and price">
                {stockField}
                {priceFields}
                {unitsPerOrder}
              </Group>
              <Group title="Rates">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Confirmed" htmlFor="pt-conf" hint={rateHint("confirmationRate")}><PctInput id="pt-conf" value={form.confirmationRate} onChange={set("confirmationRate")} /></Field>
                  <Field label="Shipped (of confirmed)" htmlFor="pt-ship" hint={rateHint("shippingRate")}><PctInput id="pt-ship" value={form.shippingRate} onChange={set("shippingRate")} /></Field>
                  <Field label="Delivered (of shipped)" htmlFor="pt-del" hint={rateHint("deliveryRate")}><PctInput id="pt-del" value={form.deliveryRate} onChange={set("deliveryRate")} /></Field>
                  <Field label="Lost (of shipped)" htmlFor="pt-lost" hint={rateHint("lostRate")}><PctInput id="pt-lost" value={form.lostRate} onChange={set("lostRate")} /></Field>
                  <Field label="Returned (of shipped)" htmlFor="pt-ret" hint={form.returnAuto ? "The rest of the shipped parcels" : undefined}>
                    <PctInput id="pt-ret" value={form.returnAuto && projection.ok ? pctText(projection.returnRateUsed) : form.returnRate} onChange={set("returnRate")} disabled={form.returnAuto} />
                  </Field>
                </div>
                <Check checked={form.returnAuto} onChange={(v) => setEdits((x) => ({ ...x, returnAuto: v, returnRate: projection.ok ? pctText(projection.returnRateUsed) : form.returnRate }))}>Every parcel not delivered or lost comes back</Check>
                <p className="text-xs text-subtle">
                  {row.sample.finished > 0 ? `Your orders in these days: ${count(row.sample.placed)} placed, ${count(row.sample.finished)} parcels finished.` : "No finished parcels for this product in these days."}
                  {!data.minFinished || row.sample.finished >= data.minFinished ? "" : ` Rates come from your orders after ${data.minFinished} finished parcels.`}
                </p>
              </Group>
              <Group title="Ads and fees">
                <Field label="Ad spend per order placed" htmlFor="pt-cpa" hint={moneyHint("cpa")}><MoneyInput id="pt-cpa" currency={cur} value={form.cpa} onChange={set("cpa")} /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Delivery fee per parcel" htmlFor="pt-s" hint={moneyHint("forwardShippingFee")}><MoneyInput id="pt-s" currency={cur} value={form.forwardShippingFee} onChange={set("forwardShippingFee")} /></Field>
                  <Field label="Return fee per parcel" htmlFor="pt-r" hint={moneyHint("rtoFee")}><MoneyInput id="pt-r" currency={cur} value={form.rtoFee} onChange={set("rtoFee")} /></Field>
                  <Field label="Call center fee" htmlFor="pt-k" hint={moneyHint("callCenterFee")}><MoneyInput id="pt-k" currency={cur} value={form.callCenterFee} onChange={set("callCenterFee")} /></Field>
                  <Field label="Paid for each order" htmlFor="pt-kb">
                    <Select id="pt-kb" value={form.callCenterBasis} onChange={(e) => set("callCenterBasis")(e.target.value as CallCenterBasis)}>
                      <option value="PLACED_LEAD">Placed</option>
                      <option value="CONFIRMED_ORDER">Confirmed</option>
                    </Select>
                  </Field>
                  <Field label="Packaging per parcel" htmlFor="pt-g" hint={moneyHint("packagingFee")}><MoneyInput id="pt-g" currency={cur} value={form.packagingFee} onChange={set("packagingFee")} /></Field>
                  <Field label="Other MDM fees per delivered order" htmlFor="pt-x" hint="COD or fulfilment fee, if MDM charges one"><MoneyInput id="pt-x" currency={cur} value={form.extraFeePerDelivered} onChange={set("extraFeePerDelivered")} /></Field>
                </div>
                <Field label="Other costs for this stock" htmlFor="pt-o" hint="Transport to MDM, a designer, anything paid once"><MoneyInput id="pt-o" currency={cur} value={form.otherCosts} onChange={set("otherCosts")} /></Field>
              </Group>
            </div>

            <div className="flex min-w-0 flex-col gap-4">
              {!projection.ok ? (
                <p className="flex items-start gap-2 rounded-2xl bg-warning-soft px-4 py-3 text-sm text-warning" role="alert"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{projection.reason}</p>
              ) : (
                <>
                  <Hero
                    label="Real benefit"
                    def="What the stock earns once every unit is delivered or lost, after ad spend, cancelled and returned orders, and every fee."
                    value={projection.benefit}
                    currency={cur}
                    sub={`${fmt(projection.benefitPerUnit)} per unit · ${formatPercent(projection.potential > 0 ? projection.benefit / projection.potential : null, 0)} of the benefit before ads`}
                  />
                  <div className="grid grid-cols-2 gap-3 2xl:grid-cols-4">
                    <Stat label="Missing benefit" def="Benefit before ads − real benefit: what ads, rates and fees take." tone="bad">{fmt(projection.missing)}</Stat>
                    <Stat label="Breakeven CPA" def="The most you can pay in ads per order placed before this stock loses money." sub="per order placed">{fmt(projection.breakevenCpa)}</Stat>
                    <Stat label="POAS" def="Real benefit ÷ ad spend.">{projection.poas === null ? "—" : projection.poas.toFixed(2)}</Stat>
                    <Stat label="Return on stock" def="Real benefit ÷ what the stock cost.">{formatPercent(projection.returnOnStock, 0)}</Stat>
                  </div>
                  {projection.benefit < 0 ? (
                    <p className="rounded-2xl border border-negative/30 bg-negative-soft px-4 py-3 text-sm text-negative">
                      This stock loses money at these numbers. Keep ad spend under <b>{fmt(projection.breakevenCpa)}</b> per order placed, or raise the delivery rate.
                    </p>
                  ) : null}
                  <div className="rounded-2xl bg-surface-2 p-4">
                    <h3 className="text-sm font-bold">To sell {count(parsed.units)} units you need about</h3>
                    <ol className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3 xl:grid-cols-6">
                      {[
                        ["Orders placed", projection.flow.leads],
                        ["Confirmed", projection.flow.confirmed],
                        ["Shipped", projection.flow.shipped],
                        ["Delivered", projection.flow.delivered],
                        ["Returned", projection.flow.returned],
                        ["Lost", projection.flow.lost],
                      ].map(([l, v]) => (
                        <li key={l as string} className="flex flex-col rounded-xl bg-surface px-3 py-2">
                          <span className="num text-base font-bold">{count(v as number)}</span>
                          <span className="text-[11px] text-subtle">{l}</span>
                        </li>
                      ))}
                    </ol>
                    <p className="mt-3 text-xs text-subtle">Ad spend for them: {fmt(projection.adSpend)}. Returned parcels come back to stock and are sent again.</p>
                  </div>
                  <div>
                    <h3 className="mb-3 text-sm font-bold">Where the benefit goes</h3>
                    <Bridge
                      label="From the benefit before ads to the real benefit"
                      currency={cur}
                      steps={[
                        { label: "Benefit before ads", amount: projection.potential, kind: "start", note: "Every unit sold at its price" },
                        ...projection.gap.map((g) => ({ label: GAP_LABEL[g.key], amount: g.amount, kind: "cost" as const, note: projection.potential > 0 ? `${formatPercent(g.amount / projection.potential, 0)} of it` : undefined })),
                        { label: "Real benefit", amount: projection.benefit, kind: "end" },
                      ]}
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        ) : null}

        {tab === "actual" ? (
          <div role="tabpanel" id="pt-panel-actual" aria-labelledby="pt-tab-actual" className="flex flex-col gap-4">
            <p className="text-sm text-muted">Your real orders for {row.name} placed in the days picked above: what their delivered units should have made at your sale price, and what each cost took from it.</p>
            {row.actual.deliveredUnits === 0 && row.actual.adSpend === 0 ? (
              <p className="rounded-2xl bg-surface-2 px-4 py-3 text-sm text-muted">No delivered parcels or ad spend for this product in these days.</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                  <Stat label="Units delivered" sub={`${count(row.sample.delivered)} parcels`}>{count(row.actual.deliveredUnits)}</Stat>
                  <Stat label="Collected" def="Cash on delivery of the delivered parcels.">{fmt(row.actual.deliveredRevenue)}</Stat>
                  <Stat label="Real profit" def="Collected − ad spend − cost of the units − delivery and return fees − call center − packaging − this product's expenses." tone={actual.profit < 0 ? "bad" : "good"}>{fmt(actual.profit)}</Stat>
                  <Stat label="Missing benefit" def="What the delivered units should have made at your sale price − real profit.">{fmt(actual.missing)}</Stat>
                </div>
                <Bridge
                  label="From the benefit at your price to the real profit"
                  currency={cur}
                  steps={[
                    { label: "Delivered units at your price", amount: actual.expected, kind: "start", note: `${count(row.actual.deliveredUnits)} × ${fmt(parsed.inputs.salePrice)} − their cost` },
                    ...actual.parts.map((p) => ({
                      label: ACTUAL_LABEL[p.key],
                      amount: Math.abs(p.amount),
                      kind: p.amount < 0 ? ("cost" as const) : ("gain" as const),
                      note: p.key === "priceGap" ? (p.amount > 0 ? "Parcels collected more than the price (delivery paid by customers, upsells)" : "Parcels collected less than the price (discounts)") : undefined,
                    })),
                    { label: "Real profit", amount: actual.profit, kind: "end" },
                  ]}
                />
              </>
            )}
            <ul className="flex flex-col gap-1.5 text-xs text-subtle">
              {row.sample.inTransit > 0 ? <li>• {count(row.sample.inTransit)} parcels are still with the carrier ({fmt(row.actual.cashInTransit)}). They count once delivered or returned.</li> : null}
              {row.actual.missingCostOrders > 0 ? <li className="text-warning">• {count(row.actual.missingCostOrders)} orders have no cost for this product on their date, so their units cost nothing here. Add a cost version that starts earlier.</li> : null}
              {data.unlinkedSpend > 0 ? <li>• {fmt(data.unlinkedSpend)} of ad spend isn&apos;t linked to any product, so it isn&apos;t counted here. Link campaigns in Products.</li> : null}
              {data.unlinkedSpendFor === row.id ? <li>• Ad spend not linked to a product counts for {row.name}, your only product.</li> : null}
            </ul>
          </div>
        ) : null}
      </div>

      {canSave && tab !== "actual" ? (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/70 bg-surface-2/60 px-5 py-3">
          <span className="mr-auto text-xs text-subtle">{changed ? "Not saved yet. Saving keeps these numbers for this product." : row.plan ? "These numbers are saved for this product." : "Using your data. Change any number to try it."}</span>
          {row.plan || changed ? (
            <Button variant="ghost" disabled={save.isPending} onClick={() => (row.plan ? save.mutate({ productId: row.id, plan: null }) : setEdits({}))}><RotateCcw /> Back to my data</Button>
          ) : null}
          <Button variant="primary" disabled={!changed || save.isPending || !!parsed.problem} onClick={() => save.mutate({ productId: row.id, plan })}><Save /> Save for this product</Button>
        </div>
      ) : !canSave && changed && tab !== "actual" ? (
        <div className="flex items-center justify-end gap-2 border-t border-border/70 px-5 py-3">
          <span className="mr-auto text-xs text-subtle">Only for you, not saved.</span>
          <Button variant="ghost" onClick={() => setEdits({})}><RotateCcw /> Back to the saved numbers</Button>
        </div>
      ) : null}
    </Card>
  );
}

// ─────────────────────────── Every product ───────────────────────────

function ProductsOverview({ data, selected, onSelect }: { data: Tracker; selected: string; onSelect: (id: string) => void }) {
  const money = useMoney();
  const cur = data.currency;
  const fmt = (v: number) => money.fmt(v, cur, { decimals: false });
  const rows = data.products.map((p) => ({ p, ...productSummary(p, data.defaults) }));
  const real = (r: (typeof rows)[number]) => (r.projection.ok ? r.projection : null);
  return (
    <Card className="min-w-0">
      <CardHeader title="Your products" description="Each product's stock, what it earns before ads, and what it really earns with your ads, rates and fees. Pick one to change its numbers." />
      <div className="hidden px-2 pb-3 md:block">
        <Table>
          <THead>
            <tr>
              <Th>Product</Th>
              <Th className="text-right">Stock</Th>
              <Th className="text-right"><Term label="Before ads" definition="Units × (sale price − cost per unit)." /></Th>
              <Th className="text-right"><Term label="Real benefit" definition="After ad spend, confirmation, delivery and return rates and every fee." /></Th>
              <Th className="text-right">Missing</Th>
              <Th className="text-right">Per unit</Th>
              <Th className="text-right"><Term label="Breakeven CPA" definition="The most you can pay in ads per order placed." /></Th>
            </tr>
          </THead>
          <tbody>
            {rows.map((r) => {
              const x = real(r);
              return (
                <Tr key={r.p.id} className={cn("cursor-pointer", selected === r.p.id && "bg-brand-soft/60")} onClick={() => onSelect(r.p.id)}>
                  <Td className="whitespace-normal">
                    <button type="button" className="text-left font-semibold hover:text-brand-strong" aria-pressed={selected === r.p.id} onClick={(e) => { e.stopPropagation(); onSelect(r.p.id); }}>{r.p.name}</button>
                    <span className="mt-0.5 flex flex-wrap gap-1">
                      {!r.p.cost ? <Badge tone="warning">Needs price and cost</Badge> : null}
                      {r.p.plan ? <Badge tone="info">Saved numbers</Badge> : null}
                    </span>
                  </Td>
                  <Td className="num text-right">{count(r.seed.units)}<span className="block text-[11px] text-subtle">{r.seed.stockSource === "TYPED" ? (r.p.plan?.stockUnits != null ? "typed" : "example") : "MDM"}</span></Td>
                  <Td className="num text-right font-semibold">{fmt(r.potential.benefit)}</Td>
                  <Td className={cn("num text-right font-bold", x && x.benefit < 0 ? "text-negative" : "text-positive")} title={r.projection.ok ? undefined : r.projection.reason}>{x ? fmt(x.benefit) : "—"}</Td>
                  <Td className="num text-right text-negative">{x ? fmt(x.missing) : "—"}</Td>
                  <Td className="num text-right">{x ? fmt(x.benefitPerUnit) : "—"}</Td>
                  <Td className="num text-right">{x ? fmt(x.breakevenCpa) : "—"}</Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </div>
      <ul className="flex flex-col gap-2 px-4 pb-4 md:hidden">
        {rows.map((r) => {
          const x = real(r);
          return (
            <li key={r.p.id}>
              <button type="button" aria-pressed={selected === r.p.id} onClick={() => onSelect(r.p.id)} className={cn("press flex w-full min-w-0 flex-col gap-2 rounded-2xl p-3 text-left", selected === r.p.id ? "bg-brand-soft ring-1 ring-brand/30" : "bg-surface-2")}>
                <span className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">{r.p.name}{!r.p.cost ? <Badge tone="warning">Needs price and cost</Badge> : null}</span>
                <span className="grid grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,1fr)] gap-2 text-[11px] text-subtle">
                  <span className="min-w-0">Stock<b className="num block truncate text-[13px] text-fg">{count(r.seed.units)}</b></span>
                  <span className="min-w-0">Before ads<b className="num block truncate text-[13px] text-fg">{fmt(r.potential.benefit)}</b></span>
                  <span className="min-w-0">Real benefit<b className={cn("num block truncate text-[13px]", x && x.benefit < 0 ? "text-negative" : "text-positive")}>{x ? fmt(x.benefit) : "—"}</b></span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ─────────────────────────── Page ───────────────────────────

export function ProfitView({ initialProductId }: { initialProductId: string }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const workspace = useQuery(trpc.workspace.getCurrent.queryOptions());
  const canRead = useCan("money.read");
  const canSave = useCan("settings.economics");
  const canEdit = useCan("catalog.write");
  const [range, setRange] = React.useState<RangeKey>("all");
  const [custom, setCustom] = React.useState({ from: "", to: "" });
  const timezone = workspace.data?.timezone ?? "Africa/Algiers";
  const days = rangeDays(range, todayIn(timezone), custom);
  const bad = !!days.from && !!days.to && days.from > days.to;
  const tracker = useQuery({ ...trpc.profit.tracker.queryOptions(days), enabled: canRead && !bad, placeholderData: keepPreviousData });
  const products = useQuery({ ...trpc.products.list.queryOptions(), enabled: canEdit });
  const [picked, setPicked] = React.useState(initialProductId);
  const [editing, setEditing] = React.useState(false);
  const detailRef = React.useRef<HTMLDivElement>(null);

  const data = tracker.data;
  const selected = data?.products.find((p) => p.id === picked) ?? data?.products[0] ?? null;
  const editRow = products.data?.find((p) => p.id === selected?.id) ?? null;

  const select = (id: string) => {
    setPicked(id);
    requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  if (workspace.data && !canRead) {
    return (
      <>
        <PageHeader title="Profit tracker" />
        <Card><EmptyState icon={<Lock className="size-6" />} title="Owners, admins and analysts see this page" description="Ask the owner of this business if you need to see its profit." /></Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Profit tracker"
        description="What each product's stock should earn: first at its price alone, then with your ad spend, rates and every fee, and where the difference goes."
        actions={
          data && data.products.length > 1 ? (
            <Select aria-label="Product" value={selected?.id ?? ""} onChange={(e) => select(e.target.value)} className="w-full sm:w-56">
              {data.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          ) : undefined
        }
      />
      <div className="mb-5 flex flex-col gap-2">
        <span className="text-xs font-semibold text-muted">Rates, ad spend and real orders from</span>
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {RANGES.map((r) => <Chip key={r.key} active={range === r.key} onClick={() => setRange(r.key)} className="shrink-0">{r.label}</Chip>)}
        </div>
        {range === "custom" ? (
          <div className="grid grid-cols-2 gap-2 sm:max-w-sm">
            <Input type="date" aria-label="From" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
            <Input type="date" aria-label="To" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
          </div>
        ) : null}
        {bad ? <p className="text-sm text-negative">The start day must be before the end day.</p> : null}
      </div>

      {tracker.isError ? (
        <ErrorState message={errorMessage(tracker.error)} />
      ) : !data ? (
        <Loading label="Loading your products" />
      ) : data.products.length === 0 ? (
        <Card>
          <EmptyState icon={<PackageOpen className="size-6" />} title="No products yet" description="Products appear here once MDM sends orders, or when you add one." action={<Button asChild variant="primary"><Link href="/products">Open Products</Link></Button>} />
        </Card>
      ) : (
        <div className="flex min-w-0 flex-col gap-[18px]">
          {data.demo ? <div><Badge tone="brand">Demo data</Badge></div> : null}
          {data.products.length > 1 ? <ProductsOverview data={data} selected={selected?.id ?? ""} onSelect={select} /> : null}
          <div ref={detailRef} className="scroll-mt-24">
            {selected ? <ProductCalculator key={selected.id} row={selected} data={data} canSave={canSave} canEdit={canEdit && !!editRow} onEditDetails={() => setEditing(true)} /> : null}
          </div>
        </div>
      )}
      {editing && editRow ? (
        <CostVersionDialog product={editRow} open onOpenChange={setEditing} rates={workspace.data?.exchangeRates ?? {}} onSaved={() => qc.invalidateQueries({ queryKey: trpc.profit.pathKey() })} />
      ) : null}
    </>
  );
}
