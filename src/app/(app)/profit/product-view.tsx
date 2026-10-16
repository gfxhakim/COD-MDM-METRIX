"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowUpRight, CheckCircle2, Pencil, TriangleAlert } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { FitMoney } from "@/components/app/fit-money";
import { useMoney } from "@/components/app/currency";
import { MoreDetails } from "@/components/app/more-details";
import { OfferPicker } from "@/components/app/offer-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { HelpTip, Term } from "@/components/ui/tooltip";
import { offerLabel } from "@/domain/offers";
import { adCostPerDelivered, orderProfit, type OrderProfitInput } from "@/domain/orderProfit";
import { useT } from "@/i18n/client";
import { currencyExponent } from "@/lib/money";
import { errorMessage, useTRPC } from "@/lib/trpc/client";
import { cn, formatPercent } from "@/lib/utils";
import { CampaignBars, OrderFlow, ProfitByDay, Waterfall, type WaterStep } from "./charts";
import { count, orderInput, ordersHref, RATE_SOURCE_TEXT, SOURCE_TEXT, useAdMoney, type Days, type Row, type Tracker } from "./shared";
import { WhatIf } from "./what-if";

const pct = (v: number | null) => formatPercent(v, 0);

// ─────────────────────────── The offer ───────────────────────────

function OfferControl({ row, canEdit }: { row: Row; canEdit: boolean }) {
  const { t } = useT();
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
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs font-semibold text-muted"><Term label={t("Your offer")} definition={t("How many pieces one order sends. The order price stays the same; the product cost is cost per piece × pieces, free pieces included.")} /></span>
      {canEdit ? (
        <OfferPicker key={pieces} id={`offer-${row.id}`} label={t("Offer")} value={pieces} disabled={save.isPending} onChange={(n) => n !== pieces && save.mutate({ id: row.id, piecesPerOrder: n })} className="w-full sm:w-80" />
      ) : (
        <span className="text-sm font-semibold">{offerLabel(pieces, t)}</span>
      )}
    </div>
  );
}

// ─────────────────────────── The result of these days ───────────────────────────

/** A number tile: its label with an ⓘ, the number, and a line under it. */
function Kpi({ label, def, value, sub, tone, children }: { label: string; def: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "good" | "bad"; children?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-[18px] bg-surface-2 p-3 ring-1 ring-border/50 sm:p-3.5">
      <span className="text-[11.5px] font-semibold leading-snug text-muted sm:text-[12px]"><Term label={label} definition={def} /></span>
      <span className={cn("num min-w-0 truncate text-[19px] sm:text-[22px] font-extrabold leading-tight tracking-[-0.02em]", tone === "good" && "text-positive", tone === "bad" && "text-negative")}>{value}</span>
      {children}
      {sub ? <span className="text-[11px] leading-snug text-subtle">{sub}</span> : null}
    </div>
  );
}

/** How much of the most Meta can cost per order the ads use now. */
function AdMeter({ now, max, fmtAd }: { now: number | null; max: number; fmtAd: (v: number) => string }) {
  const { t } = useT();
  if (max <= 0) return <p className="flex items-center gap-1 text-[11px] font-semibold text-negative"><TriangleAlert className="size-3.5" aria-hidden="true" />{t("Loses money even without ads")}</p>;
  if (now === null) return <p className="text-[11px] text-subtle">{t("Can cost up to {max} per order", { max: fmtAd(max) })}</p>;
  const share = now / max;
  const state = share > 1 ? "over" : share > 0.8 ? "close" : "safe";
  const color = state === "over" ? "#e2462f" : state === "close" ? "#d08700" : "#0d7a3e";
  return (
    <div className="flex flex-col gap-1">
      <span className="relative h-2 w-full overflow-hidden rounded-full" style={{ background: `color-mix(in srgb, ${color} 16%, white)` }} aria-hidden="true">
        <span className="absolute inset-y-0 start-0 rounded-full" style={{ width: `${Math.min(100, share * 100)}%`, background: color }} />
      </span>
      <span className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: state === "safe" ? "var(--color-positive)" : state === "close" ? "var(--color-warning)" : "var(--color-negative)" }}>
        {state === "safe" ? <CheckCircle2 className="size-3.5 shrink-0" aria-hidden="true" /> : <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />}
        {state === "over" ? t("Over the most you can pay: {max}", { max: fmtAd(max) }) : state === "close" ? t("Close to the most you can pay: {max}", { max: fmtAd(max) }) : t("Safe: you can pay up to {max}", { max: fmtAd(max) })}
      </span>
    </div>
  );
}

