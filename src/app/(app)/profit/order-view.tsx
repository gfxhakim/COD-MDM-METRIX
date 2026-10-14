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
  you: "Saved by you in the stock calculator",
  orders: "From your orders",
  product: "From product details",
  mdm: "From MDM",
  default: "An example: not enough finished orders yet",
  campaigns: "From the campaigns linked to it",
  none: "No campaign is linked to this product yet",
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
      if (!Number.isFinite(v) || v < 0 || v > 100) problem ??= "Rates go from 0 to 100%.";
      else input[k] = roundRate(v / 100);
      continue;
    }
    try {
      const v = parseToMinor(raw || "0", currency);
      if (v < 0) throw new Error();
      input[k] = v;
    } catch {
      problem ??= "One of the amounts isn't a number.";
    }
  }
  return { input, problem };
}

// ─────────────────────────── The offer ───────────────────────────

function OfferControl({ row, canEdit, fmt, price }: { row: Row; canEdit: boolean; fmt: (v: number) => string; price: number }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const save = useMutation(
    trpc.products.update.mutationOptions({
      onSuccess: async (_r, vars) => {
        await Promise.all([qc.invalidateQueries({ queryKey: trpc.profit.pathKey() }), qc.invalidateQueries({ queryKey: trpc.products.pathKey() })]);
        toast("success", `${row.name}: ${offerLabel(vars.piecesPerOrder ?? 1)}`);
      },
      onError: (e) => toast("error", errorMessage(e)),
    }),
  );
  const pieces = Math.max(1, row.piecesPerOrder);
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-2xl bg-surface-2 p-3.5 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-muted">Your offer</p>
        <p className="text-sm">
          <b>{offerLabel(pieces)}</b>: each order sends <b className="num">{pieces}</b> piece{pieces === 1 ? "" : "s"}
          {price > 0 ? <> for <b className="num">{fmt(price)}</b></> : null}.
        </p>
        <p className="text-[11px] text-subtle">Counts for every order of this product. When an order lists more pieces, its own number counts.</p>
      </div>
      {canEdit ? (
        <OfferPicker key={pieces} id={`offer-${row.id}`} label="Offer" value={pieces} disabled={save.isPending} onChange={(n) => n !== pieces && save.mutate({ id: row.id, piecesPerOrder: n })} className="sm:w-80" />
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
      <ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden="true" />
      {text}
    </span>
  );
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label={`Ads cost ${fmt(adCostPerOrder)} per order placed, ${fmt(perConfirmed)} per confirmed order and ${fmt(perDelivered)} per delivered order`}>
      {box(adCostPerOrder, "per order placed")}
      {step(`÷ ${pct(input.confirmationRate)} confirmed`)}
      {box(perConfirmed, "per confirmed order")}
      {step(`${shipped ? `÷ ${pct(input.shippingRate)} shipped ` : ""}÷ ${pct(input.deliveryRate)} delivered`)}
      {box(perDelivered, "per delivered order", true)}
    </div>
  );
}

