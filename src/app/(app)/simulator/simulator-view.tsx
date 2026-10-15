"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, Save, Trash2 } from "lucide-react";
import * as React from "react";
import { useCurrencyView } from "@/components/app/currency";
import { FitText } from "@/components/app/fit-money";
import { MoneyInput, minorToInput } from "@/components/app/money-input";
import { MoreDetails } from "@/components/app/more-details";
import { PageHeader } from "@/components/app/page-header";
import { useCan } from "@/components/app/use-can";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { HelpTip, Term } from "@/components/ui/tooltip";
import { simulate, simulatorInputSchema, type SimulatorInput } from "@/domain/simulator";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/core";
import { formatMoney, parseToMinor } from "@/lib/money";
import { errorMessage, useTRPC } from "@/lib/trpc/client";
import { cn, formatPercent } from "@/lib/utils";

type Form = {
  model: "DEFAULT" | "DETAILED";
  salePrice: string; sourcingCost: string; outboundShipping: string; rtoFee: string; callCenterCost: string; packagingCost: string;
  deliveryProbability: string; returnIsComplement: boolean; returnProbability: string; lostProbability: string;
  confirmationRate: string; shippingRate: string; callCenterBasis: "PLACED_LEAD" | "CONFIRMED_ORDER";
  targetProfitPerOrder: string; currentCpa: string;
};