function Summary({ row, data, days, input }: { row: Row; data: Tracker; days: Days; input: OrderProfitInput }) {
  const { t, tx } = useT();
  const money = useMoney();
  const cur = data.currency;
  const fmt = (v: number) => money.fmt(v, cur, { decimals: false });
  const ad = useAdMoney(cur);
  const r = orderProfit(input);
  const real = row.actual.trueNetProfit;
  const total = real + row.expected.total;
  const open = row.open.road + row.open.preparing + row.open.waiting;
  const noAds = input.adCostPerOrder === null;
  const link = (n: number, href: string) => <Link href={href} className="num font-bold text-white underline decoration-white/40 underline-offset-4 hover:decoration-white">{count(n)}</Link>;
  return (
    <Card className="min-w-0 overflow-hidden">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
        <section aria-labelledby="pt-total" className="relative flex min-w-0 flex-col gap-4 overflow-hidden bg-brand-hero p-5 text-white shine sm:p-6">
          <span className="pointer-events-none absolute -end-14 -top-20 size-52 rounded-full border-[22px] border-white/10" aria-hidden="true" />
          <span id="pt-total" className="relative text-[15px] font-semibold">
            <Term label={t("Profit of these days")} definition={t("The orders placed in these days: their real profit (what delivered parcels collected, minus Meta, the product, MDM's fees and your expenses) plus what their orders not finished yet should still bring at your rates.")} iconClassName="text-white/70 hover:text-white" />
          </span>
          <div className="relative min-w-0">
            <FitMoney value={Math.round(total / 10 ** currencyExponent(cur)) * 10 ** currencyExponent(cur)} currency={cur} max={52} min={26} signed codeClassName="text-white/85" className="[text-shadow:0_2px_16px_rgb(255_170_178/0.55)]" />
          </div>
          <dl className="relative grid grid-cols-2 gap-3 rounded-2xl bg-white/12 p-3 ring-1 ring-white/20 backdrop-blur-[2px]">
            <div className="min-w-0">
              <dt className="text-[11px] text-white/80"><Term label={t("Real so far")} definition={t("Money already settled: what the delivered parcels of these orders collected, minus every cost and the ads of these days.")} iconClassName="text-white/70 hover:text-white" /></dt>
              <dd className="num truncate text-[17px] font-extrabold">{fmt(real)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[11px] text-white/80"><Term label={t("Still expected")} definition={t("What the orders not finished yet should bring: on the road × delivery rate, being prepared × shipping rate, waiting for the call × confirmation rate, each minus its product and fees.")} iconClassName="text-white/70 hover:text-white" /></dt>
              <dd className="num truncate text-[17px] font-extrabold">{row.expected.total >= 0 ? "+" : ""}{fmt(row.expected.total)}</dd>
            </div>
          </dl>
          <ul className="relative flex flex-col gap-1 text-[12.5px] leading-snug text-white/90">
            <li>{tx("{n} orders delivered, {returned} returned.", { n: link(row.sample.delivered, ordersHref(row.id, days, { parcelStatus: "DELIVERED" })), returned: link(row.sample.returned, ordersHref(row.id, days, { parcelStatus: "RETURNED" })) })}</li>
            {open > 0 ? (
              <li>
                {tx("{n} not finished yet: {road} on the road, {preparing} being prepared, {waiting} waiting for the call.", {
                  n: <b className="num">{count(open)}</b>,
                  road: link(row.open.road, ordersHref(row.id, days, { parcelStatus: "SHIPPED" })),
                  preparing: <b className="num">{count(row.open.preparing)}</b>,
                  waiting: link(row.open.waiting, ordersHref(row.id, days, { status: "PENDING" })),
                })}
              </li>
            ) : null}
            {row.actual.overhead ? <li>{t("After {amount} of your expenses.", { amount: fmt(row.actual.overhead) })}</li> : null}
          </ul>
        </section>
        <div className="grid min-w-0 grid-cols-2 gap-2.5 p-3.5 sm:gap-3 sm:p-5">
          <Kpi
            label={t("Meta per order")}
            def={t("What Meta cost for each order placed: the ad spend of the campaigns linked to this product ÷ its orders placed. The bar shows how close it is to the most an order can cost before you lose money.")}
            value={noAds ? "—" : ad.fmtAd(input.adCostPerOrder ?? 0)}
            sub={noAds ? t("Link this product's campaigns to count its ads.") : ad.usd ? t("{amount} · {spend} for {n} orders", { amount: fmt(input.adCostPerOrder ?? 0), spend: ad.fmtAd(row.actual.adSpend), n: count(row.sample.placed) }) : t("{spend} for {n} orders", { spend: ad.fmtAd(row.actual.adSpend), n: count(row.sample.placed) })}
          >
            {r.ok ? <AdMeter now={input.adCostPerOrder} max={r.breakevenAdCostPerOrder} fmtAd={ad.fmtAd} /> : null}
          </Kpi>
          <Kpi
            label={noAds ? t("Per delivered order, ads not counted") : t("Per delivered order")}
            def={t("What one delivered order really leaves you: its price − the product, delivery, calls, the ads it took and its share of returned and lost parcels. Before your expenses.")}
            value={r.ok ? fmt(r.profit) : "—"}
            tone={r.ok ? (r.profit < 0 ? "bad" : "good") : undefined}
            sub={r.ok ? t("{margin} of the price · {n} orders placed for each one delivered", { margin: pct(r.margin), n: r.ordersPerDelivered.toFixed(1) }) : t(r.reason)}
          />
          <Kpi
            label={t("Confirmation rate")}
            def={t("The % of orders the call center confirms. Worked out as: confirmed ÷ orders whose call is answered; orders still waiting for the call are left out until then.")}
            value={pct(row.rates.confirmation)}
            sub={row.rates.source === "days" ? t("{a} of {b} orders · {w} still waiting", { a: count(row.sample.confirmed), b: count(row.sample.placed), w: count(row.open.waiting) }) : t(RATE_SOURCE_TEXT[row.rates.source])}
          />
          <Kpi
            label={t("Delivery rate")}
            def={t("The % of finished parcels the customer received and paid. Worked out as: delivered ÷ finished (delivered + returned + lost); parcels on the road count once they finish.")}
            value={pct(row.rates.delivery)}
            sub={row.rates.source === "days" ? t("{a} of {b} finished parcels", { a: count(row.sample.delivered), b: count(row.sample.finished) }) : t(RATE_SOURCE_TEXT[row.rates.source])}
          />
        </div>
      </div>
    </Card>
  );
}

// ─────────────────────────── One delivered order ───────────────────────────

function OneOrder({ row, data, input }: { row: Row; data: Tracker; input: OrderProfitInput }) {
  const { t, tx } = useT();
  const money = useMoney();
  const cur = data.currency;
  const fmt = (v: number) => money.fmt(v, cur, { decimals: false });
  const ad = useAdMoney(cur);
  const r = orderProfit(input);
  const noAds = input.adCostPerOrder === null;
  if (!r.ok) {
    return (
      <Card className="min-w-0">
        <CardHeader title={t("One delivered order")} help={t("What one delivered order leaves you, from its price down to its profit.")} />
        <p className="mx-5 mb-5 flex items-start gap-2 rounded-2xl bg-warning-soft px-4 py-3 text-sm text-warning" role="alert"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{t(r.reason)}</p>
      </Card>
    );
  }
  const steps: WaterStep[] = [
    { key: "price", label: t("Price of one order"), short: t("Price"), amount: input.price, kind: "start", note: t(SOURCE_TEXT[row.inputs.price.source]) },
    { key: "product", label: t("Product: {n} × {cost}", { n: input.pieces, cost: fmt(input.costPerPiece) }), short: t("Product"), amount: r.before.product, kind: "cost", note: offerLabel(input.pieces, t) },
    { key: "delivery", label: t("Delivery and packaging"), short: t("Delivery"), amount: r.before.delivery, kind: "cost" },
    { key: "calls", label: t("Call center"), short: t("Calls"), amount: r.before.callCenter + r.after.extraCalls, kind: "cost", note: r.after.extraCalls ? t("With the calls of orders that weren't delivered") : undefined },
    ...(noAds ? [] : [{ key: "ads", label: t("Meta ads"), short: t("Ads"), amount: r.after.ads, kind: "cost" as const, note: t("{ads} per order ÷ {conf} confirmed ÷ {del} delivered", { ads: ad.fmtAd(input.adCostPerOrder ?? 0), conf: pct(input.confirmationRate), del: pct(input.deliveryRate) }) }]),
    { key: "returns", label: t("Returned and lost parcels"), short: t("Returns"), amount: r.after.returns + r.after.lost, kind: "cost", note: t("{n} come back for each delivered order", { n: (r.returnRate / input.deliveryRate).toFixed(2) }) },
    { key: "profit", label: noAds ? t("Profit, ads not counted") : t("Profit"), short: t("Profit"), amount: r.profit, kind: "end" },
  ];
  return (
    <Card className="min-w-0">
      <CardHeader
        title={t("One delivered order")}
        help={t("Each column takes one cost off the price of one order: first the order's own costs, then the ads and the returned and lost parcels each delivered order carries.")}
        description={t("From what the customer pays to what it leaves you.")}
      />
      <div className="flex flex-col gap-4 px-5 pb-5">
        <Waterfall steps={steps} fmt={fmt} label={t("From the price of one order to its real profit")} />
        <p className={cn("rounded-2xl px-4 py-3 text-[13px]", r.profit < 0 ? "border border-negative/30 bg-negative-soft text-negative" : "bg-surface-2 text-muted")}>
          {r.breakevenAdCostPerOrder > 0
            ? tx("Before ads it leaves {before}. Meta can cost up to {max} per order placed before this product loses money.", { before: <b className="num text-fg">{fmt(r.profit + r.after.ads)}</b>, max: <b className="num text-fg">{ad.fmtAd(r.breakevenAdCostPerOrder)}</b> })
            : t("Even without ads, a delivered order doesn't cover its costs at these rates. Raise the price or the delivery rate.")}
        </p>
      </div>
    </Card>
  );
}

// ─────────────────────────── From order to cash ───────────────────────────

function Flow({ row, days }: { row: Row; days: Days }) {
  const { t } = useT();
  const s = row.sample;
  return (
    <Card className="min-w-0">
      <CardHeader title={t("From order to cash")} help={t("Each bar is how many orders reached that step; the % is the share of the step above. Then where the shipped orders are now. Tap a number to see those orders.")} description={t("This product's orders placed in these days.")} />
      <div className="flex flex-col gap-3 px-5 pb-5">
        <OrderFlow
          steps={[
            { key: "placed", label: t("Placed"), value: s.placed, rate: null, href: ordersHref(row.id, days) },
            { key: "confirmed", label: t("Confirmed"), value: s.confirmed, rate: row.funnel.confirmationRate, href: ordersHref(row.id, days, { status: "CONFIRMED" }) },
            { key: "shipped", label: t("Shipped"), value: s.shipped, rate: row.funnel.shippingRate },
          ]}
          partsLabel={t("Where the shipped orders are")}
          parts={[
            { key: "delivered", label: t("Delivered"), value: s.delivered, href: ordersHref(row.id, days, { parcelStatus: "DELIVERED" }) },
            { key: "road", label: t("On the road"), value: s.inTransit, href: ordersHref(row.id, days, { parcelStatus: "SHIPPED" }) },
            { key: "returned", label: t("Returned"), value: s.returned, href: ordersHref(row.id, days, { parcelStatus: "RETURNED" }) },
            { key: "lost", label: t("Lost"), value: s.lost, href: ordersHref(row.id, days, { parcelStatus: "LOST" }) },
          ]}
        />
        {row.open.waiting || s.notConfirmed ? (
          <p className="text-xs text-subtle">{t("{waiting} still waiting for the call center · {not} canceled or never answered.", { waiting: count(row.open.waiting), not: count(Math.max(0, s.notConfirmed)) })}</p>
        ) : null}
      </div>
    </Card>
  );
}

// ─────────────────────────── Campaigns ───────────────────────────

/** Campaign rates once it has enough finished parcels; else the product's. */
function campaignRates(c: Row["funnel"], product: OrderProfitInput, minFinished: number) {
  const own = c.finished >= minFinished && c.confirmationRate !== null && c.deliveryRate !== null;
  return {
    own,
    confirmationRate: own ? c.confirmationRate : product.confirmationRate,
    shippingRate: own ? c.shippingRate : product.shippingRate,
    deliveryRate: own ? c.deliveryRate : product.deliveryRate,
  };
}

/** A campaign's numbers as a small grid, for phones. */
function CampaignNumbers({ cells }: { cells: [string, string, string?, string?][] }) {
  return (
    <dl className="mt-2.5 grid grid-cols-3 gap-x-3 gap-y-2">
      {cells.map(([label, value, tone, def]) => (
        <div key={label} className="min-w-0">
          <dt className="text-[10.5px] leading-tight text-subtle">{def ? <Term label={label} definition={def} /> : label}</dt>
          <dd className={cn("num text-[13px] font-bold", tone)}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Campaigns({ row, data, input, canLink }: { row: Row; data: Tracker; input: OrderProfitInput; canLink: boolean }) {
  const { t } = useT();
  const money = useMoney();
  const fmt = (v: number) => money.fmt(v, data.currency, { decimals: false });
  const ad = useAdMoney(data.currency);
  const r = orderProfit(input);
  const limit = r.ok ? r.profit + r.after.ads : null;
  if (!row.adsLinked) {
    return (
      <Card className="min-w-0 border border-warning/30">
        <CardHeader title={<span className="inline-flex items-center gap-2"><AlertTriangle className="size-4 text-warning" aria-hidden="true" />{t("No campaign is linked to {name}", { name: row.name })}</span>} help={t("Until a campaign is linked, Profit per delivered order counts no ads, so it looks higher than it really is.")} description={t("Ads count for a product only through the campaigns (or ad accounts) you link to it. Link them, and this page adds them all up for you.")} />
        <div className="px-5 pb-5">
          <Button asChild variant="primary"><Link href="/campaigns">{canLink ? t("Link campaigns") : t("Open Campaigns")}</Link></Button>
        </div>
      </Card>
    );
  }
  const all = row.funnel;
  const rows = row.campaigns.map((c) => {
    const cr = campaignRates(c, input, data.minFinished);
    return { c, cr, perDelivered: adCostPerDelivered(c.adCostPerOrder, cr) };
  });
  const defs = {
    perOrder: t("Ad spend ÷ orders placed from the campaign's ads."),
    confirmed: t("Confirmed ÷ orders placed from the campaign's ads. With too few finished parcels, the product's rates are used (marked Product's rates)."),
    delivered: t("Delivered parcels of those that finished. Parcels still on the road don't count yet."),
    perDelivered: t("What the ads cost for each order that is delivered. Worked out as: ad spend per order placed ÷ confirmation rate ÷ shipping rate ÷ delivery rate."),
  };
  const cells = (spend: number, placed: number, perOrder: number | null, conf: number | null, del: number | null, perDelivered: number | null, over: boolean): [string, string, string?, string?][] => [
    [t("Spent"), ad.fmtAd(spend)],
    [t("Orders"), count(placed)],
    [t("Per order"), perOrder === null ? "—" : ad.fmtAd(perOrder), undefined, defs.perOrder],
    [t("Confirmed"), pct(conf), undefined, defs.confirmed],
    [t("Delivered"), pct(del), undefined, defs.delivered],
    [t("Per delivered order"), perDelivered === null ? "—" : fmt(perDelivered), over ? "text-negative" : "text-brand-strong", defs.perDelivered],
  ];
  return (
    <Card className="min-w-0">
      <CardHeader
        title={t("Ads for this product")}
        help={t("Every campaign linked to this product, added up. Their ad spend ÷ orders placed gives the ads per order, which the delivery and confirmation rates turn into ads per delivered order.")}
        description={
          rows.length === 1
            ? t("1 linked campaign added together: {spent} spent for {orders} orders placed.", { spent: ad.fmtAd(all.spend), orders: count(all.placed) })
            : t("{n} linked campaigns added together: {spent} spent for {orders} orders placed.", { n: rows.length, spent: ad.fmtAd(all.spend), orders: count(all.placed) })
        }
      />
      <div className="flex flex-col gap-5 px-5 pb-5">
        {rows.length > 0 ? (
          <>
            <div className="hidden md:block">
              <Table>
                <THead>
                  <tr>
                    <Th>{t("Campaign")}</Th>
                    <Th className="text-end">{t("Spent")}</Th>
                    <Th className="text-end">{t("Orders")}</Th>
                    <Th className="text-end"><Term label={t("Per order")} definition={defs.perOrder} /></Th>
                    <Th className="text-end"><Term label={t("Confirmed")} definition={defs.confirmed} /></Th>
                    <Th className="text-end"><Term label={t("Delivered")} definition={defs.delivered} /></Th>
                    <Th className="text-end"><Term label={t("Per delivered order")} definition={defs.perDelivered} /></Th>
                  </tr>
                </THead>
                <tbody>
                  {rows.map(({ c, cr, perDelivered }) => (
                    <Tr key={c.id}>
                      <Td className="max-w-[16rem] whitespace-normal">
                        <span className="font-semibold">{c.name}</span>
                        <span className="mt-0.5 flex flex-wrap gap-1">
                          {c.running ? <Badge tone="positive">{t("Running")}</Badge> : null}
                          {c.source === "ACCOUNT" ? <Badge tone="neutral">{t("Through its ad account")}</Badge> : null}
                          {!cr.own ? <Badge tone="neutral">{t("Product's rates")}</Badge> : null}
                        </span>
                      </Td>
                      <Td className="num text-end">{ad.fmtAd(c.spend)}</Td>
                      <Td className="num text-end">{count(c.placed)}</Td>
                      <Td className="num text-end">{c.adCostPerOrder === null ? "—" : ad.fmtAd(c.adCostPerOrder)}</Td>
                      <Td className="num text-end">{pct(cr.confirmationRate)}</Td>
                      <Td className="num text-end">{pct(cr.deliveryRate)}</Td>
                      <Td className={cn("num text-end font-bold", perDelivered !== null && limit !== null && perDelivered > limit && "text-negative")}>{perDelivered === null ? "—" : fmt(perDelivered)}</Td>
                    </Tr>
                  ))}
                  <Tr className="bg-brand-soft/50">
                    <Td className="font-bold">{t("All linked campaigns")}</Td>
                    <Td className="num text-end font-bold">{ad.fmtAd(all.spend)}</Td>
                    <Td className="num text-end font-bold">{count(all.placed)}</Td>
                    <Td className="num text-end font-bold">{input.adCostPerOrder === null ? "—" : ad.fmtAd(input.adCostPerOrder)}</Td>
                    <Td className="num text-end font-bold">{pct(input.confirmationRate)}</Td>
                    <Td className="num text-end font-bold">{pct(input.deliveryRate)}</Td>
                    <Td className="num text-end font-extrabold text-brand-strong">{input.adCostPerOrder === null ? "—" : fmt(adCostPerDelivered(input.adCostPerOrder, input) ?? 0)}</Td>
                  </Tr>
                </tbody>
              </Table>
            </div>
            <ul className="flex flex-col gap-2.5 md:hidden">
              {rows.map(({ c, cr, perDelivered }) => (
                <li key={c.id} className="rounded-2xl border border-border p-3.5">
                  <p className="text-sm font-semibold">{c.name}</p>
                  {c.running || c.source === "ACCOUNT" || !cr.own ? (
                    <span className="mt-1 flex flex-wrap gap-1">
                      {c.running ? <Badge tone="positive">{t("Running")}</Badge> : null}
                      {c.source === "ACCOUNT" ? <Badge tone="neutral">{t("Through its ad account")}</Badge> : null}
                      {!cr.own ? <Badge tone="neutral">{t("Product's rates")}</Badge> : null}
                    </span>
                  ) : null}
                  <CampaignNumbers cells={cells(c.spend, c.placed, c.adCostPerOrder, cr.confirmationRate, cr.deliveryRate, perDelivered, perDelivered !== null && limit !== null && perDelivered > limit)} />
                </li>
              ))}
              <li className="rounded-2xl bg-brand-soft/50 p-3.5">
                <p className="text-sm font-bold">{t("All linked campaigns")}</p>
                <CampaignNumbers cells={cells(all.spend, all.placed, input.adCostPerOrder, input.confirmationRate, input.deliveryRate, input.adCostPerOrder === null ? null : adCostPerDelivered(input.adCostPerOrder, input), false)} />
              </li>
            </ul>
            <div>
              <h3 className="mb-3 text-sm font-bold">
                {t("Ad cost per delivered order, by campaign")}
                <HelpTip label={t("Ad cost per delivered order, by campaign")} className="ms-1.5 align-middle">{t("One bar per linked campaign: what its ads cost per delivered order, longest on top. Black bars pass the dashed line, the most a delivered order can pay, and lose money.")}</HelpTip>
              </h3>
              <CampaignBars
                fmt={fmt}
                limit={limit}
                rows={rows.map(({ c, cr, perDelivered }) => {
                  const vars = { spent: ad.fmtAd(c.spend), orders: count(c.placed), perOrder: c.adCostPerOrder === null ? "—" : ad.fmtAd(c.adCostPerOrder), conf: pct(cr.confirmationRate), del: pct(cr.deliveryRate) };
                  return {
                    id: c.id,
                    name: c.name,
                    value: perDelivered,
                    note: cr.own
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

// ─────────────────────────── How it's worked out ───────────────────────────

function HowItWorks({ row, data, input }: { row: Row; data: Tracker; input: OrderProfitInput }) {
  const { t } = useT();
  const money = useMoney();
  const fmt = (v: number) => money.fmt(v, data.currency, { decimals: false });
  const ad = useAdMoney(data.currency);
  const i = row.inputs;
  const src = (s: keyof typeof SOURCE_TEXT) => t(SOURCE_TEXT[s]);
  const rateSrc = t(RATE_SOURCE_TEXT[row.rates.source]);
  const rows: [string, string, string, boolean?][] = [
    [t("Price of one delivered order"), fmt(i.price.value), i.price.source === "orders" ? t("Average MDM collected on {n} delivered orders", { n: count(i.delivered) }) : src(i.price.source), i.price.source === "none"],
    [t("Cost of one piece"), fmt(i.costPerPiece.value), src(i.costPerPiece.source), i.costPerPiece.source === "none"],
    [t("Pieces per order"), String(input.pieces), offerLabel(input.pieces, t)],
    [t("Delivery fee per parcel"), fmt(i.deliveryFee.value), i.deliveryFee.source === "orders" ? t("Average MDM charged on {n} finished parcels", { n: count(i.finished) }) : src(i.deliveryFee.source)],
    [t("Return fee per parcel"), fmt(i.returnFee.value), i.returnFee.source === "orders" ? t("Average MDM charged on returned parcels") : src(i.returnFee.source)],
    [t("Call center per order"), fmt(i.callCenterFee.value), src(i.callCenterFee.source)],
    [t("Packaging per parcel"), fmt(i.packagingFee.value), src(i.packagingFee.source)],
    [t("Meta per order"), i.adCostPerOrder.value === null ? "—" : ad.fmtAd(i.adCostPerOrder.value), i.adCostPerOrder.value === null ? t("No campaign linked, or no orders in these days") : t("{spend} ÷ {n} orders placed", { spend: ad.fmtAd(row.actual.adSpend), n: count(row.sample.placed) })],
    [t("Confirmation rate"), pct(row.rates.confirmation), rateSrc],
    [t("Shipping rate"), pct(row.rates.shipping), rateSrc],
    [t("Delivery rate"), pct(row.rates.delivery), rateSrc],
  ];
  return (
    <Card className="min-w-0">
      <CardHeader title={t("Where every number comes from")} help={t("Each number the page works with, its value and where it was read. Numbers from MDM and Meta update at every sync; the others come from your product details and Settings.")} description={t("Read from MDM, Meta and your product details: nothing here is typed twice.")} />
      <div className="flex flex-col gap-4 px-5 pb-5">
        <ul className="divide-y divide-border rounded-2xl ring-1 ring-border/70">
          {rows.map(([label, value, from, missing]) => (
            <li key={label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-4 py-2.5 sm:grid-cols-[minmax(0,14rem)_8rem_minmax(0,1fr)]">
              <span className="text-[13px] font-semibold">{label}</span>
              <span className={cn("num text-end text-[13px] font-bold sm:text-start", missing && "text-warning")}>{value}</span>
              <span className={cn("col-span-2 text-[12px] text-muted sm:col-span-1", missing && "font-semibold text-warning")}>{from}</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-2 rounded-2xl bg-surface-2 p-4 text-[12.5px] leading-relaxed text-muted">
          <p><b className="text-fg">{t("Real profit")}</b> = {t("what delivered parcels collected − Meta − the pieces delivered × cost of one piece − delivery and packaging of every finished parcel − return fees − call center − your expenses.")}</p>
          <p><b className="text-fg">{t("Still expected")}</b> = {t("for each order not finished: its price × delivery rate − its pieces × cost × delivery rate − its delivery and packaging − its return fee × return rate; times the shipping rate if not sent yet, and the confirmation rate if not confirmed yet.")}</p>
          <p><b className="text-fg">{t("Per delivered order")}</b> = {t("price − product − delivery − calls − Meta per order ÷ (confirmation × shipping × delivery rate) − the returns each delivered order carries.")}</p>
        </div>
      </div>
    </Card>
  );
}

// ─────────────────────────── The page for one product ───────────────────────────

export function ProductProfit({ row, data, canEdit, onEditDetails, days }: { row: Row; data: Tracker; canEdit: boolean; onEditDetails: () => void; days: Days }) {
  const { t } = useT();
  const money = useMoney();
  const cur = data.currency;
  const fmt = (v: number) => money.fmt(v, cur, { decimals: false });
  const unit = 10 ** currencyExponent(cur);
  const tick = (v: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v / unit);
  const input = React.useMemo(() => orderInput(row), [row]);
  const needsCost = row.inputs.costPerPiece.source === "none";

  return (
    <div className="flex min-w-0 flex-col gap-[18px]">
      <section role="region" aria-labelledby="pt-name" className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 id="pt-name" className="text-[22px] font-extrabold tracking-[-0.02em]">{row.name}</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
            {row.fromMdm ? <Badge tone="brand">{t("From MDM")}</Badge> : null}
            {row.rates.source === "example" ? <Badge tone="warning">{t("Example rates")}</Badge> : null}
            {!row.adsLinked ? <Badge tone="warning">{t("No ads linked")}</Badge> : null}
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end">
          <OfferControl row={row} canEdit={canEdit} />
          {canEdit ? <Button variant="ghost" onClick={onEditDetails}><Pencil /> {row.cost ? t("Edit price and costs") : t("Add price and costs")}</Button> : null}
        </div>
      </section>

      {needsCost ? (
        <p className="flex items-start gap-2 rounded-2xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning" role="alert">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {t("Add what one piece costs you in the product details: until then every profit here is too high.")}
        </p>
      ) : null}

      <Summary row={row} data={data} days={days} input={input} />

      <Card className="min-w-0">
        <CardHeader
          title={t("Profit by day")}
          help={t("One bar per day (per week or month over long periods) for the orders placed that day: green is profit, red is loss, striped is still expected from orders not finished yet. Expenses are not in the bars.")}
          description={row.actual.overhead ? t("Real profit of each day's orders, plus what their open orders should still bring. Your expenses come off the total at the top.") : t("Real profit of each day's orders, plus what their open orders should still bring.")}
          actions={<Link href={ordersHref(row.id, days)} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-strong hover:underline">{t("See these orders")}<ArrowUpRight className="size-3.5 rtl:-scale-x-100" aria-hidden="true" /></Link>}
        />
        <div className="px-5 pb-5">
          <ProfitByDay days={row.days} from={days.from} to={days.to} fmt={fmt} tick={tick} />
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-[18px] xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <OneOrder row={row} data={data} input={input} />
        <Flow row={row} days={days} />
      </div>

      <WhatIf key={`${row.id}-${row.piecesPerOrder}`} row={row} data={data} base={input} />

      <Campaigns row={row} data={data} input={input} canLink={canEdit} />

      <MoreDetails id="profit-how" hint={t("Where every number on this page comes from, and how each one is worked out.")}>
        <HowItWorks row={row} data={data} input={input} />
      </MoreDetails>
    </div>
  );
}

/** One line per product for the overview: its offer and what a delivered order really earns. */
export function productLine(row: Row) {
  const input = orderInput(row);
  return { input, result: orderProfit(input), total: row.actual.trueNetProfit + row.expected.total };
}
