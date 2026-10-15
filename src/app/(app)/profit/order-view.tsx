"use client";

import type { inferRouterOutputs } from "@trpc/server";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Pencil, RotateCcw } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { useMoney } from "@/components/app/currency";
import { MoneyInput, minorToInput } from "@/components/app/money-input";
import { MoreDetailsButton, useMoreDetails } from "@/components/app/more-details";
import { OfferPicker } from "@/components/app/offer-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { Term } from "@/components/ui/tooltip";
import { offerLabel } from "@/domain/offers";
import { adCostPerDelivered, orderProfit, type OrderProfitInput } from "@/domain/orderProfit";
import { roundRate, seedFor, type FieldSource } from "@/domain/profitTracker";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/core";
import { currencyExponent, parseToMinor } from "@/lib/money";
import { errorMessage, useTRPC } from "@/lib/trpc/client";
import { cn, formatPercent } from "@/lib/utils";
import type { AppRouter } from "@/server/trpc/root";
import { CampaignBars, OrderFunnel, PriceSplit, ProfitByDay } from "./charts";
import { Bridge, Hero } from "./parts";

type Tracker = inferRouterOutputs<AppRouter>["profit"]["tracker"];
type Row = Tracker["products"][number];
type Funnel = Row["funnel"];

const count = (n: number) => Math.round(n).toLocaleString("en-US");
const pct = (v: number | null) => formatPercent(v, 0);

/** The colors of the parts of an order's price; checked for color blindness, and every part is also written out. */
export const PART_COLORS = { product: "#c8102e", delivery: "#eda100", calls: "#2a78d6", ads: "#eb6834", returns: "#4a3aa7" } as const;

// ─────────────────────────── Numbers from the data, and the ones typed over them ───────────────────────────

type Source = FieldSource | "campaigns" | "none";

/** One delivered order's numbers read from the data: product details, real orders and linked campaigns. */
function fromData(row: Row, data: Tracker): { input: OrderProfitInput; sources: Partial<Record<keyof OrderProfitInput, Source>> } {
  const seed = seedFor(row, data.defaults);
  const i = seed.inputs;
  const pieces = Math.max(1, row.piecesPerOrder);
  const adsKnown = seed.sources.cpa === "you" || seed.sources.cpa === "orders";
  return {
    input: {
      // The product details' sale price is for one whole order; anything else is per piece.
      price: row.cost ? row.cost.salePrice : i.salePrice * pieces,
      pieces,
      costPerPiece: i.unitCost,
      deliveryFee: i.forwardShippingFee,
      packagingFee: i.packagingFee,
      returnFee: i.rtoFee,
      callCenterFee: i.callCenterFee,
      callCenterBasis: i.callCenterBasis,
      otherFees: i.extraFeePerDelivered,
      confirmationRate: i.confirmationRate,
      shippingRate: i.shippingRate,
      deliveryRate: i.deliveryRate,
      lostRate: i.lostRate,
      adCostPerOrder: adsKnown ? i.cpa : null,
    },
    sources: {
      price: row.cost ? "product" : seed.sources.salePrice,
      costPerPiece: seed.sources.unitCost,
      deliveryFee: seed.sources.forwardShippingFee,
      returnFee: seed.sources.rtoFee,
      callCenterFee: seed.sources.callCenterFee,
      packagingFee: seed.sources.packagingFee,
      confirmationRate: seed.sources.confirmationRate,
      deliveryRate: seed.sources.deliveryRate,
      adCostPerOrder: seed.sources.cpa === "orders" ? "campaigns" : adsKnown ? "you" : "none",
    },
  };
}

const SOURCE_TEXT: Record<Source, string> = {
  you: msg("Saved by you in the stock calculator"),
  orders: msg("From your orders"),
  product: msg("From product details"),
  mdm: msg("From MDM"),
  default: msg("An example: not enough finished orders yet"),
  campaigns: msg("From the campaigns linked to it"),
  none: msg("No campaign is linked to this product yet"),
};

type MoneyField = "price" | "costPerPiece" | "adCostPerOrder" | "deliveryFee" | "returnFee" | "callCenterFee" | "packagingFee";
type RateField = "confirmationRate" | "deliveryRate";
type Edits = Partial<Record<MoneyField | RateField, string>>;

