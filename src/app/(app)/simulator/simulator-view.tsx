"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, Save, Trash2 } from "lucide-react";
import * as React from "react";
import { useCurrencyView } from "@/components/app/currency";
import { FitText } from "@/components/app/fit-money";
import { MoneyInput, minorToInput } from "@/components/app/money-input";
import { PageHeader } from "@/components/app/page-header";
import { useCan } from "@/components/app/use-can";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { Term } from "@/components/ui/tooltip";
import { simulate, simulatorInputSchema, type SimulatorInput } from "@/domain/simulator";
import { formatMoney, parseToMinor } from "@/lib/money";
import { errorMessage, useTRPC } from "@/lib/trpc/client";
import { cn, formatDate, formatPercent } from "@/lib/utils";

type Form = {
  model: "DEFAULT" | "DETAILED";
  salePrice: string; sourcingCost: string; outboundShipping: string; rtoFee: string; callCenterCost: string; packagingCost: string;
  deliveryProbability: string; returnIsComplement: boolean; returnProbability: string; lostProbability: string;
  confirmationRate: string; shippingRate: string; callCenterBasis: "PLACED_LEAD" | "CONFIRMED_ORDER";
  targetProfitPerOrder: string; currentCpa: string;
};

const pct = (v: number | null | undefined, fallback: number) => String(Math.round(((v ?? fallback) * 100) * 10) / 10);

function toInput(f: Form, currency: string): SimulatorInput {
  const m = (s: string) => parseToMinor(s || "0", currency);
  const p = (s: string) => Number.parseFloat(s || "0") / 100;
  return {
    currency, model: f.model,
    salePrice: m(f.salePrice), sourcingCost: m(f.sourcingCost), outboundShipping: m(f.outboundShipping), rtoFee: m(f.rtoFee), callCenterCost: m(f.callCenterCost), packagingCost: m(f.packagingCost),
    deliveryProbability: p(f.deliveryProbability), returnIsComplement: f.returnIsComplement, returnProbability: p(f.returnProbability), lostProbability: p(f.lostProbability),
    confirmationRate: p(f.confirmationRate), shippingRate: p(f.shippingRate), callCenterBasis: f.callCenterBasis,
    targetProfitPerOrder: m(f.targetProfitPerOrder), currentCpa: f.currentCpa ? m(f.currentCpa) : undefined,
  };
}

function fromInput(i: SimulatorInput, currency: string): Form {
  const parsed = simulatorInputSchema.parse(i);
  const mi = (v: number) => minorToInput(v, currency);
  return {
    model: parsed.model, salePrice: mi(parsed.salePrice), sourcingCost: mi(parsed.sourcingCost), outboundShipping: mi(parsed.outboundShipping), rtoFee: mi(parsed.rtoFee),
    callCenterCost: mi(parsed.callCenterCost), packagingCost: mi(parsed.packagingCost), deliveryProbability: pct(parsed.deliveryProbability, 0), returnIsComplement: parsed.returnIsComplement,
    returnProbability: pct(parsed.returnProbability, 0), lostProbability: pct(parsed.lostProbability, 0), confirmationRate: pct(parsed.confirmationRate, 1), shippingRate: pct(parsed.shippingRate, 1),
    callCenterBasis: parsed.callCenterBasis, targetProfitPerOrder: mi(parsed.targetProfitPerOrder), currentCpa: parsed.currentCpa === undefined ? "" : mi(parsed.currentCpa),
  };
}

function PctInput({ id, value, onChange, disabled }: { id: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <div className="relative">
      <Input id={id} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="num pr-8" />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-subtle">%</span>
    </div>
  );
}

/** Diverging cell color: red for loss, neutral near zero, green for profit. Values also printed as text. */
function cellStyle(v: number, scale: number): React.CSSProperties {
  const t = Math.max(-1, Math.min(1, v / (scale || 1)));
  const a = Math.abs(t) * 0.2 + 0.03;
  return { background: t >= 0 ? `rgb(13 122 62 / ${a})` : `rgb(225 24 44 / ${a})` };
}

