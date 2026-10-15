"use client";

import type { inferRouterOutputs } from "@trpc/server";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Lock, PackageOpen, Pencil, RotateCcw, Save } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { AdsFilter, useAdsFilter } from "@/components/app/ads-filter";
import { useMoney } from "@/components/app/currency";
import { MoneyInput, minorToInput } from "@/components/app/money-input";
import { MoreDetails, MoreDetailsButton, useMoreDetails } from "@/components/app/more-details";
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
import { HelpTip, Term } from "@/components/ui/tooltip";
import {
  ACTUAL_LABEL,
  actualBreakdown,
  feesPerOrder,
  GAP_LABEL,
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
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/core";
import { RANGES, rangeDays, todayIn, type RangeKey } from "@/lib/dateRanges";
import { parseToMinor } from "@/lib/money";
import { errorMessage, useTRPC } from "@/lib/trpc/client";
import { offerLabel } from "@/domain/offers";
import { cn, formatPercent } from "@/lib/utils";
import type { AppRouter } from "@/server/trpc/root";
import { CostVersionDialog } from "../products/products-view";
import { OrderProfitView, productLine } from "./order-view";
import { Bridge, Hero, Stat } from "./parts";

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
/** The fields under "Change rates and fees". */
const FOLDED_KEYS = ["confirmationRate", "shippingRate", "deliveryRate", "lostRate", "returnRate", "returnAuto", "cpa", "forwardShippingFee", "rtoFee", "callCenterFee", "callCenterBasis", "packagingFee", "extraFeePerDelivered", "otherCosts"] as const;

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
      problem ??= msg("One of the amounts isn't a number.");
      return 0;
    }
  };
  const p = (s: string) => {
    const v = Number.parseFloat((s || "0").replace(",", "."));
    if (!Number.isFinite(v) || v < 0 || v > 100) {
      problem ??= msg("Rates go from 0 to 100%.");
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
  you: msg("Saved by you"),
  orders: msg("From your orders"),
  product: msg("From product details and your offer"),
  mdm: msg("From MDM stock"),
  default: msg("Default, no data yet"),
};

function PctInput({ id, value, onChange, disabled }: { id: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <div className="relative">
      <Input id={id} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="num pe-8" />
      <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-[11px] text-subtle">%</span>
    </div>
  );
}

function Check({ checked, onChange, children, help }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode; help?: React.ReactNode }) {
  return (
    <label className="flex items-start gap-2 text-sm text-muted">
      <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[#e1182c]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {children}
        {help ? <HelpTip label={typeof children === "string" ? children : undefined} className="ms-1.5 align-middle">{help}</HelpTip> : null}
      </span>
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

// ─────────────────────────── One product ───────────────────────────

const TABS = [
  { key: "potential", label: msg("1 · Before ads"), short: msg("Before ads") },
  { key: "real", label: msg("2 · With ads, rates and fees"), short: msg("With ads & fees") },
  { key: "actual", label: msg("3 · Real orders so far"), short: msg("Real orders") },
] as const;
type Tab = (typeof TABS)[number]["key"];

function ProductCalculator({ row, data, canSave, canEdit, onEditDetails }: { row: Row; data: Tracker; canSave: boolean; canEdit: boolean; onEditDetails: () => void }) {
  const { t, tx, ago } = useT();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const money = useMoney();
  const cur = data.currency;
  const fmt = (v: number) => money.fmt(v, cur, { decimals: false });
  const [tab, setTab] = React.useState<Tab>("potential");
  const { boxRef, pill } = useSlidingPill<HTMLDivElement>();
  // Rates and fees come from the data; a beginner sees them only when asking to change them.
  const [ratesOpen, setRatesOpen] = useMoreDetails("profit-rates");

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
  // The calculation with ads waits for this product's ads: a linked campaign, or an ad spend per order typed here.
  const adsMissing = !row.adsLinked && edits.cpa === undefined && row.plan?.overrides.cpa === undefined;
  const actual = actualBreakdown(row.actual, parsed.inputs.salePrice > 0 ? parsed.inputs.salePrice : null);

  const save = useMutation(
    trpc.profit.savePlan.mutationOptions({
      onSuccess: async (_r, vars) => {
        await qc.invalidateQueries({ queryKey: trpc.profit.pathKey() });
        setEdits({});
        toast("success", vars.plan ? t("Saved for {name}", { name: row.name }) : t("{name} follows your data again", { name: row.name }));
      },
      onError: (e) => toast("error", errorMessage(e)),
    }),
  );

  /** Under each field: where its value comes from, and the data's value when someone typed another. */
  const hint = (key: keyof ProjectionInput, formKey: keyof Form, show: (v: string) => string) => {
    const differs = form[formKey] !== dataForm[formKey];
    const source = fromData.sources[key] ?? "default";
    if (!differs) return t(SOURCE_TEXT[source]);
    return (
      <>
        {t(SOURCE_TEXT[source])}: {show(String(dataForm[formKey]))}.{" "}
        <button type="button" className="font-semibold text-brand-strong hover:underline" onClick={() => set(formKey)(dataForm[formKey] as never)}>{t("Use it")}</button>
      </>
    );
  };
  const moneyHint = (k: MoneyKey) => hint(k, k, (v) => fmt(parseToMinor(v || "0", cur)));
  const rateHint = (k: RateKey) => hint(k, k, (v) => `${v}%`);
  /** How many rates and fees differ from the data, typed here or saved for the product. */
  const ownRates = FOLDED_KEYS.filter((k) => form[k] !== dataForm[k]).length;
  const typeAdSpend = () => {
    setRatesOpen(true);
    requestAnimationFrame(() => document.getElementById("pt-cpa")?.focus());
  };

  const stockField = (
    <div className="grid grid-cols-[minmax(0,1fr)_7.5rem] gap-2">
      <Field label={t("Stock to count")} htmlFor="stock-src" help={t("Which units the calculation counts: what MDM has available, that plus what is on the way, everything MDM received, or a number you type.")} hint={form.stockSource === "TYPED" ? (row.stock.read ? undefined : t("MDM hasn't sent stock for this product yet. Type how many units you have.")) : t("{n} units in MDM", { n: count(parsed.units) })}>
        <Select id="stock-src" value={form.stockSource} onChange={(e) => setEdits((x) => ({ ...x, stockSource: e.target.value as StockSource, stockUnits: e.target.value === "TYPED" ? form.stockUnits : String(stockUnitsFor(e.target.value as StockSource, row.stock, null)) }))}>
          {STOCK_SOURCES.map((s) => <option key={s} value={s} disabled={s !== "TYPED" && !row.stock.read}>{t(STOCK_SOURCE_LABEL[s])}</option>)}
        </Select>
      </Field>
      <Field label={t("Units")} htmlFor="stock-units" help={t("How many units the calculation counts. It follows MDM unless you pick A number I type.")}>
        <Input id="stock-units" inputMode="numeric" className="num" value={form.stockSource === "TYPED" ? form.stockUnits : String(parsed.units)} disabled={form.stockSource !== "TYPED"} onChange={(e) => set("stockUnits")(e.target.value.replace(/[^\d]/g, ""))} />
      </Field>
    </div>
  );
  const priceFields = (
    <div className="grid grid-cols-2 gap-3">
      <Field label={t("Sale price per piece")} htmlFor="pt-price" help={t("What one piece sells for, without delivery. With an offer it is the order price ÷ its pieces: 3800 for 2 pieces gives 1900.")} hint={row.piecesPerOrder > 1 && form.salePrice === dataForm.salePrice ? t("Your offer: the order price ÷ {n} pieces", { n: row.piecesPerOrder }) : moneyHint("salePrice")}><MoneyInput id="pt-price" currency={cur} value={form.salePrice} onChange={set("salePrice")} /></Field>
      <Field label={t("Cost per piece")} htmlFor="pt-cost" help={t("What one piece costs you to buy from your supplier. Example: 800.")} hint={moneyHint("unitCost")}><MoneyInput id="pt-cost" currency={cur} value={form.unitCost} onChange={set("unitCost")} /></Field>
    </div>
  );
  const unitsPerOrder = (
    <Field label={t("Pieces per order")} htmlFor="pt-upo" help={t("How many pieces one order sends. Fees are paid per parcel, so more pieces per order means fewer parcels and fewer fees.")} hint={hint("unitsPerOrder", "unitsPerOrder", (v) => v)}>
      <Input id="pt-upo" inputMode="decimal" className="num" value={form.unitsPerOrder} onChange={(e) => set("unitsPerOrder")(e.target.value)} />
    </Field>
  );

  const noCost = !row.cost;
  return (
    <Card role="region" aria-labelledby="pt-name" className="min-w-0 overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
        <div className="min-w-0">
          <h2 id="pt-name" className="text-[20px] font-extrabold tracking-[-0.02em]">{t("Stock of {name}", { name: row.name })}</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
            {row.fromMdm ? <Badge tone="brand">{t("From MDM")}</Badge> : null}
            {noCost ? <Badge tone="warning">{t("No price or cost in product details")}</Badge> : null}
            {row.plan ? <Badge tone="info">{t("Your numbers saved")}</Badge> : null}
            {row.stockDetail?.at ? <span>{t("MDM stock read {ago}", { ago: ago(row.stockDetail.at) })}</span> : <span>{t("No MDM stock yet")}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit ? <Button variant="ghost" className="-ms-3 sm:ms-0" onClick={onEditDetails}><Pencil /> {noCost ? t("Add price and costs") : t("Edit product details")}</Button> : null}
        </div>
      </div>

      {row.stock.read ? (
        <dl className="mx-5 mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {([
            [t("Available"), row.stock.available, t("Units in MDM's warehouse, ready to be sent.")],
            [t("On the way"), row.stock.incoming, t("Units on their way to MDM's warehouse that it hasn't received yet.")],
            [t("Received in total"), row.stock.received, t("Every unit of this product MDM has received so far, sold or not.")],
            [t("In delivery"), row.stockDetail?.inDelivery ?? 0, t("Units in parcels that are with the carrier right now.")],
            [t("Coming back"), row.stockDetail?.returning ?? 0, t("Units in returned parcels on their way back to MDM's warehouse.")],
          ] as const).map(([l, v, def]) => (
            <div key={l} className="rounded-2xl bg-surface-2 px-3 py-2.5">
              <dt className="text-[11px] text-subtle"><Term label={l} definition={def} /></dt>
              <dd className="num text-[17px] font-bold">{count(v as number)}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <div ref={boxRef} data-slide="" role="tablist" aria-label={t("Calculation")} className="no-scrollbar relative mx-5 mt-5 flex gap-0.5 overflow-x-auto rounded-[22px] bg-surface-2 p-1 sm:rounded-full">
        {pill}
        {TABS.map((tb) => (
          <button
            key={tb.key}
            type="button"
            role="tab"
            id={`pt-tab-${tb.key}`}
            aria-selected={tab === tb.key}
            aria-controls={`pt-panel-${tb.key}`}
            data-active={tab === tb.key}
            onClick={() => setTab(tb.key)}
            className={cn("slide-item press min-h-9 flex-1 rounded-full px-2.5 py-1.5 text-[12px] font-semibold leading-tight sm:whitespace-nowrap sm:px-3.5 sm:text-[13px]", tab === tb.key ? "bg-brand glow" : "text-muted hover:text-fg")}
          >
            <span className="hidden sm:inline">{t(tb.label)}</span>
            <span className="sm:hidden">{t(tb.short)}</span>
          </button>
        ))}
      </div>

      <div className="p-5">
        {parsed.problem ? <p className="mb-4 rounded-2xl bg-warning-soft px-4 py-3 text-sm text-warning" role="alert">{t(parsed.problem)}</p> : null}

        {tab === "potential" ? (
          <div role="tabpanel" id="pt-panel-potential" aria-labelledby="pt-tab-potential" className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted">{t("Every unit sells at its price: no ads, no cancelled or returned orders. This is the most the stock can earn.")}</p>
              {stockField}
              {priceFields}
              <Check checked={form.includeFees} onChange={set("includeFees")} help={t("Counted as if every order were delivered at the first try: no ads, no cancelled or returned orders. Orders = units ÷ pieces per order.")}>{t("Also take off each order's delivery, packaging and call center fees")}</Check>
              {form.includeFees ? unitsPerOrder : null}
            </div>
            <div className="flex min-w-0 flex-col gap-3">
              <Hero label={t("Benefit before ads")} def={t("Units × (sale price − cost per unit). What the stock earns if every unit sells at its price, before ads, rates and fees.")} value={potential.benefit} currency={cur} sub={t("{n} units × {amount} each", { n: count(potential.units), amount: fmt(potential.benefitPerUnit) })} />
              <div className="grid grid-cols-2 gap-3 2xl:grid-cols-4">
                <Stat label={t("Sales")} def={t("Units × sale price.")}>{fmt(potential.revenue)}</Stat>
                <Stat label={t("Stock cost")} def={t("Units × cost per unit.")}>{fmt(potential.purchaseCost)}</Stat>
                <Stat label={t("Per unit")} def={t("Worked out as: sale price per piece − cost per piece. What each unit earns before ads and fees.")}>{fmt(potential.benefitPerUnit)}</Stat>
                <Stat label={t("Margin")} def={t("(Sale price − cost per unit) ÷ sale price.")}>{formatPercent(potential.margin)}</Stat>
              </div>
              {form.includeFees ? (
                <div className="grid grid-cols-2 gap-3">
                  <Stat label={t("Fees")} def={t("Delivery, packaging, call center and other MDM fees of every order, as if each were delivered at the first try. Worked out as: orders × fees per order.")} sub={t("{n} orders × {amount}", { n: count(potential.orders), amount: fmt(feesPerOrder(parsed.inputs)) })}>{fmt(potential.fees)}</Stat>
                  <Stat label={t("Benefit after fees")} def={t("Worked out as: benefit before ads − fees. Still without ads, cancelled or returned orders.")} tone={potential.benefitAfterFees < 0 ? "bad" : undefined}>{fmt(potential.benefitAfterFees)}</Stat>
                </div>
              ) : null}
              {potential.units > 0 && parsed.inputs.salePrice > 0 ? (
                <p className="text-sm text-muted">
                  {tx("If all {n} units sell at {price}, you collect {revenue} for stock that cost {cost}.", { n: count(potential.units), price: fmt(parsed.inputs.salePrice), revenue: <b className="num text-fg">{fmt(potential.revenue)}</b>, cost: <b className="num text-fg">{fmt(potential.purchaseCost)}</b> })}{" "}
                  <button type="button" className="font-semibold text-brand-strong hover:underline" onClick={() => setTab("real")}>{t("See it with ads and rates")}</button>
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        {tab === "real" ? (
          <div role="tabpanel" id="pt-panel-real" aria-labelledby="pt-tab-real" className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
            <div className="flex flex-col gap-6">
              <Group title={t("Stock and price")}>
                {stockField}
                {priceFields}
                {unitsPerOrder}
              </Group>
              <div className="flex flex-col items-start gap-1.5">
                <MoreDetailsButton open={ratesOpen} onToggle={setRatesOpen} labels={[t("Change rates and fees"), t("Hide rates and fees")]} controls="pt-rates" />
                {!ratesOpen ? (
                  <p className="text-xs text-subtle">
                    {adsMissing ? t("Rates come from your orders, fees from the product details.") : t("Rates come from your orders, fees from the product details and ad spend from the campaigns linked to it.")}
                    {ownRates ? ` ${ownRates === 1 ? t("1 of them is your own number.") : t("{n} of them are your own numbers.", { n: ownRates })}` : ""}
                  </p>
                ) : null}
              </div>
              {ratesOpen ? (
                <div id="pt-rates" className="flex flex-col gap-6">
                  <Group title={t("Rates")}>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label={t("Confirmed")} htmlFor="pt-conf" help={t("The % of orders placed that the call center confirms. Your orders give it as confirmed ÷ placed.")} hint={rateHint("confirmationRate")}><PctInput id="pt-conf" value={form.confirmationRate} onChange={set("confirmationRate")} /></Field>
                      <Field label={t("Shipped (of confirmed)")} htmlFor="pt-ship" help={t("The % of confirmed orders that are really sent; the others are cancelled after the call. Your orders give it as shipped ÷ confirmed.")} hint={rateHint("shippingRate")}><PctInput id="pt-ship" value={form.shippingRate} onChange={set("shippingRate")} /></Field>
                      <Field label={t("Delivered (of shipped)")} htmlFor="pt-del" help={t("The % of shipped parcels the customer receives and pays for. Your orders give it as delivered ÷ finished parcels, so parcels still on the road don't count.")} hint={rateHint("deliveryRate")}><PctInput id="pt-del" value={form.deliveryRate} onChange={set("deliveryRate")} /></Field>
                      <Field label={t("Lost (of shipped)")} htmlFor="pt-lost" help={t("The % of shipped parcels that never arrive and never come back: their goods and delivery fee are lost. Your orders give it as lost ÷ finished parcels.")} hint={rateHint("lostRate")}><PctInput id="pt-lost" value={form.lostRate} onChange={set("lostRate")} /></Field>
                      <Field label={t("Returned (of shipped)")} htmlFor="pt-ret" help={t("The % of shipped parcels that come back. Each one pays its delivery and return fees, then goes back to stock to be sent again.")} hint={form.returnAuto ? t("The rest of the shipped parcels") : undefined}>
                        <PctInput id="pt-ret" value={form.returnAuto && projection.ok ? pctText(projection.returnRateUsed) : form.returnRate} onChange={set("returnRate")} disabled={form.returnAuto} />
                      </Field>
                    </div>
                    <Check checked={form.returnAuto} help={t("Ticked: returned = 100% − delivered − lost. Untick it to type your own returned %.")} onChange={(v) => setEdits((x) => ({ ...x, returnAuto: v, returnRate: projection.ok ? pctText(projection.returnRateUsed) : form.returnRate }))}>{t("Every parcel not delivered or lost comes back")}</Check>
                    <p className="text-xs text-subtle">
                      {row.sample.finished > 0 ? t("Your orders in these days: {placed} placed, {finished} parcels finished.", { placed: count(row.sample.placed), finished: count(row.sample.finished) }) : t("No finished parcels for this product in these days.")}
                      {!data.minFinished || row.sample.finished >= data.minFinished ? "" : ` ${t("Rates come from your orders after {n} finished parcels.", { n: data.minFinished })}`}
                    </p>
                  </Group>
                  <Group title={t("Ads and fees")}>
                    <Field label={t("Ad spend per order placed")} htmlFor="pt-cpa" help={t("What ads cost for each order placed. Your orders give it as this product's ad spend ÷ its orders placed. Type one if no campaign is linked yet.")} hint={adsMissing ? t("No campaign is linked to this product yet") : moneyHint("cpa")}><MoneyInput id="pt-cpa" currency={cur} value={form.cpa} onChange={set("cpa")} /></Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label={t("Delivery fee per parcel")} htmlFor="pt-s" help={t("What MDM charges you to send one parcel. It is paid on every shipped parcel: delivered, returned or lost.")} hint={moneyHint("forwardShippingFee")}><MoneyInput id="pt-s" currency={cur} value={form.forwardShippingFee} onChange={set("forwardShippingFee")} /></Field>
                      <Field label={t("Return fee per parcel")} htmlFor="pt-r" help={t("What MDM charges when a parcel comes back, on top of its delivery fee.")} hint={moneyHint("rtoFee")}><MoneyInput id="pt-r" currency={cur} value={form.rtoFee} onChange={set("rtoFee")} /></Field>
                      <Field label={t("Call center fee")} htmlFor="pt-k" help={t("What the call center charges for one order. Choose under Paid for each order whether every order placed pays it or only confirmed ones.")} hint={moneyHint("callCenterFee")}><MoneyInput id="pt-k" currency={cur} value={form.callCenterFee} onChange={set("callCenterFee")} /></Field>
                      <Field label={t("Paid for each order")} htmlFor="pt-kb" help={t("Placed: the call center is paid for every order that comes in. Confirmed: only for the orders it confirms. Settings > Economics & currencies sets the starting choice.")}>
                        <Select id="pt-kb" value={form.callCenterBasis} onChange={(e) => set("callCenterBasis")(e.target.value as CallCenterBasis)}>
                          <option value="PLACED_LEAD">{t("Placed")}</option>
                          <option value="CONFIRMED_ORDER">{t("Confirmed")}</option>
                        </Select>
                      </Field>
                      <Field label={t("Packaging per parcel")} htmlFor="pt-g" help={t("Box, bag and label for one parcel. Paid on every shipped parcel, even one that comes back.")} hint={moneyHint("packagingFee")}><MoneyInput id="pt-g" currency={cur} value={form.packagingFee} onChange={set("packagingFee")} /></Field>
                      <Field label={t("Other MDM fees per delivered order")} htmlFor="pt-x" help={t("Taken off each delivered order only. Type 0 if MDM charges nothing more.")} hint={t("COD or fulfilment fee, if MDM charges one")}><MoneyInput id="pt-x" currency={cur} value={form.extraFeePerDelivered} onChange={set("extraFeePerDelivered")} /></Field>
                    </div>
                    <Field label={t("Other costs for this stock")} htmlFor="pt-o" help={t("One fixed amount taken once off the whole stock's benefit, not per order.")} hint={t("Transport to MDM, a designer, anything paid once")}><MoneyInput id="pt-o" currency={cur} value={form.otherCosts} onChange={set("otherCosts")} /></Field>
                  </Group>
                </div>
              ) : null}
            </div>

            <div className="flex min-w-0 flex-col gap-4">
              {adsMissing ? (
                <div className="flex flex-col gap-1.5 rounded-2xl bg-warning-soft px-4 py-3 text-sm" role="note">
                  <p className="flex items-start gap-2 font-semibold text-warning"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{t("No ads are linked to {name} yet", { name: row.name })}</p>
                  <p className="text-muted">
                    {tx("This calculation only counts ads from the campaigns you link to this product. Link them at the top of this page or in {campaigns}, or {type} under Ads and fees.", {
                      campaigns: <Link href="/campaigns" className="font-semibold text-brand-strong hover:underline">{t("Campaigns")}</Link>,
                      type: <button type="button" className="font-semibold text-brand-strong hover:underline" onClick={typeAdSpend}>{t("type an ad spend per order")}</button>,
                    })}
                  </p>
                </div>
              ) : !projection.ok ? (
                <p className="flex items-start gap-2 rounded-2xl bg-warning-soft px-4 py-3 text-sm text-warning" role="alert"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{t(projection.reason)}</p>
              ) : (
                <>
                  <Hero
                    label={t("Real benefit")}
                    def={t("What the stock earns once every unit is delivered or lost, after ad spend, cancelled and returned orders, and every fee.")}
                    value={projection.benefit}
                    currency={cur}
                    sub={t("{amount} per unit · {pct} of the benefit before ads", { amount: fmt(projection.benefitPerUnit), pct: formatPercent(projection.potential > 0 ? projection.benefit / projection.potential : null, 0) })}
                  />
                  <div className="grid grid-cols-2 gap-3 2xl:grid-cols-4">
                    <Stat label={t("Missing benefit")} def={t("Benefit before ads − real benefit: what ads, rates and fees take.")} tone="bad">{fmt(projection.missing)}</Stat>
                    <Stat label={t("Breakeven CPA")} def={t("The most you can pay in ads per order placed before this stock loses money. Worked out as: real benefit before ads ÷ orders placed.")} sub={t("per order placed")}>{fmt(projection.breakevenCpa)}</Stat>
                    <Stat label={t("POAS")} def={t("Real benefit ÷ ad spend.")}>{projection.poas === null ? "—" : projection.poas.toFixed(2)}</Stat>
                    <Stat label={t("Return on stock")} def={t("Real benefit ÷ what the stock cost.")}>{formatPercent(projection.returnOnStock, 0)}</Stat>
                  </div>
                  {projection.benefit < 0 ? (
                    <p className="rounded-2xl border border-negative/30 bg-negative-soft px-4 py-3 text-sm text-negative">
                      {tx("This stock loses money at these numbers. Keep ad spend under {amount} per order placed, or raise the delivery rate.", { amount: <b>{fmt(projection.breakevenCpa)}</b> })}
                    </p>
                  ) : null}
                  <div className="rounded-2xl bg-surface-2 p-4">
                    <h3 className="text-sm font-bold">
                      {t("To sell {n} units you need about", { n: count(parsed.units) })}
                      <HelpTip label={t("To sell {n} units you need about", { n: count(parsed.units) })} className="ms-1.5 align-middle">{t("Worked out backwards: parcels to ship = units ÷ pieces per order ÷ (delivered % + lost %), confirmed = shipped ÷ shipping rate, placed = confirmed ÷ confirmation rate.")}</HelpTip>
                    </h3>
                    <ol className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3 xl:grid-cols-6">
                      {[
                        [t("Orders placed"), projection.flow.leads],
                        [t("Confirmed"), projection.flow.confirmed],
                        [t("Shipped"), projection.flow.shipped],
                        [t("Delivered"), projection.flow.delivered],
                        [t("Returned"), projection.flow.returned],
                        [t("Lost"), projection.flow.lost],
                      ].map(([l, v]) => (
                        <li key={l as string} className="flex flex-col rounded-xl bg-surface px-3 py-2">
                          <span className="num text-base font-bold">{count(v as number)}</span>
                          <span className="text-[11px] text-subtle">{l}</span>
                        </li>
                      ))}
                    </ol>
                    <p className="mt-3 text-xs text-subtle">{t("Ad spend for them: {amount}. Returned parcels come back to stock and are sent again.", { amount: fmt(projection.adSpend) })}</p>
                  </div>
                  <div>
                    <h3 className="mb-3 text-sm font-bold">
                      {t("Where the benefit goes")}
                      <HelpTip label={t("Where the benefit goes")} className="ms-1.5 align-middle">{t("Each bar is one cost that takes the benefit before ads down to the real benefit, biggest first. Together they make the missing benefit.")}</HelpTip>
                    </h3>
                    <Bridge
                      label={t("From the benefit before ads to the real benefit")}
                      currency={cur}
                      steps={[
                        { label: t("Benefit before ads"), amount: projection.potential, kind: "start", note: t("Every unit sold at its price") },
                        ...projection.gap.map((g) => ({ label: t(GAP_LABEL[g.key]), amount: g.amount, kind: "cost" as const, note: projection.potential > 0 ? t("{pct} of it", { pct: formatPercent(g.amount / projection.potential, 0) }) : undefined })),
                        { label: t("Real benefit"), amount: projection.benefit, kind: "end" },
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
            <p className="text-sm text-muted">{t("Your real orders for {name} placed in the days picked above: what their delivered units should have made at your sale price, and what each cost took from it.", { name: row.name })}</p>
            {row.actual.deliveredUnits === 0 && row.actual.adSpend === 0 ? (
              <p className="rounded-2xl bg-surface-2 px-4 py-3 text-sm text-muted">{t("No delivered parcels or ad spend for this product in these days.")}</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                  <Stat label={t("Units delivered")} def={t("Pieces in the delivered parcels of the orders placed in these days, free pieces of your offer included.")} sub={t("{n} parcels", { n: count(row.sample.delivered) })}>{count(row.actual.deliveredUnits)}</Stat>
                  <Stat label={t("Collected")} def={t("Cash on delivery of the delivered parcels.")}>{fmt(row.actual.deliveredRevenue)}</Stat>
                  <Stat label={t("Real profit")} def={t("Collected − ad spend − cost of the units − delivery and return fees − call center − packaging − this product's expenses.")} tone={actual.profit < 0 ? "bad" : "good"}>{fmt(actual.profit)}</Stat>
                  <Stat label={t("Missing benefit")} def={t("What the delivered units should have made at your sale price − real profit.")}>{fmt(actual.missing)}</Stat>
                </div>
                <Bridge
                  label={t("From the benefit at your price to the real profit")}
                  currency={cur}
                  steps={[
                    { label: t("Delivered units at your price"), amount: actual.expected, kind: "start", note: t("{n} × {price} − their cost", { n: count(row.actual.deliveredUnits), price: fmt(parsed.inputs.salePrice) }) },
                    ...actual.parts.map((p) => ({
                      label: t(ACTUAL_LABEL[p.key]),
                      amount: Math.abs(p.amount),
                      kind: p.amount < 0 ? ("cost" as const) : ("gain" as const),
                      note: p.key === "priceGap" ? (p.amount > 0 ? t("Parcels collected more than the price (delivery paid by customers, upsells)") : t("Parcels collected less than the price (discounts)")) : undefined,
                    })),
                    { label: t("Real profit"), amount: actual.profit, kind: "end" },
                  ]}
                />
              </>
            )}
            <ul className="flex flex-col gap-1.5 text-xs text-subtle">
              {row.sample.inTransit > 0 ? <li>• {t("{n} parcels are still with the carrier ({amount}). They count once delivered or returned.", { n: count(row.sample.inTransit), amount: fmt(row.actual.cashInTransit) })}</li> : null}
              {row.actual.missingCostOrders > 0 ? <li className="text-warning">• {t("{n} orders have no cost for this product on their date, so their units cost nothing here. Add a cost version that starts earlier.", { n: count(row.actual.missingCostOrders) })}</li> : null}
              {data.unlinked.total > 0 ? <li>• {t("{amount} of ad spend isn't linked to any product, so it isn't counted here. Link its campaigns at the top of this page.", { amount: fmt(data.unlinked.total) })}</li> : null}
            </ul>
          </div>
        ) : null}
      </div>

      {canSave && tab !== "actual" ? (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/70 bg-surface-2/60 px-5 py-3">
          <span className="me-auto text-xs text-subtle">{changed ? t("Not saved yet. Saving keeps these numbers for this product.") : row.plan ? t("These numbers are saved for this product.") : t("Using your data. Change any number to try it.")}</span>
          {row.plan || changed ? (
            <Button variant="ghost" disabled={save.isPending} onClick={() => (row.plan ? save.mutate({ productId: row.id, plan: null }) : setEdits({}))}><RotateCcw /> {t("Back to my data")}</Button>
          ) : null}
          <Button variant="primary" disabled={!changed || save.isPending || !!parsed.problem} onClick={() => save.mutate({ productId: row.id, plan })}><Save /> {t("Save for this product")}</Button>
        </div>
      ) : !canSave && changed && tab !== "actual" ? (
        <div className="flex items-center justify-end gap-2 border-t border-border/70 px-5 py-3">
          <span className="me-auto text-xs text-subtle">{t("Only for you, not saved.")}</span>
          <Button variant="ghost" onClick={() => setEdits({})}><RotateCcw /> {t("Back to the saved numbers")}</Button>
        </div>
      ) : null}
    </Card>
  );
}

// ─────────────────────────── Every product ───────────────────────────

function ProductsOverview({ data, selected, onSelect }: { data: Tracker; selected: string; onSelect: (id: string) => void }) {
  const { t } = useT();
  const money = useMoney();
  const cur = data.currency;
  const fmt = (v: number) => money.fmt(v, cur, { decimals: false });
  const rows = data.products.map((p) => ({ p, ...productLine(p, data) }));
  return (
    <Card className="min-w-0">
      <CardHeader title={t("Your products")} help={t("One row per product, with the same numbers as its own page below. Tap a product to see how each one is worked out.")} description={t("What a delivered order of each product really earns, with its ads, and its real profit in these days. Pick one to see how.")} />
      <div className="hidden px-2 pb-3 md:block">
        <Table>
          <THead>
            <tr>
              <Th>{t("Product")}</Th>
              <Th>{t("Offer")}</Th>
              <Th className="text-end"><Term label={t("Per delivered order")} definition={t("What one delivered order really leaves you: its price − the product, delivery, calls, the ads it took and its share of returned and lost parcels. Before your expenses.")} /></Th>
              <Th className="text-end"><Term label={t("Ads per delivered order")} definition={t("What the ads cost for each order that is delivered. Worked out as: ad spend per order placed ÷ confirmation rate ÷ shipping rate ÷ delivery rate.")} /></Th>
              <Th className="text-end"><Term label={t("Real profit")} definition={t("The orders placed in the days picked: what their delivered parcels collected, minus ad spend, the product, every fee and this product's expenses. Parcels still on the road count once they finish.")} /></Th>
            </tr>
          </THead>
          <tbody>
            {rows.map(({ p, input, result: r }) => (
              <Tr key={p.id} className={cn("cursor-pointer", selected === p.id && "bg-brand-soft/60")} onClick={() => onSelect(p.id)}>
                <Td className="whitespace-normal">
                  <button type="button" className="text-start font-semibold hover:text-brand-strong" aria-pressed={selected === p.id} onClick={(e) => { e.stopPropagation(); onSelect(p.id); }}>{p.name}</button>
                  <span className="mt-0.5 flex flex-wrap gap-1">
                    {!p.cost ? <Badge tone="warning">{t("Needs price and cost")}</Badge> : null}
                    {!p.adsLinked ? <Badge tone="warning">{t("No ads linked")}</Badge> : null}
                  </span>
                </Td>
                <Td className="text-[13px] text-muted">{offerLabel(input.pieces, t)}</Td>
                <Td className={cn("num text-end font-bold", r.ok && r.profit < 0 ? "text-negative" : "text-positive")} title={r.ok ? undefined : t(r.reason)}>{r.ok ? fmt(r.profit) : "—"}</Td>
                <Td className="num text-end">{r.ok && r.adCostPerDelivered !== null ? fmt(r.adCostPerDelivered) : <span className="text-xs font-semibold text-subtle">{p.adsLinked ? "—" : t("Link ads")}</span>}</Td>
                <Td className={cn("num text-end font-semibold", p.actual.trueNetProfit < 0 && "text-negative")}>{fmt(p.actual.trueNetProfit)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </div>
      <ul className="flex flex-col gap-2 px-4 pb-4 md:hidden">
        {rows.map(({ p, result: r }) => (
          <li key={p.id}>
            <button type="button" aria-pressed={selected === p.id} onClick={() => onSelect(p.id)} className={cn("press flex w-full min-w-0 flex-col gap-2 rounded-2xl p-3 text-start", selected === p.id ? "bg-brand-soft ring-1 ring-brand/30" : "bg-surface-2")}>
              <span className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">{p.name}{!p.cost ? <Badge tone="warning">{t("Needs price and cost")}</Badge> : null}{!p.adsLinked ? <Badge tone="warning">{t("No ads linked")}</Badge> : null}</span>
              <span className="grid grid-cols-2 gap-2 text-[11px] text-subtle">
                <span className="min-w-0">{t("Per delivered order")}<b className={cn("num block truncate text-[13px]", r.ok && r.profit < 0 ? "text-negative" : "text-positive")}>{r.ok ? fmt(r.profit) : "—"}</b></span>
                <span className="min-w-0">{t("Real profit")}<b className={cn("num block truncate text-[13px] text-fg", p.actual.trueNetProfit < 0 && "text-negative")}>{fmt(p.actual.trueNetProfit)}</b></span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * Ad spend counts for a product only through a campaign (or ad account) someone linked to it.
 * What nobody linked is listed here with a product picker per campaign, so it can be linked at once.
 */
function UnlinkedAds({ data, canLink }: { data: Tracker; canLink: boolean }) {
  const { t, tx } = useT();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const money = useMoney();
  const fmt = (v: number) => money.fmt(v, data.currency, { decimals: false });
  const [all, setAll] = React.useState(false);
  const link = useMutation(
    trpc.campaigns.setProduct.mutationOptions({
      onSuccess: async (_r, vars) => {
        await Promise.all([qc.invalidateQueries({ queryKey: trpc.profit.pathKey() }), qc.invalidateQueries({ queryKey: trpc.campaigns.pathKey() })]);
        const product = data.products.find((p) => p.id === vars.productId);
        toast("success", product ? t("Its ad spend now counts for {name}", { name: product.name }) : t("Campaign unlinked"));
      },
      onError: (e) => toast("error", errorMessage(e)),
    }),
  );
  const { total, campaigns, other } = data.unlinked;
  if (total <= 0) return null;
  const campaignsLink = <Link href="/campaigns" className="font-semibold text-brand-strong hover:underline">{t("Campaigns")}</Link>;
  const shown = all ? campaigns : campaigns.slice(0, 5);
  return (
    <Card className="min-w-0 border border-warning/30">
      <CardHeader
        title={<span className="inline-flex items-center gap-2"><AlertTriangle className="size-4 text-warning" aria-hidden="true" />{t("Ads not linked to a product")}</span>}
        help={t("Ad spend counts for a product only through a campaign or ad account linked to it. This lists the spend linked to none, so you can link it.")}
        description={
          campaigns.length
            ? t("{amount} of ad spend counts for no product, so no product's profit includes it. Your business's total profit still does. Pick the product each campaign sells.", { amount: fmt(total) })
            : t("{amount} of ad spend counts for no product, so no product's profit includes it. Your business's total profit still does.", { amount: fmt(total) })
        }
      />
      <ul className="flex flex-col gap-2 px-4 pb-4">
        {shown.map((c) => (
          <li key={c.id} className="flex flex-col gap-2 rounded-2xl bg-surface-2 p-3 sm:flex-row sm:items-center">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{c.name}</span>
              <span className="num text-xs text-muted">{t("{amount} spent", { amount: fmt(c.spend) })}</span>
            </span>
            {canLink ? (
              <Select aria-label={t("Product for {name}", { name: c.name })} value="" disabled={link.isPending} onChange={(e) => e.target.value && link.mutate({ id: c.id, productId: e.target.value })} className="h-9 w-full text-sm sm:w-56">
                <option value="">{t("Link to a product…")}</option>
                {data.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            ) : null}
          </li>
        ))}
        {campaigns.length > 5 ? (
          <li><Button size="sm" variant="ghost" onClick={() => setAll((v) => !v)}>{all ? t("Show fewer") : t("Show all {n} campaigns", { n: campaigns.length })}</Button></li>
        ) : null}
        {other > 0 ? (
          <li className="text-xs text-subtle">
            {campaigns.length
              ? t("{amount} more comes from ads with no known campaign, such as imported rows without a campaign ID, so it can't be linked here.", { amount: fmt(other) })
              : t("{amount} comes from ads with no known campaign, such as imported rows without a campaign ID, so it can't be linked here.", { amount: fmt(other) })}
          </li>
        ) : null}
        <li className="text-xs text-subtle">
          {canLink
            ? tx("You can also link a whole ad account, or several campaigns at once, in {campaigns}.", { campaigns: campaignsLink })
            : tx("The owner or an admin can link them in {campaigns}.", { campaigns: campaignsLink })}
        </li>
      </ul>
    </Card>
  );
}

// ─────────────────────────── Page ───────────────────────────

export function ProfitView({ initialProductId }: { initialProductId: string }) {
  const { t } = useT();
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
  const ads = useAdsFilter().filter;
  const tracker = useQuery({ ...trpc.profit.tracker.queryOptions({ ...days, ads }), enabled: canRead && !bad, placeholderData: keepPreviousData });
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
        <PageHeader title={t("Profit tracker")} />
        <Card><EmptyState icon={<Lock className="size-6" />} title={t("Owners, admins and analysts see this page")} description={t("Ask the owner of this business if you need to see its profit.")} /></Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t("Profit tracker")}
        description={t("What one delivered order really leaves you once the product, delivery, ads and returns are paid, and your real profit by day.")}
        actions={
          data && data.products.length > 1 ? (
            <Select aria-label={t("Product")} value={selected?.id ?? ""} onChange={(e) => select(e.target.value)} className="w-full sm:w-56">
              {data.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          ) : undefined
        }
      />
      <div className="mb-5 flex flex-col gap-2">
        <span className="text-xs font-semibold text-muted"><Term label={t("Rates, ad spend and real orders from")} definition={t("Only orders placed in these days, and the ad spend of these days, count for the rates, ads per order and real profit. Stock and product details stay the same.")} /></span>
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {RANGES.map((r) => <Chip key={r.key} active={range === r.key} onClick={() => setRange(r.key)} className="shrink-0">{t(r.label)}</Chip>)}
        </div>
        {range === "custom" ? (
          <div className="grid grid-cols-2 gap-2 sm:max-w-sm">
            <Input type="date" aria-label={t("From")} value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
            <Input type="date" aria-label={t("To")} value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
          </div>
        ) : null}
        {bad ? <p className="text-sm text-negative">{t("The start day must be before the end day.")}</p> : null}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
          <AdsFilter />
          {ads ? <span className="text-xs text-muted">{t("Only the orders and ad spend of these ads count. Stock and product details stay the same.")}</span> : null}
        </div>
      </div>

      {tracker.isError ? (
        <ErrorState message={errorMessage(tracker.error)} />
      ) : !data ? (
        <Loading label={t("Loading your products")} />
      ) : data.products.length === 0 ? (
        <Card>
          <EmptyState icon={<PackageOpen className="size-6" />} title={t("No products yet")} description={t("Products appear here once MDM sends orders, or when you add one.")} action={<Button asChild variant="primary"><Link href="/products">{t("Open Products")}</Link></Button>} />
        </Card>
      ) : (
        <div className="flex min-w-0 flex-col gap-[18px]">
          {data.demo ? <div><Badge tone="brand">{t("Demo data")}</Badge></div> : null}
          <UnlinkedAds data={data} canLink={canEdit} />
          {data.products.length > 1 ? <ProductsOverview data={data} selected={selected?.id ?? ""} onSelect={select} /> : null}
          <div ref={detailRef} className="scroll-mt-24">
            {selected ? <OrderProfitView key={selected.id} row={selected} data={data} canEdit={canEdit && !!editRow} onEditDetails={() => setEditing(true)} days={days} /> : null}
          </div>
          {selected ? (
            <MoreDetails id="profit-stock" hint={t("Your stock: what the units MDM holds can earn, before ads and after them, and your real orders against your price.")}>
              <ProductCalculator key={selected.id} row={selected} data={data} canSave={canSave} canEdit={canEdit && !!editRow} onEditDetails={() => setEditing(true)} />
            </MoreDetails>
          ) : null}
        </div>
      )}
      {editing && editRow ? (
        <CostVersionDialog product={editRow} open onOpenChange={setEditing} rates={workspace.data?.exchangeRates ?? {}} onSaved={() => qc.invalidateQueries({ queryKey: trpc.profit.pathKey() })} />
      ) : null}
    </>
  );
}