const pct = (v: number | null | undefined, fallback: number) => String(Math.round(((v ?? fallback) * 100) * 10) / 10);
/** A rate read from orders, kept within 0–100%: more parcels shipped than orders placed in the period reads as 100%. */
const observedPct = (v: number | null | undefined, fallback: number) => pct(v == null ? v : Math.min(1, Math.max(0, v)), fallback);

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
      <Input id={id} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="num pe-8" />
      <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-[11px] text-subtle">%</span>
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
  const { t, date } = useT();
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
      deliveryProbability: observedPct(d, 0.6), returnIsComplement: true, returnProbability: observedPct(o.rates.returnRate, 1 - d), lostProbability: observedPct(o.rates.lostRate, 0),
      confirmationRate: observedPct(o.rates.confirmationRate, 0.75), shippingRate: observedPct(o.rates.shippingRate, 0.95), callCenterBasis: o.callCenterBasis === "PLACED_LEAD" ? "PLACED_LEAD" : "CONFIRMED_ORDER",
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
      error = e instanceof Error && "issues" in e ? (e as { issues: { message: string }[] }).issues[0]?.message ?? msg("Invalid inputs") : e instanceof Error ? e.message : msg("Invalid inputs");
    }
  }

  const save = useMutation(
    trpc.simulator.saveScenario.mutationOptions({
      onSuccess: () => { qc.invalidateQueries({ queryKey: trpc.simulator.listScenarios.queryKey() }); setName(""); toast("success", t("Scenario saved")); },
      onError: (e) => toast("error", errorMessage(e)),
    }),
  );
  const del = useMutation(trpc.simulator.deleteScenario.mutationOptions({ onSuccess: () => qc.invalidateQueries({ queryKey: trpc.simulator.listScenarios.queryKey() }), onError: (e) => toast("error", errorMessage(e)) }));

  const o = observed.data;
  const fmt = (v: number) => formatMoney(v, currency);
  const perLead = result?.unit === "placed lead";
  const unit = perLead ? t("per placed lead") : t("per order");

  return (
    <>
      <PageHeader
        title={t("Breakeven CPA simulator")}
        description={t("The most you can pay per order and still make a profit. Change any number to try it.")}
        actions={
          <>
            <Select aria-label={t("Product")} value={productId} onChange={(e) => { setProductId(e.target.value); setForm(null); }} className="w-52">
              {products.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <Button variant="ghost" onClick={() => setForm(null)}><RotateCcw /> {t("Reset to observed")}</Button>
          </>
        }
      />
      {!f ? <Skeleton className="h-96" /> : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[26rem_minmax(0,1fr)]">
          <Card>
            <CardHeader title={t("Formula inputs")} help={t("The numbers the formula uses, filled from the product details and this product's orders. Change any to try it; Reset to observed brings your data back.")} description={view === currency ? t("Currency: {currency}", { currency }) : t("Currency: {currency}. The simulator always works in {currency}, the currency your amounts are kept in.", { currency })} actions={
              <>
                <Select aria-label={t("Model")} value={f.model} onChange={(e) => set("model")(e.target.value as Form["model"])} className="w-36">
                  <option value="DEFAULT">{t("Default model")}</option><option value="DETAILED">{t("Detailed model")}</option>
                </Select>
                <HelpTip label={t("Model")}>{t("Default model: a quick formula per order confirmed and shipped. Detailed model: per placed lead, with confirmation, shipping, lost parcels, packaging and delivery paid on returns too.")}</HelpTip>
              </>
            } />
            <CardBody className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("Sale price P")} htmlFor="P" help={t("What the customer pays for one order, without delivery. With an offer, the price of the whole order. Example: 2900.")}><MoneyInput id="P" currency={currency} value={f.salePrice} onChange={set("salePrice")} /></Field>
                <Field label={t("Sourcing cost C")} htmlFor="C" help={t("What the goods of one order cost you. With Buy 1, get 1 free at 800 a piece, type 1600.")} hint={t("For one order: every piece it sends, free ones included")}><MoneyInput id="C" currency={currency} value={f.sourcingCost} onChange={set("sourcingCost")} /></Field>
                <Field label={t("Outbound shipping S")} htmlFor="S" help={t("What MDM charges to deliver one parcel. The default model counts it on delivered parcels only; the detailed model on every shipped parcel.")}><MoneyInput id="S" currency={currency} value={f.outboundShipping} onChange={set("outboundShipping")} /></Field>
                <Field label={t("RTO fee R")} htmlFor="R" help={t("What you pay for each parcel that comes back (RTO). Counted on the returned share Q.")}><MoneyInput id="R" currency={currency} value={f.rtoFee} onChange={set("rtoFee")} /></Field>
                <Field label={t("Call-center cost K")} htmlFor="K" help={t("What the call center charges for one order. The default model counts it once per order; the detailed model follows Call-center basis.")}><MoneyInput id="K" currency={currency} value={f.callCenterCost} onChange={set("callCenterCost")} /></Field>
                {f.model === "DETAILED" ? <Field label={t("Packaging G")} htmlFor="G" help={t("Box, bag and label for one parcel. Paid on every shipped parcel, even one that comes back.")}><MoneyInput id="G" currency={currency} value={f.packagingCost} onChange={set("packagingCost")} /></Field> : null}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("Delivery probability D")} htmlFor="D" help={t("The % of shipped parcels the customer receives and pays for. Your orders give it as delivered ÷ finished parcels, so parcels still on the road don't count.")} hint={t("Observed: {rate}", { rate: formatPercent(o?.rates.deliveryRate) })}><PctInput id="D" value={f.deliveryProbability} onChange={set("deliveryProbability")} /></Field>
                <Field label={t("Return probability Q")} htmlFor="Q" help={t("The % of shipped parcels that come back. Each costs the return fee R; in the detailed model its delivery and packaging too.")} hint={t("Observed: {rate}", { rate: formatPercent(o?.rates.returnRate) })}><PctInput id="Q" value={f.returnIsComplement ? String(Math.round((result?.returnProbabilityUsed ?? 0) * 1000) / 10) : f.returnProbability} onChange={set("returnProbability")} disabled={f.returnIsComplement} /></Field>
              </div>
              <label className="flex items-start gap-2 text-sm text-muted">
                <input type="checkbox" className="mt-0.5 size-4 accent-[#e1182c]" checked={f.returnIsComplement} onChange={(e) => set("returnIsComplement")(e.target.checked)} />
                {f.model === "DETAILED" ? (
                  <span>{t("Assume Q = 1 − D − L")} <span className="text-subtle">{t("(every shipped parcel that is not delivered or lost comes back)")}</span><HelpTip label={t("Assume Q = 1 − D − L")} className="ms-1.5 align-middle">{t("Ticked, Q is worked out for you so the shares add up to 100%. Untick it to type your own return probability.")}</HelpTip></span>
                ) : (
                  <span>{t("Assume Q = 1 − D")} <span className="text-subtle">{t("(every shipped parcel that is not delivered comes back)")}</span><HelpTip label={t("Assume Q = 1 − D")} className="ms-1.5 align-middle">{t("Ticked, Q is worked out for you so the shares add up to 100%. Untick it to type your own return probability.")}</HelpTip></span>
                )}
              </label>
              {f.model === "DETAILED" ? (
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t("Lost probability L")} htmlFor="L" help={t("The % of shipped parcels that never arrive and never come back. You lose the goods, the delivery fee and the packaging.")} hint={t("Observed: {rate}", { rate: formatPercent(o?.rates.lostRate) })}><PctInput id="L" value={f.lostProbability} onChange={set("lostProbability")} /></Field>
                  <Field label={t("Confirmation rate")} htmlFor="cr" help={t("The % of orders placed that the call center confirms. Your orders give it as confirmed ÷ placed.")} hint={t("Observed: {rate}", { rate: formatPercent(o?.rates.confirmationRate) })}><PctInput id="cr" value={f.confirmationRate} onChange={set("confirmationRate")} /></Field>
                  <Field label={t("Shipping rate")} htmlFor="sr" help={t("The % of confirmed orders that are really sent; the others are cancelled after the call. Your orders give it as shipped ÷ confirmed.")} hint={t("Observed: {rate}", { rate: formatPercent(o?.rates.shippingRate) })}><PctInput id="sr" value={f.shippingRate} onChange={set("shippingRate")} /></Field>
                  <Field label={t("Call-center basis")} htmlFor="ccb" help={t("Per placed lead: the call center is paid for every order that comes in. Per confirmed order: only for the orders it confirms.")}>
                    <Select id="ccb" value={f.callCenterBasis} onChange={(e) => set("callCenterBasis")(e.target.value as Form["callCenterBasis"])}><option value="PLACED_LEAD">{t("Per placed lead")}</option><option value="CONFIRMED_ORDER">{t("Per confirmed order")}</option></Select>
                  </Field>
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-3">
                <Field label={perLead ? t("Target profit per placed lead") : t("Target profit per order")} htmlFor="tp" help={t("What you want to keep from each order after ads. Target CPA = breakeven CPA − this. Type 0 to only break even.")}><MoneyInput id="tp" currency={currency} value={f.targetProfitPerOrder} onChange={set("targetProfitPerOrder")} /></Field>
                <Field label={t("Your current CPA")} htmlFor="cc" help={t("What you pay in ads now: per confirmed order in the default model, per placed lead in the detailed one. Expected profit uses it.")} hint={f.model === "DEFAULT" ? t("Observed CPCO: {cpa}", { cpa: o?.currentCpa.confirmed === null || !o ? "—" : fmt(o.currentCpa.confirmed) }) : t("Observed placed CPA: {cpa}", { cpa: o?.currentCpa.placed === null || !o ? "—" : fmt(o.currentCpa.placed) })}><MoneyInput id="cc" currency={currency} value={f.currentCpa} onChange={set("currentCpa")} /></Field>
              </div>
              {o ? (
                <p className="text-xs text-subtle">
                  {t("Observed sample: {placed} placed · {shipped} shipped · {delivered} delivered · {returned} returned.", { placed: o.sample.placed, shipped: o.sample.shipped, delivered: o.sample.delivered, returned: o.sample.returned })}
                  {o.sample.shipped < 10 ? ` ${t("Small sample: treat observed rates with caution.")}` : ""}
                </p>
              ) : null}
            </CardBody>
          </Card>

          <div className="flex flex-col gap-6">
            {error ? <Card className="border-negative/40 p-4 text-sm text-negative" role="alert">{t(error)}</Card> : null}
            {result ? (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Card className="p-4">
                    <p className="text-xs text-muted"><Term label={t("Breakeven CPA")} definition={f.model === "DEFAULT" ? t("(P − C − S) × D − R × Q − K. The most you can pay per order before losing money.") : t("The most you can pay per placed lead before losing money. Worked out as: confirmation rate × shipping rate × what a shipped parcel earns on average − call-center cost per lead.")} /></p>
                    <div className="mt-1"><FitText max={24} min={14} className={result.breakevenCpa < 0 ? "text-negative" : "text-positive"}>{fmt(result.breakevenCpa)}</FitText></div>
                    <p className="text-[11px] text-subtle">{unit}</p>
                  </Card>
                  <Card className="p-4">
                    <p className="text-xs text-muted"><Term label={t("Target CPA")} definition={t("Breakeven CPA − target profit. Pay at most this to hit your profit target.")} /></p>
                    <div className="mt-1"><FitText max={24} min={14}>{fmt(result.targetCpa)}</FitText></div>
                    <p className="text-[11px] text-subtle">{unit}</p>
                  </Card>
                  <Card className="p-4">
                    <p className="text-xs text-muted"><Term label={t("Expected profit")} definition={t("Breakeven CPA − your current CPA.")} /></p>
                    <div className="mt-1"><FitText max={24} min={14} className={(result.expectedProfitAtCurrentCpa ?? 0) < 0 ? "text-negative" : "text-fg"}>{result.expectedProfitAtCurrentCpa === null ? "—" : fmt(result.expectedProfitAtCurrentCpa)}</FitText></div>
                    <p className="text-[11px] text-subtle">{perLead ? t("per placed lead at current CPA") : t("per order at current CPA")}</p>
                  </Card>
                </div>
                {result.breakevenCpa < 0 ? <p className="rounded-lg border border-negative/30 bg-negative-soft p-3 text-sm text-negative">{t("This product loses money before any ad spend at these rates. No CPA is low enough.")}</p> : null}
                <MoreDetails id="simulator" hint={t("The assumptions behind these numbers, and the profit at other delivery rates and costs per order.")}>
                  <Card>
                    <CardHeader title={t("Assumptions")} help={t("What the chosen model takes for granted. Change the model or the Q tick box above to change them.")} />
                    <CardBody className="flex flex-col gap-1 text-sm text-muted">
                      {result.assumptions.map((a) => <p key={a}>• {t(a)}</p>)}
                    </CardBody>
                  </Card>
                  <Card>
                    <CardHeader title={t("Delivery rate × CPA sensitivity")} help={t("Each cell is the expected profit if the delivery rate were the row's and you paid the column's CPA. Green earns, red loses; ● marks your delivery rate.")} description={perLead ? t("Expected profit per placed lead. Rows: delivery probability. Columns: CPA you pay.") : t("Expected profit per order. Rows: delivery probability. Columns: CPA you pay.")} />
                    <div className="overflow-x-auto p-4">
                      <table className="w-full border-separate border-spacing-0.5 text-xs">
                        <thead>
                          <tr>
                            <th scope="col" className="px-2 py-1 text-start font-medium text-subtle">D \ CPA</th>
                            {result.sensitivity.cpas.map((c) => <th key={c} scope="col" className="num px-2 py-1 text-end font-medium text-subtle">{fmt(c)}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {result.sensitivity.deliveryRates.map((d, i) => {
                            const isCurrent = Math.abs(d - Number.parseFloat(f.deliveryProbability) / 100) < 0.005;
                            const scale = Math.max(...result.sensitivity.profit.flat().map(Math.abs));
                            return (
                              <tr key={d}>
                                <th scope="row" className={cn("num px-2 py-1 text-start font-medium", isCurrent ? "text-brand-strong" : "text-muted")}>{formatPercent(d, 0)}{isCurrent ? " ●" : ""}</th>
                                {result.sensitivity.profit[i].map((v, j) => (
                                  <td key={j} className={cn("num rounded px-2 py-1.5 text-end", v < 0 ? "text-negative" : "text-fg")} style={cellStyle(v, scale)}>{fmt(v)}</td>
                                ))}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                </MoreDetails>
              </>
            ) : null}
            <Card>
              <CardHeader title={t("Saved scenarios")} help={t("Named copies of these inputs for this product. Tap a name to load its numbers back into the form.")} />
              <CardBody className="flex flex-col gap-3">
                {canSave && result ? (
                  <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); save.mutate({ name, productId: productId || null, inputs: toInput(f, currency) }); }}>
                    <Input aria-label={t("Scenario name")} placeholder={t("e.g. Winter price")} value={name} onChange={(e) => setName(e.target.value)} required />
                    <Button type="submit" disabled={save.isPending}><Save /> {t("Save scenario")}</Button>
                  </form>
                ) : null}
                {scenarios.data?.length ? (
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {scenarios.data.map((s) => (
                      <li key={s.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                        <button className="flex-1 text-start hover:text-brand-strong" onClick={() => setForm(fromInput(s.inputs as SimulatorInput, currency))}>{s.name}</button>
                        {s.product ? <Badge>{s.product.name}</Badge> : null}
                        <span className="text-xs text-subtle">{date(s.createdAt)}</span>
                        {canSave ? <Button size="icon" variant="ghost" aria-label={t("Delete {name}", { name: s.name })} onClick={() => del.mutate({ id: s.id })}><Trash2 /></Button> : null}
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-sm text-muted">{t("No saved scenarios yet.")}</p>}
              </CardBody>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