function applyEdits(base: OrderProfitInput, edits: Edits, currency: string): { input: OrderProfitInput; problem: string | null } {
  let problem: string | null = null;
  const input = { ...base };
  for (const [k, raw] of Object.entries(edits) as [MoneyField | RateField, string][]) {
    if (k === "confirmationRate" || k === "deliveryRate") {
      const v = Number.parseFloat((raw || "0").replace(",", "."));
      if (!Number.isFinite(v) || v < 0 || v > 100) problem ??= msg("Rates go from 0 to 100%.");
      else input[k] = roundRate(v / 100);
      continue;
    }
    try {
      const v = parseToMinor(raw || "0", currency);
      if (v < 0) throw new Error();
      input[k] = v;
    } catch {
      problem ??= msg("One of the amounts isn't a number.");
    }
  }
  return { input, problem };
}

// ─────────────────────────── The offer ───────────────────────────

function OfferControl({ row, canEdit, fmt, price }: { row: Row; canEdit: boolean; fmt: (v: number) => string; price: number }) {
  const { t, tx } = useT();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const save = useMutation(
    trpc.products.update.mutationOptions({
      onSuccess: async (_r, vars) => {
        await Promise.all([qc.invalidateQueries({ queryKey: trpc.profit.pathKey() }), qc.invalidateQueries({ queryKey: trpc.products.pathKey() })]);
        toast("success", `${row.name}: ${offerLabel(vars.piecesPerOrder ?? 1, t)}`);
      },
      onError: (e) => toast("error", errorMessage(e)),
    }),
  );
  const pieces = Math.max(1, row.piecesPerOrder);
  const parts = { offer: <b>{offerLabel(pieces, t)}</b>, n: <b className="num">{pieces}</b>, price: <b className="num">{fmt(price)}</b> };
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-2xl bg-surface-2 p-3.5 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-muted">{t("Your offer")}</p>
        <p className="text-sm">
          {price > 0
            ? pieces === 1 ? tx("{offer}: each order sends {n} piece for {price}.", parts) : tx("{offer}: each order sends {n} pieces for {price}.", parts)
            : pieces === 1 ? tx("{offer}: each order sends {n} piece.", parts) : tx("{offer}: each order sends {n} pieces.", parts)}
        </p>
        <p className="text-[11px] text-subtle">{t("Counts for every order of this product. When an order lists more pieces, its own number counts.")}</p>
      </div>
      {canEdit ? (
        <OfferPicker key={pieces} id={`offer-${row.id}`} label={t("Offer")} value={pieces} disabled={save.isPending} onChange={(n) => n !== pieces && save.mutate({ id: row.id, piecesPerOrder: n })} className="sm:w-80" />
      ) : null}
    </div>
  );
}

// ─────────────────────────── Campaigns ───────────────────────────

/** Campaign rates once it has enough finished parcels; else the product's. */
function campaignRates(c: Funnel, product: OrderProfitInput, minFinished: number) {
  const own = c.finished >= minFinished && c.confirmationRate !== null && c.deliveryRate !== null;
  return {
    own,
    confirmationRate: own ? c.confirmationRate : product.confirmationRate,
    shippingRate: own ? c.shippingRate : product.shippingRate,
    deliveryRate: own ? c.deliveryRate : product.deliveryRate,
  };
}

function AdChain({ adCostPerOrder, input, fmt }: { adCostPerOrder: number; input: OrderProfitInput; fmt: (v: number) => string }) {
  const { t } = useT();
  const perConfirmed = Math.round(adCostPerOrder / input.confirmationRate);
  const perDelivered = adCostPerDelivered(adCostPerOrder, input) ?? 0;
  const shipped = input.shippingRate < 0.995;
  const box = (value: number, label: string, hero = false) => (
    <div className={cn("flex min-w-0 flex-col rounded-2xl px-3.5 py-2.5", hero ? "bg-brand-hero shine text-white shadow-[0_10px_24px_rgb(204_19_37/0.3)]" : "bg-surface-2")}>
      <span className="num text-[17px] font-extrabold leading-tight">{fmt(value)}</span>
      <span className={cn("text-[11px]", hero ? "text-white/85" : "text-subtle")}>{label}</span>
    </div>
  );
  const step = (text: string) => (
    <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-brand-strong">
      <ArrowRight className="size-3.5" aria-hidden="true" />
      {text}
    </span>
  );
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label={t("Ads cost {placed} per order placed, {confirmed} per confirmed order and {delivered} per delivered order", { placed: fmt(adCostPerOrder), confirmed: fmt(perConfirmed), delivered: fmt(perDelivered) })}>
      {box(adCostPerOrder, t("per order placed"))}
      {step(t("÷ {pct} confirmed", { pct: pct(input.confirmationRate) }))}
      {box(perConfirmed, t("per confirmed order"))}
      {step(shipped ? t("÷ {ship} shipped ÷ {del} delivered", { ship: pct(input.shippingRate), del: pct(input.deliveryRate) }) : t("÷ {del} delivered", { del: pct(input.deliveryRate) }))}
      {box(perDelivered, t("per delivered order"), true)}
    </div>
  );
}

