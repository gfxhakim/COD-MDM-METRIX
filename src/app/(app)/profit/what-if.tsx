"use client";

import { RotateCcw, Sparkles } from "lucide-react";
import * as React from "react";
import { useMoney } from "@/components/app/currency";
import { MoneyInput, minorToInput } from "@/components/app/money-input";
import { MoreDetailsButton } from "@/components/app/more-details";
import { OfferPicker } from "@/components/app/offer-picker";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field } from "@/components/ui/form";
import { Term } from "@/components/ui/tooltip";
import { orderProfit, type OrderProfitInput } from "@/domain/orderProfit";
import { useT } from "@/i18n/client";
import { currencyExponent, minorToMajor, parseToMinor } from "@/lib/money";
import { cn, formatPercent } from "@/lib/utils";
import { RateGrid } from "./charts";
import { count, useAdMoney, type Row, type Tracker } from "./shared";

const MONTH = 30;

type Sim = { ad: string; conf: number; del: number; perDay: number; price: string; cost: string; pieces: number; delivery: string; ret: string; calls: string; pack: string; expenses: string };

/** One month at these numbers: delivered orders and what they leave after the month's expenses. */
function month(input: OrderProfitInput, perDay: number, expenses: number) {
  const r = orderProfit(input);
  if (!r.ok) return null;
  const delivered = (perDay * MONTH) / r.ordersPerDelivered;
  return { r, delivered, profit: Math.round(delivered * r.profit - expenses) };
}

/** Five rates 10 points apart around `v` (in %), within 10% to 100%, and where `v` sits among them. */
function around(v: number) {
  const start = Math.min(60, Math.max(10, Math.round(v / 10) * 10 - 20));
  const list = [0, 1, 2, 3, 4].map((i) => (start + i * 10) / 100);
  const at = list.reduce((best, x, i) => (Math.abs(x * 100 - v) < Math.abs(list[best] * 100 - v) ? i : best), 0);
  return { list, at };
}