export function SimulatorView({ initialProductId }: { initialProductId: string }) {
  const { view } = useCurrencyView();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const canSave = useCan("settings.economics");
  const [selectedProductId, setProductId] = React.useState(initialProductId);
  const products = useQuery(trpc.products.list.queryOptions({ includeInactive: false }));
  // Product-level simulation: default to the first active product.
  const productId = selectedProductId || products.data?.[0]?.id || "";
  const observed = useQuery({ ...trpc.simulator.observed.queryOptions({ productId: productId || undefined }), enabled: products.isSuccess });
  const scenarios = useQuery(trpc.simulator.listScenarios.queryOptions({ productId: productId || undefined }));
  const currency = observed.data?.currency ?? "DZD";
  const [form, setForm] = React.useState<Form | null>(null);
  const [name, setName] = React.useState("");

  const observedForm = React.useCallback((): Form | null => {
    const o = observed.data;
    if (!o) return null;
    const product = products.data?.find((p) => p.id === productId);
    const mi = (v: number | null | undefined) => minorToInput(v ?? 0, o.currency);
    const d = o.rates.deliveryRate ?? 0.6;
    return {
      model: "DEFAULT",
      salePrice: mi(o.costs.salePrice ?? product?.currentCost?.salePrice ?? 0), sourcingCost: mi(o.costs.sourcingCost ?? product?.currentCost?.sourcingCost ?? 0),
      outboundShipping: mi(o.costs.outboundShipping), rtoFee: mi(o.costs.rtoFee), callCenterCost: mi(o.costs.callCenterCost), packagingCost: mi(o.costs.packagingCost),
      deliveryProbability: pct(d, 0.6), returnIsComplement: true, returnProbability: pct(o.rates.returnRate, 1 - d), lostProbability: pct(o.rates.lostRate, 0),
      confirmationRate: pct(o.rates.confirmationRate, 0.75), shippingRate: pct(o.rates.shippingRate, 0.95), callCenterBasis: o.callCenterBasis === "PLACED_LEAD" ? "PLACED_LEAD" : "CONFIRMED_ORDER",
      targetProfitPerOrder: "0", currentCpa: o.currentCpa.confirmed === null ? "" : mi(o.currentCpa.confirmed),
    };
  }, [observed.data, products.data, productId]);

  const f = form ?? observedForm();
  const set = <K extends keyof Form>(k: K) => (v: Form[K]) => f && setForm({ ...f, [k]: v });

  let result: ReturnType<typeof simulate> | null = null;
  let error: string | null = null;
  if (f) {
    try {
      result = simulate(toInput(f, currency));
    } catch (e) {
      error = e instanceof Error && "issues" in e ? (e as { issues: { message: string }[] }).issues[0]?.message ?? "Invalid inputs" : e instanceof Error ? e.message : "Invalid inputs";
    }
  }

  const save = useMutation(
    trpc.simulator.saveScenario.mutationOptions({
      onSuccess: () => { qc.invalidateQueries({ queryKey: trpc.simulator.listScenarios.queryKey() }); setName(""); toast("success", "Scenario saved"); },
      onError: (e) => toast("error", errorMessage(e)),
    }),
  );
  const del = useMutation(trpc.simulator.deleteScenario.mutationOptions({ onSuccess: () => qc.invalidateQueries({ queryKey: trpc.simulator.listScenarios.queryKey() }), onError: (e) => toast("error", errorMessage(e)) }));

  const o = observed.data;
  const fmt = (v: number) => formatMoney(v, currency);
  const unit = result?.unit === "placed lead" ? "per placed lead" : "per order";

  return (
    <>
      <PageHeader
        title="Breakeven CPA simulator"
        description="How much can you pay per order and still make delivered profit? Observed values come from your stored data; everything you change here is a scenario."
        actions={
          <>
            <Select aria-label="Product" value={productId} onChange={(e) => { setProductId(e.target.value); setForm(null); }} className="w-52">
              {products.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <Button variant="ghost" onClick={() => setForm(null)}><RotateCcw /> Reset to observed</Button>
          </>
        }
      />
      {!f ? <Skeleton className="h-96" /> : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[26rem_minmax(0,1fr)]">
          <Card>
            <CardHeader title="Formula inputs" description={view === currency ? `Currency: ${currency}` : `Currency: ${currency}. The simulator always works in ${currency}, the currency your amounts are kept in.`} actions={
              <Select aria-label="Model" value={f.model} onChange={(e) => set("model")(e.target.value as Form["model"])} className="w-36">
                <option value="DEFAULT">Default model</option><option value="DETAILED">Detailed model</option>
              </Select>
            } />
            <CardBody className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Sale price P" htmlFor="P"><MoneyInput id="P" currency={currency} value={f.salePrice} onChange={set("salePrice")} /></Field>
                <Field label="Sourcing cost C" htmlFor="C"><MoneyInput id="C" currency={currency} value={f.sourcingCost} onChange={set("sourcingCost")} /></Field>
                <Field label="Outbound shipping S" htmlFor="S"><MoneyInput id="S" currency={currency} value={f.outboundShipping} onChange={set("outboundShipping")} /></Field>
                <Field label="RTO fee R" htmlFor="R"><MoneyInput id="R" currency={currency} value={f.rtoFee} onChange={set("rtoFee")} /></Field>
                <Field label="Call-center cost K" htmlFor="K"><MoneyInput id="K" currency={currency} value={f.callCenterCost} onChange={set("callCenterCost")} /></Field>
                {f.model === "DETAILED" ? <Field label="Packaging G" htmlFor="G"><MoneyInput id="G" currency={currency} value={f.packagingCost} onChange={set("packagingCost")} /></Field> : null}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Delivery probability D" htmlFor="D" hint={`Observed: ${formatPercent(o?.rates.deliveryRate)}`}><PctInput id="D" value={f.deliveryProbability} onChange={set("deliveryProbability")} /></Field>
                <Field label="Return probability Q" htmlFor="Q" hint={`Observed: ${formatPercent(o?.rates.returnRate)}`}><PctInput id="Q" value={f.returnIsComplement ? String(Math.round((result?.returnProbabilityUsed ?? 0) * 1000) / 10) : f.returnProbability} onChange={set("returnProbability")} disabled={f.returnIsComplement} /></Field>
              </div>
              <label className="flex items-start gap-2 text-sm text-muted">
                <input type="checkbox" className="mt-0.5 size-4 accent-[#e1182c]" checked={f.returnIsComplement} onChange={(e) => set("returnIsComplement")(e.target.checked)} />
                <span>Assume Q = 1 − D{f.model === "DETAILED" ? " − L" : ""} <span className="text-subtle">(every shipped parcel that is not delivered{f.model === "DETAILED" ? " or lost" : ""} comes back)</span></span>
              </label>
              {f.model === "DETAILED" ? (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Lost probability L" htmlFor="L" hint={`Observed: ${formatPercent(o?.rates.lostRate)}`}><PctInput id="L" value={f.lostProbability} onChange={set("lostProbability")} /></Field>
                  <Field label="Confirmation rate" htmlFor="cr" hint={`Observed: ${formatPercent(o?.rates.confirmationRate)}`}><PctInput id="cr" value={f.confirmationRate} onChange={set("confirmationRate")} /></Field>
                  <Field label="Shipping rate" htmlFor="sr" hint={`Observed: ${formatPercent(o?.rates.shippingRate)}`}><PctInput id="sr" value={f.shippingRate} onChange={set("shippingRate")} /></Field>
                  <Field label="Call-center basis" htmlFor="ccb">
                    <Select id="ccb" value={f.callCenterBasis} onChange={(e) => set("callCenterBasis")(e.target.value as Form["callCenterBasis"])}><option value="PLACED_LEAD">Per placed lead</option><option value="CONFIRMED_ORDER">Per confirmed order</option></Select>
                  </Field>
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-3">
                <Field label={`Target profit ${unit}`} htmlFor="tp"><MoneyInput id="tp" currency={currency} value={f.targetProfitPerOrder} onChange={set("targetProfitPerOrder")} /></Field>
                <Field label="Your current CPA" htmlFor="cc" hint={f.model === "DEFAULT" ? `Observed CPCO: ${o?.currentCpa.confirmed === null || !o ? "—" : fmt(o.currentCpa.confirmed)}` : `Observed placed CPA: ${o?.currentCpa.placed === null || !o ? "—" : fmt(o.currentCpa.placed)}`}><MoneyInput id="cc" currency={currency} value={f.currentCpa} onChange={set("currentCpa")} /></Field>
              </div>
              {o ? <p className="text-xs text-subtle">Observed sample: {o.sample.placed} placed · {o.sample.shipped} shipped · {o.sample.delivered} delivered · {o.sample.returned} returned.{o.sample.shipped < 10 ? " Small sample: treat observed rates with caution." : ""}</p> : null}
            </CardBody>
          </Card>

          <div className="flex flex-col gap-6">
            {error ? <Card className="border-negative/40 p-4 text-sm text-negative" role="alert">{error}</Card> : null}
            {result ? (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Card className="p-4">
                    <p className="text-xs text-muted"><Term label="Breakeven CPA" definition={f.model === "DEFAULT" ? "(P − C − S) × D − R × Q − K. The most you can pay per order before losing money." : "Expected contribution per placed lead before ad spend: the most you can pay per lead."} /></p>
                    <div className="mt-1"><FitText max={24} min={14} className={result.breakevenCpa < 0 ? "text-negative" : "text-positive"}>{fmt(result.breakevenCpa)}</FitText></div>
                    <p className="text-[11px] text-subtle">{unit}</p>
                  </Card>
                  <Card className="p-4">
                    <p className="text-xs text-muted"><Term label="Target CPA" definition="Breakeven CPA − target profit. Pay at most this to hit your profit target." /></p>
                    <div className="mt-1"><FitText max={24} min={14}>{fmt(result.targetCpa)}</FitText></div>
                    <p className="text-[11px] text-subtle">{unit}</p>
                  </Card>
                  <Card className="p-4">
                    <p className="text-xs text-muted"><Term label="Expected profit" definition="Breakeven CPA − your current CPA." /></p>
                    <div className="mt-1"><FitText max={24} min={14} className={(result.expectedProfitAtCurrentCpa ?? 0) < 0 ? "text-negative" : "text-fg"}>{result.expectedProfitAtCurrentCpa === null ? "—" : fmt(result.expectedProfitAtCurrentCpa)}</FitText></div>
                    <p className="text-[11px] text-subtle">{unit} at current CPA</p>
                  </Card>
                </div>
                {result.breakevenCpa < 0 ? <p className="rounded-lg border border-negative/30 bg-negative-soft p-3 text-sm text-negative">This product loses money before any ad spend at these rates. No CPA is low enough.</p> : null}
                <Card>
                  <CardHeader title="Assumptions" />
                  <CardBody className="flex flex-col gap-1 text-sm text-muted">
                    {result.assumptions.map((a) => <p key={a}>• {a}</p>)}
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader title="Delivery rate × CPA sensitivity" description={`Expected profit ${unit}. Rows: delivery probability. Columns: CPA you pay.`} />
                  <div className="overflow-x-auto p-4">
                    <table className="w-full border-separate border-spacing-0.5 text-xs">
                      <thead>
                        <tr>
                          <th scope="col" className="px-2 py-1 text-left font-medium text-subtle">D \ CPA</th>
                          {result.sensitivity.cpas.map((c) => <th key={c} scope="col" className="num px-2 py-1 text-right font-medium text-subtle">{fmt(c)}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {result.sensitivity.deliveryRates.map((d, i) => {
                          const isCurrent = Math.abs(d - Number.parseFloat(f.deliveryProbability) / 100) < 0.005;
                          const scale = Math.max(...result.sensitivity.profit.flat().map(Math.abs));
                          return (
                            <tr key={d}>
                              <th scope="row" className={cn("num px-2 py-1 text-left font-medium", isCurrent ? "text-brand-strong" : "text-muted")}>{formatPercent(d, 0)}{isCurrent ? " ●" : ""}</th>
                              {result.sensitivity.profit[i].map((v, j) => (
                                <td key={j} className={cn("num rounded px-2 py-1.5 text-right", v < 0 ? "text-negative" : "text-fg")} style={cellStyle(v, scale)}>{fmt(v)}</td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </>
            ) : null}
            <Card>
              <CardHeader title="Saved scenarios" />
              <CardBody className="flex flex-col gap-3">
                {canSave && result ? (
                  <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); save.mutate({ name, productId: productId || null, inputs: toInput(f, currency) }); }}>
                    <Input aria-label="Scenario name" placeholder="e.g. Winter price, 55% delivery" value={name} onChange={(e) => setName(e.target.value)} required />
                    <Button type="submit" disabled={save.isPending}><Save /> Save scenario</Button>
                  </form>
                ) : null}
                {scenarios.data?.length ? (
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {scenarios.data.map((s) => (
                      <li key={s.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                        <button className="flex-1 text-left hover:text-brand-strong" onClick={() => setForm(fromInput(s.inputs as SimulatorInput, currency))}>{s.name}</button>
                        {s.product ? <Badge>{s.product.name}</Badge> : null}
                        <span className="text-xs text-subtle">{formatDate(s.createdAt)}</span>
                        {canSave ? <Button size="icon" variant="ghost" aria-label={`Delete ${s.name}`} onClick={() => del.mutate({ id: s.id })}><Trash2 /></Button> : null}
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-sm text-muted">No saved scenarios yet.</p>}
              </CardBody>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