/** A campaign's numbers as a small grid, for phones. */
function CampaignNumbers({ fmt, spend, placed, perOrder, confirmed, delivered, perDelivered, over }: { fmt: (v: number) => string; spend: number; placed: number; perOrder: number | null; confirmed: number | null; delivered: number | null; perDelivered: number | null; over: boolean }) {
  const { t } = useT();
  const cells: [string, string, string?][] = [
    [t("Spent"), fmt(spend)],
    [t("Orders"), count(placed)],
    [t("Per order"), perOrder === null ? "—" : fmt(perOrder)],
    [t("Confirmed"), pct(confirmed)],
    [t("Delivered"), pct(delivered)],
    [t("Per delivered order"), perDelivered === null ? "—" : fmt(perDelivered), over ? "text-negative" : "text-brand-strong"],
  ];
  return (
    <dl className="mt-2.5 grid grid-cols-3 gap-x-3 gap-y-2">
      {cells.map(([label, value, tone]) => (
        <div key={label} className="min-w-0">
          <dt className="text-[10.5px] leading-tight text-subtle">{label}</dt>
          <dd className={cn("num text-[13px] font-bold", tone)}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function CampaignsCard({ row, input, limit, minFinished, fmt, canLink }: { row: Row; input: OrderProfitInput; limit: number | null; minFinished: number; fmt: (v: number) => string; canLink: boolean }) {
  const { t } = useT();
  const all = row.funnel;
  const rows = row.campaigns.map((c) => {
    const r = campaignRates(c, input, minFinished);
    return { c, r, perDelivered: adCostPerDelivered(c.adCostPerOrder, r) };
  });
  if (!row.adsLinked) {
    return (
      <Card className="min-w-0 border border-warning/30">
        <CardHeader title={<span className="flex items-center gap-2"><AlertTriangle className="size-4 text-warning" aria-hidden="true" />{t("No campaign is linked to {name}", { name: row.name })}</span>} description={t("Ads count for a product only through the campaigns (or ad accounts) you link to it. Link them, and this page adds them all up for you.")} />
        <div className="px-5 pb-5">
          <Button asChild variant="primary"><Link href="/campaigns">{canLink ? t("Link campaigns") : t("Open Campaigns")}</Link></Button>
        </div>
      </Card>
    );
  }
  return (
    <Card className="min-w-0">
      <CardHeader
        title={t("Ads for this product")}
        description={
          rows.length === 1
            ? t("1 linked campaign added together: {spent} spent for {orders} orders placed.", { spent: fmt(all.spend), orders: count(all.placed) })
            : t("{n} linked campaigns added together: {spent} spent for {orders} orders placed.", { n: rows.length, spent: fmt(all.spend), orders: count(all.placed) })
        }
      />
      <div className="flex flex-col gap-5 px-5 pb-5">
        {input.adCostPerOrder !== null ? <AdChain adCostPerOrder={input.adCostPerOrder} input={input} fmt={fmt} /> : <p className="text-sm text-muted">{t("No orders placed in these days yet, so there is no cost per order.")}</p>}

        {rows.length > 0 ? (
          <>
            <div className="hidden md:block">
              <Table>
                <THead>
                  <tr>
                    <Th>{t("Campaign")}</Th>
                    <Th className="text-end">{t("Spent")}</Th>
                    <Th className="text-end">{t("Orders")}</Th>
                    <Th className="text-end"><Term label={t("Per order")} definition={t("Ad spend ÷ orders placed from the campaign's ads.")} /></Th>
                    <Th className="text-end">{t("Confirmed")}</Th>
                    <Th className="text-end"><Term label={t("Delivered")} definition={t("Delivered parcels of those that finished. Parcels still on the road don't count yet.")} /></Th>
                    <Th className="text-end"><Term label={t("Per delivered order")} definition={t("Cost per order ÷ confirmation rate ÷ delivery rate.")} /></Th>
                  </tr>
                </THead>
                <tbody>
                  {rows.map(({ c, r, perDelivered }) => (
                    <Tr key={c.id}>
                      <Td className="max-w-[16rem] whitespace-normal">
                        <span className="font-semibold">{c.name}</span>
                        <span className="mt-0.5 flex flex-wrap gap-1">
                          {c.running ? <Badge tone="positive">{t("Running")}</Badge> : null}
                          {c.source === "ACCOUNT" ? <Badge tone="neutral">{t("Through its ad account")}</Badge> : null}
                          {!r.own ? <Badge tone="neutral">{t("Product's rates")}</Badge> : null}
                        </span>
                      </Td>
                      <Td className="num text-end">{fmt(c.spend)}</Td>
                      <Td className="num text-end">{count(c.placed)}</Td>
                      <Td className="num text-end">{c.adCostPerOrder === null ? "—" : fmt(c.adCostPerOrder)}</Td>
                      <Td className="num text-end">{pct(r.confirmationRate)}</Td>
                      <Td className="num text-end">{pct(r.deliveryRate)}</Td>
                      <Td className={cn("num text-end font-bold", perDelivered !== null && limit !== null && perDelivered > limit && "text-negative")}>{perDelivered === null ? "—" : fmt(perDelivered)}</Td>
                    </Tr>
                  ))}
                  <Tr className="bg-brand-soft/50">
                    <Td className="font-bold">{t("All linked campaigns")}</Td>
                    <Td className="num text-end font-bold">{fmt(all.spend)}</Td>
                    <Td className="num text-end font-bold">{count(all.placed)}</Td>
                    <Td className="num text-end font-bold">{input.adCostPerOrder === null ? "—" : fmt(input.adCostPerOrder)}</Td>
                    <Td className="num text-end font-bold">{pct(input.confirmationRate)}</Td>
                    <Td className="num text-end font-bold">{pct(input.deliveryRate)}</Td>
                    <Td className="num text-end font-extrabold text-brand-strong">{input.adCostPerOrder === null ? "—" : fmt(adCostPerDelivered(input.adCostPerOrder, input) ?? 0)}</Td>
                  </Tr>
                </tbody>
              </Table>
            </div>
            <ul className="flex flex-col gap-2.5 md:hidden">
              {rows.map(({ c, r, perDelivered }) => (
                <li key={c.id} className="rounded-2xl border border-border p-3.5">
                  <p className="text-sm font-semibold">{c.name}</p>
                  {c.running || c.source === "ACCOUNT" || !r.own ? (
                    <span className="mt-1 flex flex-wrap gap-1">
                      {c.running ? <Badge tone="positive">{t("Running")}</Badge> : null}
                      {c.source === "ACCOUNT" ? <Badge tone="neutral">{t("Through its ad account")}</Badge> : null}
                      {!r.own ? <Badge tone="neutral">{t("Product's rates")}</Badge> : null}
                    </span>
                  ) : null}
                  <CampaignNumbers
                    fmt={fmt}
                    spend={c.spend}
                    placed={c.placed}
                    perOrder={c.adCostPerOrder}
                    confirmed={r.confirmationRate}
                    delivered={r.deliveryRate}
                    perDelivered={perDelivered}
                    over={perDelivered !== null && limit !== null && perDelivered > limit}
                  />
                </li>
              ))}
              <li className="rounded-2xl bg-brand-soft/50 p-3.5">
                <p className="text-sm font-bold">{t("All linked campaigns")}</p>
                <CampaignNumbers
                  fmt={fmt}
                  spend={all.spend}
                  placed={all.placed}
                  perOrder={input.adCostPerOrder}
                  confirmed={input.confirmationRate}
                  delivered={input.deliveryRate}
                  perDelivered={input.adCostPerOrder === null ? null : adCostPerDelivered(input.adCostPerOrder, input)}
                  over={false}
                />
              </li>
            </ul>
            <div>
              <h3 className="mb-3 text-sm font-bold">{t("Ad cost per delivered order, by campaign")}</h3>
              <CampaignBars
                fmt={fmt}
                limit={limit}
                rows={rows.map(({ c, r, perDelivered }) => {
                  const vars = { spent: fmt(c.spend), orders: count(c.placed), perOrder: c.adCostPerOrder === null ? "—" : fmt(c.adCostPerOrder), conf: pct(r.confirmationRate), del: pct(r.deliveryRate) };
                  return {
                    id: c.id,
                    name: c.name,
                    value: perDelivered,
                    note: r.own
                      ? t("{spent} spent · {orders} orders · {perOrder} per order · {conf} confirmed · {del} delivered", vars)
                      : t("{spent} spent · {orders} orders · {perOrder} per order · {conf} confirmed · {del} delivered (the product's rates: few finished parcels)", vars),
                  };
                })}
              />
            </div>
          </>
        ) : null}
        {row.otherOrders.placed > 0 ? (
          <p className="text-xs text-subtle">{t("{n} of the product's orders came from no linked campaign's ad (or have no ad ID). They count in the total, not in a campaign.", { n: count(row.otherOrders.placed) })}</p>
        ) : null}
      </div>
    </Card>
  );
}

// ─────────────────────────── The page for one product ───────────────────────────

export function OrderProfitView({ row, data, canEdit, onEditDetails, days }: { row: Row; data: Tracker; canEdit: boolean; onEditDetails: () => void; days: { from?: string; to?: string } }) {
  const { t, tx } = useT();
  const money = useMoney();
  const cur = data.currency;
  const fmt = (v: number) => money.fmt(v, cur, { decimals: false });
  const unit = 10 ** currencyExponent(cur);
  const tick = (v: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v / unit);
  const base = React.useMemo(() => fromData(row, data), [row, data]);
  const [edits, setEdits] = React.useState<Edits>({});
  const [trying, setTrying] = useMoreDetails("profit-try");
  const { input, problem } = applyEdits(base.input, edits, cur);
  const r = orderProfit(input);
  const typed = Object.keys(edits).length > 0;

  const field = (k: MoneyField | RateField) => {
    if (edits[k] !== undefined) return edits[k]!;
    const v = base.input[k];
    if (k === "confirmationRate" || k === "deliveryRate") return String(Math.round((v as number) * 1000) / 10);
    return v === null ? "" : minorToInput(v as number, cur);
  };
  const set = (k: MoneyField | RateField) => (v: string) => setEdits((e) => ({ ...e, [k]: v }));
  const hint = (k: keyof OrderProfitInput) => t(SOURCE_TEXT[base.sources[k] ?? "default"]);
  const limit = r.ok ? r.profit + r.after.ads : null;
  const noAds = input.adCostPerOrder === null;

  return (
    <div className="flex min-w-0 flex-col gap-[18px]">
      <Card role="region" aria-labelledby="po-name" className="min-w-0 overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
          <div className="min-w-0">
            <h2 id="po-name" className="text-[20px] font-extrabold tracking-[-0.02em]">{row.name}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
              {row.fromMdm ? <Badge tone="brand">{t("From MDM")}</Badge> : null}
              {!row.cost ? <Badge tone="warning">{t("No price or cost in product details")}</Badge> : null}
              {typed ? <Badge tone="info">{t("Trying your own numbers")}</Badge> : null}
            </div>
          </div>
          {canEdit ? <Button variant="ghost" onClick={onEditDetails}><Pencil /> {row.cost ? t("Edit price and costs") : t("Add price and costs")}</Button> : null}
        </div>
        <div className="flex flex-col gap-5 p-5">
          <OfferControl row={row} canEdit={canEdit} fmt={fmt} price={input.price} />
          {problem ? <p className="rounded-2xl bg-warning-soft px-4 py-3 text-sm text-warning" role="alert">{t(problem)}</p> : null}
          {!r.ok ? (
            <p className="flex items-start gap-2 rounded-2xl bg-warning-soft px-4 py-3 text-sm text-warning" role="alert"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{t(r.reason)}</p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <Hero
                  label={noAds ? t("Profit per delivered order, ads not counted") : t("Profit per delivered order")}
                  def={t("What one delivered order really leaves you: its price minus the product, delivery, calls, the ads it took, and its share of the returned and lost parcels.")}
                  value={r.profit}
                  currency={cur}
                  sub={t("{margin} of the price · {n} orders placed for each one delivered", { margin: pct(r.margin), n: r.ordersPerDelivered.toFixed(1) })}
                />
                <div className="flex min-w-0 flex-col justify-between gap-2 rounded-[22px] bg-surface p-5 shadow-card ring-1 ring-border/60">
                  <span className="text-[15px] font-semibold"><Term label={t("Ads per delivered order")} definition={t("Ad spend per order placed ÷ confirmation rate ÷ delivery rate: what the ads cost for each order that is delivered.")} /></span>
                  <span className="num text-[30px] font-extrabold leading-none tracking-[-0.03em]">{noAds ? "—" : fmt(r.adCostPerDelivered ?? 0)}</span>
                  <span className="text-xs text-muted">{noAds ? t("Link this product's campaigns to count its ads.") : t("{ads} per order ÷ {conf} confirmed ÷ {del} delivered", { ads: fmt(input.adCostPerOrder ?? 0), conf: pct(input.confirmationRate), del: pct(input.deliveryRate) })}</span>
                </div>
                <div className="flex min-w-0 flex-col justify-between gap-2 rounded-[22px] bg-surface p-5 shadow-card ring-1 ring-border/60">
                  <span className="text-[15px] font-semibold"><Term label={t("Real profit in these days")} definition={t("The orders placed in the days picked: what their delivered parcels collected, minus ad spend, the product, every fee and this product's expenses. Parcels still on the road count once they finish.")} /></span>
                  <span className={cn("num text-[30px] font-extrabold leading-none tracking-[-0.03em]", row.actual.trueNetProfit < 0 ? "text-negative" : "text-positive")}>{fmt(row.actual.trueNetProfit)}</span>
                  <span className="text-xs text-muted">
                    {[
                      t("{n} delivered", { n: count(row.sample.delivered) }),
                      row.actual.overhead ? t("after {amount} of expenses", { amount: fmt(row.actual.overhead) }) : "",
                      row.sample.inTransit ? t("{n} still on the road ({amount})", { n: count(row.sample.inTransit), amount: fmt(row.actual.cashInTransit) }) : "",
                    ].filter(Boolean).join(" · ")}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
                <section className="min-w-0">
                  <h3 className="mb-3 text-sm font-bold">{t("One delivered order, step by step")}</h3>
                  <Bridge
                    label={t("From the price of one order to its real profit")}
                    currency={cur}
                    steps={[
                      { label: t("Price of one order"), amount: input.price, kind: "start", note: input.pieces > 1 ? t("{offer}: {n} pieces", { offer: offerLabel(input.pieces, t), n: input.pieces }) : offerLabel(input.pieces, t) },
                      { label: t("Product: {n} × {cost}", { n: input.pieces, cost: fmt(input.costPerPiece) }), amount: r.before.product, kind: "cost" },
                      { label: t("Delivery and packaging"), amount: r.before.delivery, kind: "cost" },
                      { label: t("Call center"), amount: r.before.callCenter, kind: "cost" },
                      ...(r.before.otherFees ? [{ label: t("Other MDM fees"), amount: r.before.otherFees, kind: "cost" as const }] : []),
                      { label: t("Profit before ads"), amount: r.beforeAds, kind: "end", note: t("If every order were confirmed and delivered") },
                      ...(noAds ? [] : [{ label: t("Ads"), amount: r.after.ads, kind: "cost" as const, note: t("{ads} per order ÷ {conf} ÷ {del}", { ads: fmt(input.adCostPerOrder ?? 0), conf: pct(input.confirmationRate), del: pct(input.deliveryRate) }) }]),
                      { label: t("Returned parcels"), amount: r.after.returns, kind: "cost", note: t("{n} come back for each delivered order", { n: (r.returnRate / input.deliveryRate).toFixed(2) }) },
                      ...(r.after.lost ? [{ label: t("Lost parcels"), amount: r.after.lost, kind: "cost" as const }] : []),
                      ...(r.after.extraCalls ? [{ label: t("Calls for orders that weren't delivered"), amount: r.after.extraCalls, kind: "cost" as const }] : []),
                      { label: noAds ? t("Real profit, ads not counted") : t("Real profit"), amount: r.profit, kind: "end", note: row.actual.overhead ? t("Before your expenses, which come off the real profit of these days") : undefined },
                    ]}
                  />
                </section>
                <section className="flex min-w-0 flex-col gap-4">
                  <h3 className="text-sm font-bold">{t("Where the price of a delivered order goes")}</h3>
                  <PriceSplit
                    label={t("Where the price of a delivered order goes")}
                    price={input.price}
                    profit={r.profit}
                    fmt={fmt}
                    parts={[
                      { key: "product", label: t("Product"), amount: r.before.product, color: PART_COLORS.product },
                      { key: "delivery", label: t("Delivery and fees"), amount: r.before.delivery + r.before.otherFees, color: PART_COLORS.delivery },
                      { key: "calls", label: t("Call center"), amount: r.before.callCenter + r.after.extraCalls, color: PART_COLORS.calls },
                      { key: "ads", label: t("Ads"), amount: r.after.ads, color: PART_COLORS.ads },
                      { key: "returns", label: t("Returns and lost"), amount: r.after.returns + r.after.lost, color: PART_COLORS.returns },
                    ]}
                  />
                  {limit !== null ? (
                    <p className={cn("rounded-2xl px-4 py-3 text-sm", r.profit < 0 ? "border border-negative/30 bg-negative-soft text-negative" : "bg-surface-2 text-muted")}>
                      {limit > 0 ? (
                        noAds ? (
                          tx("Ads can cost up to {placed} per order placed ({delivered} per delivered order) before this product loses money.", { placed: <b className="num text-fg">{fmt(r.breakevenAdCostPerOrder)}</b>, delivered: <b className="num text-fg">{fmt(limit)}</b> })
                        ) : (
                          tx("Ads can cost up to {placed} per order placed ({delivered} per delivered order) before this product loses money. Now: {now} per order.", { placed: <b className="num text-fg">{fmt(r.breakevenAdCostPerOrder)}</b>, delivered: <b className="num text-fg">{fmt(limit)}</b>, now: <b className="num text-fg">{fmt(input.adCostPerOrder ?? 0)}</b> })
                        )
                      ) : (
                        t("Even without ads, a delivered order doesn't cover its costs at these rates. Raise the price or the delivery rate.")
                      )}
                    </p>
                  ) : null}
                </section>
              </div>
            </>
          )}

          <div className="flex flex-col items-start gap-1.5">
            <div className="flex flex-wrap gap-2">
              <MoreDetailsButton open={trying} onToggle={setTrying} labels={[t("Try other numbers"), t("Hide the numbers")]} controls="pt-try" />
              {typed ? <Button variant="ghost" onClick={() => setEdits({})}><RotateCcw /> {t("Back to my data")}</Button> : null}
            </div>
            {!trying ? <p className="text-xs text-subtle">{t("Every number above comes from your product details, your orders and the campaigns linked to this product. Change any of them to see what would happen; nothing is saved.")}</p> : null}
          </div>
          {trying ? (
            <div id="pt-try" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <Field label={t("Price of one order")} htmlFor="try-price" hint={hint("price")}><MoneyInput id="try-price" currency={cur} value={field("price")} onChange={set("price")} /></Field>
              <Field label={t("Cost of one piece")} htmlFor="try-cost" hint={hint("costPerPiece")}><MoneyInput id="try-cost" currency={cur} value={field("costPerPiece")} onChange={set("costPerPiece")} /></Field>
              <Field label={t("Ads per order placed")} htmlFor="try-ads" hint={hint("adCostPerOrder")}><MoneyInput id="try-ads" currency={cur} value={field("adCostPerOrder")} onChange={set("adCostPerOrder")} /></Field>
              <Field label={t("Confirmation rate")} htmlFor="try-conf" hint={`${hint("confirmationRate")}${row.sample.placed ? ` · ${t("{a} of {b} orders", { a: count(row.sample.confirmed), b: count(row.sample.placed) })}` : ""}`}>
                <div className="relative"><Input id="try-conf" inputMode="decimal" className="num pe-8" value={field("confirmationRate")} onChange={(e) => set("confirmationRate")(e.target.value)} /><span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-[11px] text-subtle">%</span></div>
              </Field>
              <Field label={t("Delivery rate")} htmlFor="try-del" hint={`${hint("deliveryRate")}${row.sample.finished ? ` · ${t("{a} of {b} finished parcels", { a: count(row.sample.delivered), b: count(row.sample.finished) })}` : ""}`}>
                <div className="relative"><Input id="try-del" inputMode="decimal" className="num pe-8" value={field("deliveryRate")} onChange={(e) => set("deliveryRate")(e.target.value)} /><span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-[11px] text-subtle">%</span></div>
              </Field>
              <Field label={t("Delivery fee per parcel")} htmlFor="try-ship" hint={hint("deliveryFee")}><MoneyInput id="try-ship" currency={cur} value={field("deliveryFee")} onChange={set("deliveryFee")} /></Field>
              <Field label={t("Return fee per parcel")} htmlFor="try-rto" hint={hint("returnFee")}><MoneyInput id="try-rto" currency={cur} value={field("returnFee")} onChange={set("returnFee")} /></Field>
              <Field label={t("Call center per order")} htmlFor="try-call" hint={hint("callCenterFee")}><MoneyInput id="try-call" currency={cur} value={field("callCenterFee")} onChange={set("callCenterFee")} /></Field>
              <Field label={t("Packaging per parcel")} htmlFor="try-pack" hint={hint("packagingFee")}><MoneyInput id="try-pack" currency={cur} value={field("packagingFee")} onChange={set("packagingFee")} /></Field>
            </div>
          ) : null}
        </div>
      </Card>

      <CampaignsCard row={row} input={input} limit={limit} minFinished={data.minFinished} fmt={fmt} canLink={canEdit} />

      <div className="grid grid-cols-1 gap-[18px] xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card className="min-w-0">
          <CardHeader
            title={t("Real profit by day")}
            description={row.actual.overhead ? t("The orders placed each day: what their delivered parcels collected, minus their costs and that day's ads. Your expenses come off the total below.") : t("The orders placed each day: what their delivered parcels collected, minus their costs and that day's ads.")}
          />
          <div className="flex flex-col gap-3 px-5 pb-5">
            <ProfitByDay days={row.days} from={days.from} to={days.to} fmt={fmt} tick={tick} />
            {row.actual.overhead && row.days.length ? (
              <p className="text-xs text-muted">
                {tx("All these days: {before} − {expenses} of expenses = {profit} real profit.", {
                  before: <span className="num font-semibold text-fg">{fmt(row.actual.trueNetProfit + row.actual.overhead)}</span>,
                  expenses: <span className="num font-semibold text-fg">{fmt(row.actual.overhead)}</span>,
                  profit: <span className={cn("num font-bold", row.actual.trueNetProfit < 0 ? "text-negative" : "text-positive")}>{fmt(row.actual.trueNetProfit)}</span>,
                })}
              </p>
            ) : null}
          </div>
        </Card>
        <Card className="min-w-0">
          <CardHeader title={t("From order to delivery")} description={t("This product's orders placed in these days.")} />
          <div className="flex flex-col gap-3 px-5 pb-5">
            <OrderFunnel
              steps={[
                { label: t("Placed"), value: row.sample.placed, rate: null },
                { label: t("Confirmed"), value: row.sample.confirmed, rate: row.funnel.confirmationRate },
                { label: t("Shipped"), value: row.sample.shipped, rate: row.funnel.shippingRate },
                { label: t("Delivered"), value: row.sample.delivered, rate: row.funnel.deliveryRate, rateLabel: t("of finished") },
              ]}
            />
            <p className="text-xs text-subtle">
              {row.sample.lost
                ? t("{returned} returned · {lost} lost · {road} still on the road.", { returned: count(row.sample.returned), lost: count(row.sample.lost), road: count(row.sample.inTransit) })
                : t("{returned} returned · {road} still on the road.", { returned: count(row.sample.returned), road: count(row.sample.inTransit) })}
              {row.sample.finished < data.minFinished ? ` ${t("Your own rates are used after {n} finished parcels; until then the calculation uses examples.", { n: data.minFinished })}` : ""}
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}

/** One line per product for the overview: its offer and what a delivered order really earns. */
export function productLine(row: Row, data: Tracker) {
  const { input } = fromData(row, data);
  const r = orderProfit(input);
  return { input, result: r };
}