/** A slider with its value written beside it, and a box to type it exactly. */
function Slider({ id, label, help, value, display, min, max, step, onChange, hint }: { id: string; label: string; help: string; value: number; display: string; min: number; max: number; step: number; onChange: (v: number) => void; hint?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-[18px] bg-surface-2 p-3.5 ring-1 ring-border/50">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-[13px] font-semibold"><Term label={label} definition={help} /></label>
        <span className="num text-[18px] font-extrabold text-brand-strong">{display}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={Math.min(max, Math.max(min, value))}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-2 w-full cursor-pointer accent-[#e1182c]"
      />
      {hint ? <span className="text-[11px] text-subtle">{hint}</span> : null}
    </div>
  );
}

/**
 * What if: the product's own numbers, read from MDM, Meta and its details, moved by hand to see
 * what a month would leave. Nothing typed here is saved.
 */
export function WhatIf({ row, data, base }: { row: Row; data: Tracker; base: OrderProfitInput }) {
  const { t, tx } = useT();
  const money = useMoney();
  const cur = data.currency;
  const ad = useAdMoney(cur);
  const fmt = (v: number) => money.fmt(v, cur, { decimals: false });
  const unit = 10 ** currencyExponent(cur);
  // Whole numbers under a thousand, one decimal for K and M: "+650", "+1.5K".
  const compact = (v: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: Math.abs(v / unit) < 1000 ? 0 : 1, signDisplay: "exceptZero" }).format(v / unit);
  const [open, setOpen] = React.useState(false);

  // Orders per day to one decimal: a product with 0.3 a day must not start at 1.
  const basePerDay = row.pace.ordersPerDay > 0 ? Math.max(0.1, Math.round(row.pace.ordersPerDay * 10) / 10) : 10;
  const fewPerDay = basePerDay < 10;
  const perDayText = (n: number) => (n < 10 ? n.toFixed(1).replace(/\.0$/, "") : count(n));
  const adMajor = (minor: number) => Math.round(minorToMajor(ad.toAd(minor), ad.adCurrency) * 100) / 100;
  const expensesNow = row.pace.expensesPerMonth;
  const initial = React.useMemo(
    (): Sim => ({
      ad: base.adCostPerOrder === null ? "" : String(Math.round(minorToMajor(ad.toAd(base.adCostPerOrder), ad.adCurrency) * 100) / 100),
      // Kept exact until a slider moves, so What if starts at the same numbers as the page above.
      conf: base.confirmationRate * 100,
      del: base.deliveryRate * 100,
      perDay: basePerDay,
      price: minorToInput(base.price, cur),
      cost: minorToInput(base.costPerPiece, cur),
      pieces: base.pieces,
      delivery: minorToInput(base.deliveryFee, cur),
      ret: minorToInput(base.returnFee, cur),
      calls: minorToInput(base.callCenterFee, cur),
      pack: minorToInput(base.packagingFee, cur),
      expenses: minorToInput(expensesNow, cur),
    }),
    [base, basePerDay, cur, expensesNow, ad],
  );
  const [sim, setSim] = React.useState<Sim>(initial);
  const set = <K extends keyof Sim>(k: K) => (v: Sim[K]) => setSim((s) => ({ ...s, [k]: v }));
  const changed = JSON.stringify(sim) !== JSON.stringify(initial);

  const minor = (s: string, c = cur) => {
    try {
      return s.trim() ? Math.max(0, parseToMinor(s, c)) : 0;
    } catch {
      return 0;
    }
  };
  const del = sim.del === initial.del ? base.deliveryRate : sim.del / 100;
  const input: OrderProfitInput = {
    ...base,
    price: minor(sim.price),
    pieces: sim.pieces,
    costPerPiece: minor(sim.cost),
    deliveryFee: minor(sim.delivery),
    returnFee: minor(sim.ret),
    callCenterFee: minor(sim.calls),
    packagingFee: minor(sim.pack),
    confirmationRate: sim.conf === initial.conf ? base.confirmationRate : sim.conf / 100,
    deliveryRate: del,
    lostRate: Math.min(base.lostRate, Math.max(0, 1 - del)),
    adCostPerOrder: sim.ad.trim() === "" ? null : ad.fromAd(minor(sim.ad, ad.adCurrency)),
  };
  const expenses = minor(sim.expenses);
  const now = month(base, basePerDay, expensesNow);
  const check = orderProfit(input);
  const then = month(input, sim.perDay, expenses);

  // The ad slider runs to twice the most an order can cost, or twice today's cost, whichever is more.
  const adNow = adMajor(input.adCostPerOrder ?? 0);
  const adMax = Math.max(ad.usd ? 5 : 1000, Math.ceil(Math.max(then ? adMajor(then.r.breakevenAdCostPerOrder) * 2 : 0, adNow * 2, adMajor(base.adCostPerOrder ?? 0) * 2)));
  const adStep = ad.usd ? 0.05 : 10;

  const confs = around(sim.conf);
  const dels = around(sim.del);
  const grid = confs.list.map((c) => dels.list.map((d) => month({ ...input, confirmationRate: c, deliveryRate: d, lostRate: Math.min(input.lostRate, 1 - d) }, sim.perDay, expenses)?.profit ?? 0));

  // Stock: returned parcels come back to it, so each shipped parcel uses up only its delivered and lost share.
  const stock = row.stock?.read && row.stock.available > 0 && then ? (() => {
    const shipped = row.stock.available / (input.pieces * (input.deliveryRate + input.lostRate));
    const delivered = shipped * input.deliveryRate;
    const perDayShipped = sim.perDay * input.confirmationRate * input.shippingRate;
    return { delivered, days: perDayShipped > 0 ? shipped / perDayShipped : null, profit: Math.round(delivered * then.r.profit) };
  })() : null;

  const delta = then && now ? then.profit - now.profit : null;

  return (
    <Card id="what-if" className="min-w-0 scroll-mt-24 overflow-hidden">
      <CardHeader
        title={<span className="inline-flex items-center gap-2"><Sparkles className="size-4 text-brand" aria-hidden="true" />{t("What if")}</span>}
        help={t("Starts from this product's real numbers. Move a slider to see what a month would leave you: for example a cheaper Meta cost, or a better delivery rate. Nothing here is saved.")}
        description={t("Your numbers now, ready to move. Nothing here is saved.")}
        actions={changed ? <Button variant="ghost" size="sm" onClick={() => setSim(initial)}><RotateCcw /> {t("Back to my numbers")}</Button> : null}
      />
      <div className="grid grid-cols-1 gap-5 px-5 pb-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Slider
              id="wi-ad"
              label={t("Meta per order")}
              help={t("What Meta costs for each order placed. Starts at what the linked campaigns cost in these days.")}
              value={adNow}
              display={sim.ad.trim() === "" ? t("No ads") : ad.fmtAd(input.adCostPerOrder ?? 0)}
              min={0}
              max={adMax}
              step={adStep}
              onChange={(v) => set("ad")(String(v))}
              hint={then ? t("Up to {max} before losing money", { max: ad.fmtAd(then.r.breakevenAdCostPerOrder) }) : undefined}
            />
            <Slider id="wi-perday" label={t("Orders per day")} help={t("Orders placed each day. Starts at this product's average in these days.")} value={sim.perDay} display={perDayText(sim.perDay)} min={fewPerDay ? 0.1 : 1} max={Math.max(fewPerDay ? 20 : 50, Math.ceil(basePerDay * 3))} step={fewPerDay ? 0.1 : 1} onChange={set("perDay")} hint={t("Now: {n} a day", { n: row.pace.ordersPerDay.toFixed(1) })} />
            <Slider id="wi-conf" label={t("Confirmation rate")} help={t("The % of orders the call center confirms.")} value={sim.conf} display={`${Math.round(sim.conf)}%`} min={10} max={100} step={1} onChange={set("conf")} hint={t("Now: {rate}", { rate: formatPercent(base.confirmationRate, 0) })} />
            <Slider id="wi-del" label={t("Delivery rate")} help={t("The % of shipped parcels the customer receives and pays.")} value={sim.del} display={`${Math.round(sim.del)}%`} min={10} max={100} step={1} onChange={set("del")} hint={t("Now: {rate}", { rate: formatPercent(base.deliveryRate, 0) })} />
          </div>
          <MoreDetailsButton open={open} onToggle={setOpen} labels={[t("Change the price and costs too"), t("Hide the price and costs")]} controls="wi-costs" className="self-start" />
          {open ? (
            <div id="wi-costs" className="grid grid-cols-1 gap-3 rounded-[18px] border border-border p-3.5 sm:grid-cols-2">
              <Field label={t("Price of one order")} htmlFor="wi-price" help={t("What the customer pays for one order. Starts at what MDM really collected on your delivered orders.")}><MoneyInput id="wi-price" currency={cur} value={sim.price} onChange={set("price")} /></Field>
              <Field label={t("Cost of one piece")} htmlFor="wi-cost" help={t("What one piece costs you, free pieces included in the offer.")}><MoneyInput id="wi-cost" currency={cur} value={sim.cost} onChange={set("cost")} /></Field>
              <Field label={t("Your offer")} htmlFor="wi-pieces" help={t("How many pieces one order sends. Changing it here doesn't change the product.")} className="sm:col-span-2"><OfferPicker id="wi-pieces" label={t("Offer")} value={sim.pieces} onChange={set("pieces")} className="w-full" /></Field>
              <Field label={t("Delivery fee per parcel")} htmlFor="wi-delivery" help={t("What MDM charges to deliver one parcel.")}><MoneyInput id="wi-delivery" currency={cur} value={sim.delivery} onChange={set("delivery")} /></Field>
              <Field label={t("Return fee per parcel")} htmlFor="wi-ret" help={t("What MDM charges for a parcel that comes back.")}><MoneyInput id="wi-ret" currency={cur} value={sim.ret} onChange={set("ret")} /></Field>
              <Field label={t("Call center per order")} htmlFor="wi-calls" help={t("What the call center charges for one order.")}><MoneyInput id="wi-calls" currency={cur} value={sim.calls} onChange={set("calls")} /></Field>
              <Field label={t("Packaging per parcel")} htmlFor="wi-pack" help={t("Box, bag and label for one parcel.")}><MoneyInput id="wi-pack" currency={cur} value={sim.pack} onChange={set("pack")} /></Field>
              <Field label={t("Your expenses per month")} htmlFor="wi-exp" help={t("Rent, pay and the other expenses this product carries in a month. Starts at its share of your expenses in these days.")} className="sm:col-span-2"><MoneyInput id="wi-exp" currency={cur} value={sim.expenses} onChange={set("expenses")} /></Field>
            </div>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {then ? (
            <>
              <section aria-labelledby="wi-month" className={cn("relative overflow-hidden rounded-[22px] p-5 text-white shine", then.profit < 0 ? "bg-[linear-gradient(135deg,#3a0a10,#8a0716)]" : "bg-brand-hero")}>
                <span id="wi-month" className="text-[14px] font-semibold"><Term label={t("Profit per month")} definition={t("Orders per day × 30 ÷ orders placed for each delivered one × profit per delivered order − your expenses per month.")} iconClassName="text-white/70 hover:text-white" /></span>
                <p className="num mt-2 min-w-0 truncate text-[clamp(30px,8vw,46px)] font-extrabold leading-none [text-shadow:0_2px_16px_rgb(255_170_178/0.55)]" aria-live="polite">{then.profit > 0 ? "+" : ""}{fmt(then.profit)}</p>
                <p className="mt-2 text-[12.5px] text-white/90">
                  {delta !== null && changed ? (delta === 0 ? t("Same as your numbers now.") : tx("{delta} compared with your numbers now.", { delta: <b className="num">{delta > 0 ? "+" : ""}{fmt(delta)}</b> })) : t("At your numbers now.")}
                </p>
              </section>
              <dl className="grid grid-cols-3 gap-2 sm:gap-3">
                {[
                  [t("Per delivered order"), fmt(then.r.profit), then.r.profit < 0 ? "text-negative" : "text-positive"],
                  [t("Delivered per month"), count(then.delivered), ""],
                  [t("Meta can cost up to"), then.r.breakevenAdCostPerOrder > 0 ? ad.fmtAd(then.r.breakevenAdCostPerOrder) : "—", "text-brand-strong"],
                ].map(([label, value, tone]) => (
                  <div key={label} className="flex min-w-0 flex-col justify-between gap-1 rounded-[18px] bg-surface-2 p-2.5 ring-1 ring-border/50 sm:p-3">
                    <dt className="text-[11px] font-semibold leading-tight text-muted sm:text-[11.5px]">{label}</dt>
                    <dd className={cn("num truncate text-[14px] font-extrabold sm:text-[17px]", tone)}>{value}</dd>
                  </div>
                ))}
              </dl>
              {stock ? (
                <p className="rounded-2xl bg-surface-2 px-4 py-3 text-[12.5px] text-muted">
                  {tx("Your {pieces} pieces in MDM's stock make about {orders} delivered orders: {days} at {perDay} orders a day, for about {profit}.", {
                    pieces: <b className="num text-fg">{count(row.stock!.available)}</b>,
                    orders: <b className="num text-fg">{count(stock.delivered)}</b>,
                    days: <b className="num text-fg">{stock.days === null ? "—" : t("{n} days", { n: count(stock.days) })}</b>,
                    perDay: <b className="num text-fg">{perDayText(sim.perDay)}</b>,
                    profit: <b className={cn("num", stock.profit < 0 ? "text-negative" : "text-fg")}>{fmt(stock.profit)}</b>,
                  })}
                </p>
              ) : null}
            </>
          ) : (
            !check.ok ? <p className="rounded-2xl bg-warning-soft px-4 py-3 text-sm text-warning" role="alert">{t(check.reason)}</p> : null
          )}
          <div>
            <h3 className="mb-1 text-sm font-bold">
              <Term label={t("Profit per month by confirmation and delivery rate")} definition={t("Each box is a month's profit at that confirmation rate (rows) and delivery rate (columns), with everything else as set above. The ringed box is closest to the rates set above.")} />
            </h3>
            <p className="mb-2 text-[11.5px] text-subtle">{t("In thousands (K) or millions (M) of {currency}.", { currency: cur })}</p>
            <RateGrid confirmations={confs.list} deliveries={dels.list} values={grid} current={{ row: confs.at, col: dels.at }} fmt={compact} label={t("Profit per month by confirmation and delivery rate")} />
          </div>
        </div>
      </div>
    </Card>
  );
}