/** A campaign's numbers as a small grid, for phones. */
function CampaignNumbers({ fmt, spend, placed, perOrder, confirmed, delivered, perDelivered, over }: { fmt: (v: number) => string; spend: number; placed: number; perOrder: number | null; confirmed: number | null; delivered: number | null; perDelivered: number | null; over: boolean }) {
  const cells: [string, string, string?][] = [
    ["Spent", fmt(spend)],
    ["Orders", count(placed)],
    ["Per order", perOrder === null ? "—" : fmt(perOrder)],
    ["Confirmed", pct(confirmed)],
    ["Delivered", pct(delivered)],
    ["Per delivered order", perDelivered === null ? "—" : fmt(perDelivered), over ? "text-negative" : "text-brand-strong"],
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
  const all = row.funnel;
  const rows = row.campaigns.map((c) => {
    const r = campaignRates(c, input, minFinished);
    return { c, r, perDelivered: adCostPerDelivered(c.adCostPerOrder, r) };
  });
  if (!row.adsLinked) {
    return (
      <Card className="min-w-0 border border-warning/30">
        <CardHeader title={<span className="flex items-center gap-2"><AlertTriangle className="size-4 text-warning" aria-hidden="true" />No campaign is linked to {row.name}</span>} description="Ads count for a product only through the campaigns (or ad accounts) you link to it. Link them, and this page adds them all up for you." />
        <div className="px-5 pb-5">
          <Button asChild variant="primary"><Link href="/campaigns">{canLink ? "Link campaigns" : "Open Campaigns"}</Link></Button>
        </div>
      </Card>
    );
  }
  return (
    <Card className="min-w-0">
      <CardHeader
        title="Ads for this product"
        description={`${rows.length} linked campaign${rows.length === 1 ? "" : "s"} added together: ${fmt(all.spend)} spent for ${count(all.placed)} orders placed.`}
      />
      <div className="flex flex-col gap-5 px-5 pb-5">
        {input.adCostPerOrder !== null ? <AdChain adCostPerOrder={input.adCostPerOrder} input={input} fmt={fmt} /> : <p className="text-sm text-muted">No orders placed in these days yet, so there is no cost per order.</p>}

        {rows.length > 0 ? (
          <>
            <div className="hidden md:block">
              <Table>
                <THead>
                  <tr>
                    <Th>Campaign</Th>
                    <Th className="text-end">Spent</Th>
                    <Th className="text-end">Orders</Th>
                    <Th className="text-end"><Term label="Per order" definition="Ad spend ÷ orders placed from the campaign's ads." /></Th>
                    <Th className="text-end">Confirmed</Th>
                    <Th className="text-end"><Term label="Delivered" definition="Delivered parcels of those that finished. Parcels still on the road don't count yet." /></Th>
                    <Th className="text-end"><Term label="Per delivered order" definition="Cost per order ÷ confirmation rate ÷ delivery rate." /></Th>
                  </tr>
                </THead>
                <tbody>
                  {rows.map(({ c, r, perDelivered }) => (
                    <Tr key={c.id}>
                      <Td className="max-w-[16rem] whitespace-normal">
                        <span className="font-semibold">{c.name}</span>
                        <span className="mt-0.5 flex flex-wrap gap-1">
                          {c.running ? <Badge tone="positive">Running</Badge> : null}
                          {c.source === "ACCOUNT" ? <Badge tone="neutral">Through its ad account</Badge> : null}
                          {!r.own ? <Badge tone="neutral">Product&apos;s rates</Badge> : null}
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
                    <Td className="font-bold">All linked campaigns</Td>
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
                      {c.running ? <Badge tone="positive">Running</Badge> : null}
                      {c.source === "ACCOUNT" ? <Badge tone="neutral">Through its ad account</Badge> : null}
                      {!r.own ? <Badge tone="neutral">Product&apos;s rates</Badge> : null}
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
                <p className="text-sm font-bold">All linked campaigns</p>
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
              <h3 className="mb-3 text-sm font-bold">Ad cost per delivered order, by campaign</h3>
              <CampaignBars
                fmt={fmt}
                limit={limit}
                rows={rows.map(({ c, r, perDelivered }) => ({
                  id: c.id,
                  name: c.name,
                  value: perDelivered,
                  note: `${fmt(c.spend)} spent · ${count(c.placed)} orders · ${c.adCostPerOrder === null ? "—" : fmt(c.adCostPerOrder)} per order · ${pct(r.confirmationRate)} confirmed · ${pct(r.deliveryRate)} delivered${r.own ? "" : " (the product's rates: few finished parcels)"}`,
                }))}
              />
            </div>
          </>
        ) : null}
        {row.otherOrders.placed > 0 ? (
          <p className="text-xs text-subtle">{count(row.otherOrders.placed)} of the product&apos;s orders came from no linked campaign&apos;s ad (or have no ad ID). They count in the total, not in a campaign.</p>
        ) : null}
      </div>
    </Card>
  );
}

// ─────────────────────────── The page for one product ───────────────────────────

export function OrderProfitView({ row, data, canEdit, onEditDetails, days }: { row: Row; data: Tracker; canEdit: boolean; onEditDetails: () => void; days: { from?: string; to?: string } }) {
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
  const hint = (k: keyof OrderProfitInput) => SOURCE_TEXT[base.sources[k] ?? "default"];
  const limit = r.ok ? r.profit + r.after.ads : null;
  const noAds = input.adCostPerOrder === null;

  return (
    <div className="flex min-w-0 flex-col gap-[18px]">
      <Card role="region" aria-labelledby="po-name" className="min-w-0 overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
          <div className="min-w-0">
            <h2 id="po-name" className="text-[20px] font-extrabold tracking-[-0.02em]">{row.name}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
              {row.fromMdm ? <Badge tone="brand">From MDM</Badge> : null}
              {!row.cost ? <Badge tone="warning">No price or cost in product details</Badge> : null}
              {typed ? <Badge tone="info">Trying your own numbers</Badge> : null}
            </div>
          </div>
          {canEdit ? <Button variant="ghost" onClick={onEditDetails}><Pencil /> {row.cost ? "Edit price and costs" : "Add price and costs"}</Button> : null}
        </div>
        <div className="flex flex-col gap-5 p-5">
          <OfferControl row={row} canEdit={canEdit} fmt={fmt} price={input.price} />
          {problem ? <p className="rounded-2xl bg-warning-soft px-4 py-3 text-sm text-warning" role="alert">{problem}</p> : null}
          {!r.ok ? (
            <p className="flex items-start gap-2 rounded-2xl bg-warning-soft px-4 py-3 text-sm text-warning" role="alert"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{r.reason}</p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <Hero
                  label={noAds ? "Profit per delivered order, ads not counted" : "Profit per delivered order"}
                  def="What one delivered order really leaves you: its price minus the product, delivery, calls, the ads it took, and its share of the returned and lost parcels."
                  value={r.profit}
                  currency={cur}
                  sub={`${pct(r.margin)} of the price · ${r.ordersPerDelivered.toFixed(1)} orders placed for each one delivered`}
                />
                <div className="flex min-w-0 flex-col justify-between gap-2 rounded-[22px] bg-surface p-5 shadow-card ring-1 ring-border/60">
                  <span className="text-[15px] font-semibold"><Term label="Ads per delivered order" definition="Ad spend per order placed ÷ confirmation rate ÷ delivery rate: what the ads cost for each order that is delivered." /></span>
                  <span className="num text-[30px] font-extrabold leading-none tracking-[-0.03em]">{noAds ? "—" : fmt(r.adCostPerDelivered ?? 0)}</span>
                  <span className="text-xs text-muted">{noAds ? "Link this product's campaigns to count its ads." : `${fmt(input.adCostPerOrder ?? 0)} per order ÷ ${pct(input.confirmationRate)} confirmed ÷ ${pct(input.deliveryRate)} delivered`}</span>
                </div>
                <div className="flex min-w-0 flex-col justify-between gap-2 rounded-[22px] bg-surface p-5 shadow-card ring-1 ring-border/60">
                  <span className="text-[15px] font-semibold"><Term label="Real profit in these days" definition="The orders placed in the days picked: what their delivered parcels collected, minus ad spend, the product, every fee and this product's expenses. Parcels still on the road count once they finish." /></span>
                  <span className={cn("num text-[30px] font-extrabold leading-none tracking-[-0.03em]", row.actual.trueNetProfit < 0 ? "text-negative" : "text-positive")}>{fmt(row.actual.trueNetProfit)}</span>
                  <span className="text-xs text-muted">
                    {count(row.sample.delivered)} delivered{row.actual.overhead ? ` · after ${fmt(row.actual.overhead)} of expenses` : ""}{row.sample.inTransit ? ` · ${count(row.sample.inTransit)} still on the road (${fmt(row.actual.cashInTransit)})` : ""}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
                <section className="min-w-0">
                  <h3 className="mb-3 text-sm font-bold">One delivered order, step by step</h3>
                  <Bridge
                    label="From the price of one order to its real profit"
                    currency={cur}
                    steps={[
                      { label: "Price of one order", amount: input.price, kind: "start", note: `${offerLabel(input.pieces)}${input.pieces > 1 ? `: ${input.pieces} pieces` : ""}` },
                      { label: `Product: ${input.pieces} × ${fmt(input.costPerPiece)}`, amount: r.before.product, kind: "cost" },
                      { label: "Delivery and packaging", amount: r.before.delivery, kind: "cost" },
                      { label: "Call center", amount: r.before.callCenter, kind: "cost" },
                      ...(r.before.otherFees ? [{ label: "Other MDM fees", amount: r.before.otherFees, kind: "cost" as const }] : []),
                      { label: "Profit before ads", amount: r.beforeAds, kind: "end", note: "If every order were confirmed and delivered" },
                      ...(noAds ? [] : [{ label: "Ads", amount: r.after.ads, kind: "cost" as const, note: `${fmt(input.adCostPerOrder ?? 0)} per order ÷ ${pct(input.confirmationRate)} ÷ ${pct(input.deliveryRate)}` }]),
                      { label: "Returned parcels", amount: r.after.returns, kind: "cost", note: `${(r.returnRate / input.deliveryRate).toFixed(2)} come back for each delivered order` },
                      ...(r.after.lost ? [{ label: "Lost parcels", amount: r.after.lost, kind: "cost" as const }] : []),
                      ...(r.after.extraCalls ? [{ label: "Calls for orders that weren't delivered", amount: r.after.extraCalls, kind: "cost" as const }] : []),
                      { label: noAds ? "Real profit, ads not counted" : "Real profit", amount: r.profit, kind: "end", note: row.actual.overhead ? "Before your expenses, which come off the real profit of these days" : undefined },
                    ]}
                  />
                </section>
                <section className="flex min-w-0 flex-col gap-4">
                  <h3 className="text-sm font-bold">Where the price of a delivered order goes</h3>
                  <PriceSplit
                    label="Where the price of a delivered order goes"
                    price={input.price}
                    profit={r.profit}
                    fmt={fmt}
                    parts={[
                      { key: "product", label: "Product", amount: r.before.product, color: PART_COLORS.product },
                      { key: "delivery", label: "Delivery and fees", amount: r.before.delivery + r.before.otherFees, color: PART_COLORS.delivery },
                      { key: "calls", label: "Call center", amount: r.before.callCenter + r.after.extraCalls, color: PART_COLORS.calls },
                      { key: "ads", label: "Ads", amount: r.after.ads, color: PART_COLORS.ads },
                      { key: "returns", label: "Returns and lost", amount: r.after.returns + r.after.lost, color: PART_COLORS.returns },
                    ]}
                  />
                  {limit !== null ? (
                    <p className={cn("rounded-2xl px-4 py-3 text-sm", r.profit < 0 ? "border border-negative/30 bg-negative-soft text-negative" : "bg-surface-2 text-muted")}>
                      {limit > 0 ? (
                        <>Ads can cost up to <b className="num text-fg">{fmt(r.breakevenAdCostPerOrder)}</b> per order placed (<b className="num text-fg">{fmt(limit)}</b> per delivered order) before this product loses money{noAds ? "." : <>. Now: <b className="num text-fg">{fmt(input.adCostPerOrder ?? 0)}</b> per order.</>}</>
                      ) : (
                        <>Even without ads, a delivered order doesn&apos;t cover its costs at these rates. Raise the price or the delivery rate.</>
                      )}
                    </p>
                  ) : null}
                </section>
              </div>
            </>
          )}

          <div className="flex flex-col items-start gap-1.5">
            <div className="flex flex-wrap gap-2">
              <MoreDetailsButton open={trying} onToggle={setTrying} labels={["Try other numbers", "Hide the numbers"]} controls="pt-try" />
              {typed ? <Button variant="ghost" onClick={() => setEdits({})}><RotateCcw /> Back to my data</Button> : null}
            </div>
            {!trying ? <p className="text-xs text-subtle">Every number above comes from your product details, your orders and the campaigns linked to this product. Change any of them to see what would happen; nothing is saved.</p> : null}
          </div>
          {trying ? (
            <div id="pt-try" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <Field label="Price of one order" htmlFor="try-price" hint={hint("price")}><MoneyInput id="try-price" currency={cur} value={field("price")} onChange={set("price")} /></Field>
              <Field label="Cost of one piece" htmlFor="try-cost" hint={hint("costPerPiece")}><MoneyInput id="try-cost" currency={cur} value={field("costPerPiece")} onChange={set("costPerPiece")} /></Field>
              <Field label="Ads per order placed" htmlFor="try-ads" hint={hint("adCostPerOrder")}><MoneyInput id="try-ads" currency={cur} value={field("adCostPerOrder")} onChange={set("adCostPerOrder")} /></Field>
              <Field label="Confirmation rate" htmlFor="try-conf" hint={`${hint("confirmationRate")}${row.sample.placed ? ` · ${count(row.sample.confirmed)} of ${count(row.sample.placed)} orders` : ""}`}>
                <div className="relative"><Input id="try-conf" inputMode="decimal" className="num pe-8" value={field("confirmationRate")} onChange={(e) => set("confirmationRate")(e.target.value)} /><span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-[11px] text-subtle">%</span></div>
              </Field>
              <Field label="Delivery rate" htmlFor="try-del" hint={`${hint("deliveryRate")}${row.sample.finished ? ` · ${count(row.sample.delivered)} of ${count(row.sample.finished)} finished parcels` : ""}`}>
                <div className="relative"><Input id="try-del" inputMode="decimal" className="num pe-8" value={field("deliveryRate")} onChange={(e) => set("deliveryRate")(e.target.value)} /><span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-[11px] text-subtle">%</span></div>
              </Field>
              <Field label="Delivery fee per parcel" htmlFor="try-ship" hint={hint("deliveryFee")}><MoneyInput id="try-ship" currency={cur} value={field("deliveryFee")} onChange={set("deliveryFee")} /></Field>
              <Field label="Return fee per parcel" htmlFor="try-rto" hint={hint("returnFee")}><MoneyInput id="try-rto" currency={cur} value={field("returnFee")} onChange={set("returnFee")} /></Field>
              <Field label="Call center per order" htmlFor="try-call" hint={hint("callCenterFee")}><MoneyInput id="try-call" currency={cur} value={field("callCenterFee")} onChange={set("callCenterFee")} /></Field>
              <Field label="Packaging per parcel" htmlFor="try-pack" hint={hint("packagingFee")}><MoneyInput id="try-pack" currency={cur} value={field("packagingFee")} onChange={set("packagingFee")} /></Field>
            </div>
          ) : null}
        </div>
      </Card>

      <CampaignsCard row={row} input={input} limit={limit} minFinished={data.minFinished} fmt={fmt} canLink={canEdit} />

      <div className="grid grid-cols-1 gap-[18px] xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card className="min-w-0">
          <CardHeader title="Real profit by day" description={`The orders placed each day: what their delivered parcels collected, minus their costs and that day's ads.${row.actual.overhead ? " Your expenses come off the total below." : ""}`} />
          <div className="flex flex-col gap-3 px-5 pb-5">
            <ProfitByDay days={row.days} from={days.from} to={days.to} fmt={fmt} tick={tick} />
            {row.actual.overhead && row.days.length ? (
              <p className="text-xs text-muted">
                All these days: <span className="num font-semibold text-fg">{fmt(row.actual.trueNetProfit + row.actual.overhead)}</span> − <span className="num font-semibold text-fg">{fmt(row.actual.overhead)}</span> of expenses = <span className={cn("num font-bold", row.actual.trueNetProfit < 0 ? "text-negative" : "text-positive")}>{fmt(row.actual.trueNetProfit)}</span> real profit.
              </p>
            ) : null}
          </div>
        </Card>
        <Card className="min-w-0">
          <CardHeader title="From order to delivery" description="This product's orders placed in these days." />
          <div className="flex flex-col gap-3 px-5 pb-5">
            <OrderFunnel
              steps={[
                { label: "Placed", value: row.sample.placed, rate: null },
                { label: "Confirmed", value: row.sample.confirmed, rate: row.funnel.confirmationRate },
                { label: "Shipped", value: row.sample.shipped, rate: row.funnel.shippingRate },
                { label: "Delivered", value: row.sample.delivered, rate: row.funnel.deliveryRate, rateLabel: "of finished" },
              ]}
            />
            <p className="text-xs text-subtle">
              {count(row.sample.returned)} returned{row.sample.lost ? ` · ${count(row.sample.lost)} lost` : ""} · {count(row.sample.inTransit)} still on the road.
              {row.sample.finished < data.minFinished ? ` Your own rates are used after ${data.minFinished} finished parcels; until then the calculation uses examples.` : ""}
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
