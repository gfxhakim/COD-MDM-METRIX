"use client";

import type { inferRouterOutputs } from "@trpc/server";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, ChevronRight, Lock, PackageOpen, RefreshCw, Search, Truck, Wallet } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { FitMoney } from "@/components/app/fit-money";
import { Money } from "@/components/app/format";
import { PageHeader } from "@/components/app/page-header";
import { useCan } from "@/components/app/use-can";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Chip } from "@/components/ui/choice";
import { Input } from "@/components/ui/form";
import { EmptyState, ErrorState, Loading, Skeleton } from "@/components/ui/states";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { Term } from "@/components/ui/tooltip";
import { ACCOUNT_PART_LABEL, ACCOUNT_PARTS, mdmWords, type AccountPart, type PartState } from "@/domain/mdmAccount";
import { sameWilaya } from "@/domain/wilayas";
import { RANGES, rangeDays, todayIn, type RangeKey } from "@/lib/dateRanges";
import { errorMessage, useTRPC } from "@/lib/trpc/client";
import type { AppRouter } from "@/server/trpc/root";
import { cn, formatDate, timeAgo } from "@/lib/utils";

type Overview = inferRouterOutputs<AppRouter>["money"]["overview"];
type Wallet = NonNullable<Overview["wallet"]>;

const count = (n: number) => n.toLocaleString("en-US");

const DEF = {
  ready: "Money from delivered parcels that MDM can pay you now. MDM calls it \"ready\".",
  onHold: "Money from delivered parcels that MDM still holds, for example until the return window ends. MDM calls it \"not ready\".",
  paid: "Everything MDM has paid out to you so far.",
  fees: "Every line MDM wrote in your account in these days: money collected for a parcel, or a fee it charged. Grouped by MDM's own line names.",
};

// ─────────────────────────── Small pieces ───────────────────────────

function Updated({ at }: { at: Date | string | null | undefined }) {
  return <span className="text-[11px] text-subtle">{at ? `Read ${timeAgo(at)}` : "Not read yet"}</span>;
}

/** Why a part has nothing (or old data): no permission, an MDM error, or not read yet. */
function PartNote({ part, state, hasData }: { part: AccountPart; state: PartState | undefined; hasData: boolean }) {
  if (state?.ok) return null;
  if (!state) return hasData ? null : <p className="rounded-2xl bg-surface-2 px-4 py-3 text-sm text-muted">Comes with your next MDM sync.</p>;
  return (
    <p className={cn("flex items-start gap-2 rounded-2xl px-4 py-3 text-sm", state.denied ? "bg-surface-2 text-muted" : "bg-warning-soft text-warning")}>
      {state.denied ? <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
      <span>
        {state.message ?? `The ${ACCOUNT_PART_LABEL[part]} couldn't be read.`}{" "}
        {state.denied ? "MDM can allow it for your key." : "The next sync tries again."}
        {hasData && state.okAt ? ` What you see was read ${timeAgo(state.okAt)}.` : ""}
      </span>
    </p>
  );
}

function WalletCard({ label, def, value, currency, sub, hero }: { label: string; def: string; value: number; currency: string; sub: string; hero?: boolean }) {
  return (
    <section
      className={cn(
        "relative flex min-w-0 flex-col gap-4 overflow-hidden rounded-[22px] p-5",
        hero ? "bg-brand-hero shine shadow-[0_16px_34px_rgb(204_19_37/0.35),inset_0_1px_0_rgb(255_255_255/0.35)]" : "bg-surface shadow-card",
      )}
    >
      {hero ? <span className="pointer-events-none absolute -right-12 -top-16 size-44 rounded-full border-[20px] border-white/10" aria-hidden="true" /> : null}
      <span className={cn("relative text-[15px] font-semibold", !hero && "text-muted")}>
        <Term label={label} definition={def} iconClassName={hero ? "text-white/70 hover:text-white" : undefined} />
      </span>
      <div className="relative mt-auto min-w-0">
        <FitMoney value={value} currency={currency} max={34} codeClassName={hero ? "text-white/85" : undefined} className={hero ? "[text-shadow:0_2px_14px_rgb(255_170_178/0.55)]" : undefined} />
      </div>
      <span className={cn("relative text-[11px]", hero ? "text-white/85" : "text-subtle")}>{sub}</span>
    </section>
  );
}

/** Labelled numbers side by side: how tables read on a phone. */
function MiniStats({ title, sub, items }: { title: React.ReactNode; sub?: React.ReactNode; items: { label: string; value: React.ReactNode; strong?: boolean }[] }) {
  return (
    <li className="row-in flex min-w-0 flex-col gap-2 rounded-2xl bg-surface-2 p-3">
      <div className="min-w-0">
        <div className="text-sm font-semibold">{title}</div>
        {sub ? <div className="text-[11px] text-subtle">{sub}</div> : null}
      </div>
      <dl className="grid grid-cols-3 gap-x-2 gap-y-2">
        {items.map((i) => (
          <div key={i.label} className="min-w-0">
            <dt className="text-[11px] leading-tight text-muted">{i.label}</dt>
            <dd className={cn("num truncate text-sm", i.strong && "font-bold")}>{i.value}</dd>
          </div>
        ))}
      </dl>
    </li>
  );
}

const WALLET_ROWS: { key: keyof Wallet["details"]; label: string }[] = [
  { key: "gross", label: "Collected from customers" },
  { key: "taxes", label: "Taxes" },
  { key: "refunds", label: "Refunds" },
  { key: "sourcing", label: "Sourcing" },
  { key: "addedCharges", label: "Charges added" },
  { key: "deductedCharges", label: "Charges deducted" },
];

function WalletDetails({ wallet }: { wallet: Wallet }) {
  const [open, setOpen] = React.useState(false);
  const rows = WALLET_ROWS.filter((r) => wallet.details[r.key]);
  if (!rows.length) return null;
  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="press flex items-center gap-1.5 self-start rounded-full px-1 text-sm font-medium text-muted hover:text-fg">
        {open ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}
        How MDM splits it
      </button>
      {open ? (
        <>
        <ul className="fade-in flex flex-col gap-2 md:hidden">
          {rows.map((r) => {
            const d = wallet.details[r.key]!;
            return <MiniStats key={r.key} title={r.label} items={[{ label: "On hold", value: <Money value={d.onHold ?? null} currency={wallet.currency} /> }, { label: "Ready", value: <Money value={d.ready ?? null} currency={wallet.currency} /> }, { label: "Paid", value: <Money value={d.paid ?? null} currency={wallet.currency} /> }]} />;
          })}
        </ul>
        <Card className="fade-in hidden md:block">
          <Table>
            <THead>
              <tr><Th>Part</Th><Th className="text-right">On hold</Th><Th className="text-right">Ready</Th><Th className="text-right">Paid</Th></tr>
            </THead>
            <tbody>
              {rows.map((r) => {
                const d = wallet.details[r.key]!;
                return (
                  <Tr key={r.key}>
                    <Td className="whitespace-normal font-medium">{r.label}</Td>
                    <Td className="text-right"><Money value={d.onHold ?? null} currency={wallet.currency} /></Td>
                    <Td className="text-right"><Money value={d.ready ?? null} currency={wallet.currency} /></Td>
                    <Td className="text-right"><Money value={d.paid ?? null} currency={wallet.currency} /></Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
        </>
      ) : null}
    </div>
  );
}

function PayoutStatus({ status, confirmed }: { status: string; confirmed: boolean }) {
  if (confirmed) return <Badge tone="positive">{mdmWords(status) || "Paid"}</Badge>;
  if (/cancel|reject|fail/i.test(status)) return <Badge tone="neutral">{mdmWords(status)}</Badge>;
  return <Badge tone="warning">{mdmWords(status) || "Not paid yet"}</Badge>;
}

function Payouts({ data }: { data: Overview }) {
  const [open, setOpen] = React.useState<string | null>(null);
  const has = data.payouts.length > 0;
  return (
    <Card className="min-w-0">
      <CardHeader title="Payouts" description="What MDM paid you, or is preparing to pay. Tap one to see what it is made of." actions={<Updated at={data.parts.payouts?.okAt} />} />
      <div className="flex flex-col gap-3 px-5 pb-5">
        <PartNote part="payouts" state={data.parts.payouts} hasData={has} />
        {has ? (
          <ul className="flex flex-col gap-2">
            {data.payouts.map((p) => {
              const isOpen = open === p.id;
              const parts = p.breakdown ? [...p.breakdown.items.map((i) => ({ ...i, tax: false })), ...p.breakdown.taxes.map((t) => ({ ...t, tax: true }))] : [];
              return (
                <li key={p.id} className="row-in overflow-hidden rounded-2xl bg-surface-2">
                  <button type="button" onClick={() => setOpen(isOpen ? null : p.id)} aria-expanded={isOpen} className="press flex w-full min-w-0 items-center gap-3 px-3 py-3 text-left hover:bg-surface-3">
                    {isOpen ? <ChevronDown className="size-4 shrink-0 text-muted" aria-hidden="true" /> : <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden="true" />}
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">{formatDate(p.date)} <PayoutStatus status={p.status} confirmed={p.confirmed} /></span>
                      {p.storeNames ? <span className="truncate text-xs text-muted">{p.storeNames}</span> : null}
                    </span>
                    <Money value={p.amount} currency={p.currency} className="shrink-0 text-[15px] font-bold" />
                  </button>
                  {isOpen ? (
                    <div className="fade-in border-t border-border/60 px-3 py-3">
                      {parts.length ? (
                        <ul className="grid grid-cols-1 gap-1.5 text-sm sm:grid-cols-2">
                          {parts.map((i) => (
                            <li key={`${i.tax ? "tax" : "item"}-${i.type}`} className="flex min-w-0 items-center justify-between gap-3 rounded-xl bg-surface px-3 py-2">
                              <span className="min-w-0 truncate">{mdmWords(i.type)}{i.tax ? " (tax)" : ""} <span className="text-subtle">× {count(i.count)}</span></span>
                              <Money value={i.total} currency={p.breakdown!.currency} signed className="shrink-0 font-semibold" />
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-muted">MDM hasn&apos;t said what this payout is made of yet. The next sync asks again.</p>
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : data.parts.payouts?.ok ? (
          <p className="text-sm text-muted">MDM hasn&apos;t made any payout to you yet.</p>
        ) : null}
      </div>
    </Card>
  );
}

function Fees({ data, timezone }: { data: Overview; timezone: string }) {
  const trpc = useTRPC();
  const [range, setRange] = React.useState<RangeKey>("month");
  const [custom, setCustom] = React.useState({ from: "", to: "" });
  const days = rangeDays(range, todayIn(timezone), custom);
  const bad = !!days.from && !!days.to && days.from > days.to;
  const fees = useQuery({ ...trpc.money.fees.queryOptions(days), enabled: !bad && data.feeLines > 0, placeholderData: keepPreviousData });
  const rows = fees.data?.rows ?? [];
  const cur = rows[0]?.currency ?? data.currency;
  const total = rows.reduce((a, r) => ({ amount: a.amount + r.amount, paidOut: a.paidOut + r.paidOut, waiting: a.waiting + r.waiting }), { amount: 0, paidOut: 0, waiting: 0 });
  const oneCurrency = rows.every((r) => r.currency === cur);
  return (
    <Card className="min-w-0">
      <CardHeader title={<Term label="Money and fees per order" definition={DEF.fees} />} description="Collected for your parcels, and what MDM charged for them, by the day MDM wrote it." actions={<Updated at={data.parts.fees?.okAt} />} />
      <div className="flex flex-col gap-3 px-5 pb-5">
        <PartNote part="fees" state={data.parts.fees} hasData={data.feeLines > 0} />
        {data.feeLines > 0 ? (
          <>
            <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
              {RANGES.map((r) => (
                <Chip key={r.key} active={range === r.key} onClick={() => setRange(r.key)} className="shrink-0">{r.label}</Chip>
              ))}
            </div>
            {range === "custom" ? (
              <div className="grid grid-cols-2 gap-2 sm:max-w-sm">
                <Input type="date" aria-label="From" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
                <Input type="date" aria-label="To" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
              </div>
            ) : null}
            {bad ? <p className="text-sm text-negative">The start day must be before the end day.</p> : null}
            {fees.isError ? <ErrorState message={errorMessage(fees.error)} /> : fees.isPending ? <Skeleton className="h-40 rounded-2xl" /> : rows.length === 0 ? (
              <p className="text-sm text-muted">Nothing in these days.</p>
            ) : (
              <>
                <Table>
                  <THead>
                    <tr><Th>Line</Th><Th className="hidden text-right sm:table-cell">Lines</Th><Th className="text-right">Amount</Th><Th className="hidden text-right sm:table-cell">Paid out</Th><Th className="text-right">With MDM</Th></tr>
                  </THead>
                  <tbody>
                    {rows.map((r) => (
                      <Tr key={`${r.type}-${r.subType}-${r.currency}`}>
                        <Td className="whitespace-normal font-medium">{mdmWords(r.type)}{r.subType ? <span className="text-muted"> · {mdmWords(r.subType)}</span> : null}<span className="block text-[11px] font-normal text-subtle sm:hidden">{count(r.lines)} lines</span></Td>
                        <Td className="num hidden text-right sm:table-cell">{count(r.lines)}</Td>
                        <Td className="text-right font-semibold"><Money value={r.amount} currency={r.currency} signed /></Td>
                        <Td className="hidden text-right sm:table-cell"><Money value={r.paidOut} currency={r.currency} /></Td>
                        <Td className="text-right"><Money value={r.waiting} currency={r.currency} /></Td>
                      </Tr>
                    ))}
                    {oneCurrency && rows.length > 1 ? (
                      <tr className="font-bold">
                        <Td>Total</Td>
                        <Td className="num hidden text-right sm:table-cell">{count(fees.data!.lines)}</Td>
                        <Td className="text-right"><Money value={total.amount} currency={cur} signed /></Td>
                        <Td className="hidden text-right sm:table-cell"><Money value={total.paidOut} currency={cur} /></Td>
                        <Td className="text-right"><Money value={total.waiting} currency={cur} /></Td>
                      </tr>
                    ) : null}
                  </tbody>
                </Table>
                <p className="text-[11px] text-subtle">{count(fees.data!.linkedToOrders)} of {count(fees.data!.lines)} lines are tied to an order in the app. Names are MDM&apos;s own.</p>
              </>
            )}
          </>
        ) : data.parts.fees?.ok ? (
          <p className="text-sm text-muted">MDM has no money or fee lines in your account yet.</p>
        ) : null}
      </div>
    </Card>
  );
}

const CAPITAL: { key: keyof NonNullable<Overview["capital"]>["buckets"]; label: string }[] = [
  { key: "available", label: "Available" },
  { key: "processing", label: "Being prepared" },
  { key: "inDelivery", label: "In delivery" },
  { key: "returning", label: "Coming back" },
  { key: "lost", label: "Lost" },
  { key: "totalInbound", label: "Entered in total" },
];

const STOCK_COLUMNS = [
  { key: "available", label: "Available" },
  { key: "incoming", label: "Incoming" },
  { key: "processing", label: "Being prepared" },
  { key: "inDelivery", label: "In delivery" },
  { key: "delivered", label: "Delivered" },
  { key: "returning", label: "Coming back" },
  { key: "returned", label: "Returned" },
  { key: "damaged", label: "Damaged" },
  { key: "lost", label: "Lost" },
  { key: "totalInbound", label: "Entered" },
] as const;

function Stock({ data }: { data: Overview }) {
  const [archived, setArchived] = React.useState(false);
  const active = data.stock.filter((s) => !s.archived);
  const list = archived ? data.stock : active;
  const hidden = data.stock.length - active.length;
  const cap = data.capital;
  return (
    <Card className="min-w-0">
      <CardHeader title="Stock at MDM" description="Units in MDM's warehouse and on the road, per product, and what they are worth at your purchase price in MDM." actions={<Updated at={data.parts.stock?.okAt} />} />
      <div className="flex flex-col gap-4 px-5 pb-5">
        <PartNote part="stock" state={data.parts.stock} hasData={data.stock.length > 0} />
        {cap ? (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
            {CAPITAL.map((c, i) => (
              <div key={c.key} className={cn("flex min-w-0 flex-col gap-1 rounded-2xl p-3", i === 0 ? "bg-brand glow" : "bg-surface-2")}>
                <span className={cn("text-[11px] font-semibold", i === 0 ? "text-white/85" : "text-muted")}>{c.label}</span>
                <span className="num text-lg font-extrabold leading-tight">{count(cap.buckets[c.key].units)} <span className={cn("text-xs font-semibold", i === 0 ? "text-white/80" : "text-subtle")}>units</span></span>
                <Money value={cap.buckets[c.key].value} currency={cap.currency} className={cn("truncate text-xs", i === 0 ? "text-white/90" : "text-muted")} />
              </div>
            ))}
          </div>
        ) : (
          <PartNote part="capital" state={data.parts.capital} hasData={false} />
        )}
        {cap ? <PartNote part="capital" state={data.parts.capital} hasData /> : null}
        {list.length ? (
          <>
          <ul className="flex flex-col gap-2 md:hidden">
            {list.map((s) => (
              <MiniStats
                key={s.id}
                title={<>{s.productName}{s.variantName && s.variantName !== s.productName ? <span className="font-normal text-muted"> · {s.variantName}</span> : null}</>}
                sub={<>{[s.sku, s.purchasePrice !== null ? "bought at" : null].filter(Boolean).join(" · ")}{s.purchasePrice !== null ? <> <Money value={s.purchasePrice} currency={s.currency} /></> : null}{s.archived ? " · archived" : ""}</>}
                items={STOCK_COLUMNS.map((c) => ({ label: c.label, value: s.stockAt ? <span className={cn(c.key === "lost" && s.lost > 0 && "text-negative")}>{count(s[c.key])}</span> : "—", strong: c.key === "available" }))}
              />
            ))}
          </ul>
          <div className="hidden md:block">
          <Table>
            <THead>
              <tr>
                <Th>Product</Th>
                {STOCK_COLUMNS.map((c) => <Th key={c.key} className="text-right">{c.label}</Th>)}
              </tr>
            </THead>
            <tbody>
              {list.map((s) => (
                <Tr key={s.id} className={s.archived ? "opacity-60" : undefined}>
                  <Td className="min-w-[160px] whitespace-normal">
                    <span className="font-medium">{s.productName}</span>
                    {s.variantName && s.variantName !== s.productName ? <span className="text-muted"> · {s.variantName}</span> : null}
                    <span className="block text-[11px] text-subtle">
                      {[s.sku, s.purchasePrice !== null ? "bought at" : null].filter(Boolean).join(" · ")}
                      {s.purchasePrice !== null ? <> <Money value={s.purchasePrice} currency={s.currency} /></> : null}
                      {s.archived ? " · archived" : ""}
                    </span>
                  </Td>
                  {STOCK_COLUMNS.map((c) => (
                    <Td key={c.key} className={cn("num text-right", c.key === "available" && "font-bold", c.key === "lost" && s.lost > 0 && "text-negative")}>{s.stockAt ? count(s[c.key]) : "—"}</Td>
                  ))}
                </Tr>
              ))}
            </tbody>
          </Table>
          </div>
          </>
        ) : data.parts.stock?.ok ? (
          <p className="text-sm text-muted">MDM lists no products for you.</p>
        ) : null}
        {hidden ? (
          <button type="button" onClick={() => setArchived((a) => !a)} className="press self-start text-sm font-medium text-muted hover:text-fg">
            {archived ? "Hide archived products" : `Show archived products (${hidden})`}
          </button>
        ) : null}
      </div>
    </Card>
  );
}

function ArrivalStatus({ status }: { status: string }) {
  const tone = /complet|done|received|validated|closed/i.test(status) ? "positive" : /cancel|reject/i.test(status) ? "neutral" : "warning";
  return <Badge tone={tone}>{mdmWords(status)}</Badge>;
}

function Arrivals({ data }: { data: Overview }) {
  return (
    <Card className="min-w-0">
      <CardHeader title="Stock arrivals" description="Stock you sent into MDM's warehouse: what was expected and what MDM received." actions={<Updated at={data.parts.arrivals?.okAt} />} />
      <div className="flex flex-col gap-3 px-5 pb-5">
        <PartNote part="arrivals" state={data.parts.arrivals} hasData={data.arrivals.length > 0} />
        {data.arrivals.length ? (
          <ul className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
            {data.arrivals.map((a) => (
              <li key={a.id} className="row-in flex min-w-0 flex-col gap-2 rounded-2xl bg-surface-2 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-semibold"><Truck className="size-4 text-brand" aria-hidden="true" />{formatDate(a.date)}</span>
                  <ArrivalStatus status={a.status} />
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  <span>Expected <b className="num">{count(a.expectedUnits)}</b></span>
                  <span>Received <b className="num">{count(a.receivedUnits)}</b></span>
                  {a.damagedUnits ? <span className="text-negative">Damaged <b className="num">{count(a.damagedUnits)}</b></span> : null}
                </div>
                {a.products.length ? (
                  <p className="truncate text-xs text-muted" title={a.products.map((p) => `${p.name} × ${p.expected}`).join(", ")}>
                    {a.products.map((p) => `${p.name} × ${count(p.expected)}`).join(" · ")}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : data.parts.arrivals?.ok ? (
          <p className="text-sm text-muted">No stock arrivals at MDM yet.</p>
        ) : null}
      </div>
    </Card>
  );
}

function PriceRow({ label, value, currency }: { label: string; value: number | null | undefined; currency: string }) {
  if (value === null || value === undefined) return null;
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2 text-sm">
      <span className="text-muted">{label}</span>
      <Money value={value} currency={currency} className="font-semibold" />
    </div>
  );
}

function Prices({ data }: { data: Overview }) {
  const [q, setQ] = React.useState("");
  const [all, setAll] = React.useState(false);
  const p = data.prices;
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const rows = p ? p.delivery.filter((d) => !q || norm(d.wilaya).includes(norm(q)) || d.code === q.trim() || sameWilaya(q, d.wilaya)) : [];
  const shown = all || q ? rows : rows.slice(0, 8);
  return (
    <Card className="min-w-0">
      <CardHeader title="MDM price list" description="What MDM charges you: call center, fulfilment and delivery per wilaya." actions={<Updated at={data.parts.prices?.okAt} />} />
      <div className="flex flex-col gap-4 px-5 pb-5">
        <PartNote part="prices" state={data.parts.prices} hasData={!!p} />
        {p ? (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {p.callCenter ? (
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold uppercase tracking-[0.06em] text-subtle">Call center</span>
                  <PriceRow label="Per order received" value={p.callCenter.perLead} currency={p.currency} />
                  <PriceRow label="Per confirmed order" value={p.callCenter.perConfirmed} currency={p.currency} />
                  <PriceRow label="Per delivered order" value={p.callCenter.perDelivered} currency={p.currency} />
                  <PriceRow label="Extra per upsell" value={p.callCenter.upsellExtra} currency={p.currency} />
                </div>
              ) : null}
              {p.fulfilment ? (
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold uppercase tracking-[0.06em] text-subtle">Fulfilment</span>
                  <PriceRow label="Per parcel sent" value={p.fulfilment.perDispatched} currency={p.currency} />
                  <PriceRow label="Per parcel delivered" value={p.fulfilment.perDelivered} currency={p.currency} />
                  <PriceRow label={p.fulfilment.maxItems ? `Per item above ${p.fulfilment.maxItems}` : "Per extra item"} value={p.fulfilment.extraPerItem} currency={p.currency} />
                </div>
              ) : null}
            </div>
            {p.delivery.length ? (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.06em] text-subtle">Delivery, per wilaya</span>
                  <label className="relative w-full sm:w-56">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
                    <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a wilaya" aria-label="Find a wilaya" className="pl-9" />
                  </label>
                </div>
                <ul className="flex flex-col gap-2 md:hidden">
                  {shown.map((d) => (
                    <MiniStats key={`${d.code}-${d.wilaya}`} title={<>{d.code ? <span className="num mr-1.5 text-subtle">{d.code}</span> : null}{d.wilaya}</>} items={[{ label: "Home", value: <Money value={d.home} currency={p.currency} /> }, { label: "Stop desk", value: <Money value={d.stopDesk} currency={p.currency} /> }, { label: "Return", value: <Money value={d.return} currency={p.currency} /> }]} />
                  ))}
                </ul>
                <div className="hidden md:block">
                <Table>
                  <THead>
                    <tr><Th>Wilaya</Th><Th className="text-right">Home</Th><Th className="text-right">Stop desk</Th><Th className="text-right">Return</Th><Th className="text-right">Exchange</Th></tr>
                  </THead>
                  <tbody>
                    {shown.map((d) => (
                      <Tr key={`${d.code}-${d.wilaya}`}>
                        <Td className="font-medium">{d.code ? <span className="num mr-1.5 text-subtle">{d.code}</span> : null}{d.wilaya}</Td>
                        <Td className="text-right"><Money value={d.home} currency={p.currency} /></Td>
                        <Td className="text-right"><Money value={d.stopDesk} currency={p.currency} /></Td>
                        <Td className="text-right"><Money value={d.return} currency={p.currency} /></Td>
                        <Td className="text-right"><Money value={d.exchange} currency={p.currency} /></Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
                </div>
                {!q && rows.length > 8 ? (
                  <button type="button" onClick={() => setAll((a) => !a)} className="press self-start text-sm font-medium text-muted hover:text-fg">
                    {all ? "Show fewer" : `Show all ${rows.length} wilayas`}
                  </button>
                ) : null}
                {q && !rows.length ? <p className="text-sm text-muted">No wilaya matches.</p> : null}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </Card>
  );
}

// ─────────────────────────── Page ───────────────────────────

export function MoneyView() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const canSync = useCan("sync.run");
  const workspace = useQuery(trpc.workspace.getCurrent.queryOptions());
  const jobs = useQuery({ ...trpc.sync.list.queryOptions({ limit: 1 }), enabled: canSync, refetchInterval: (query) => (query.state.data?.some((j) => j.status === "QUEUED" || j.status === "RUNNING") ? 3000 : false) });
  const running = jobs.data?.some((j) => j.status === "QUEUED" || j.status === "RUNNING") ?? false;
  const overview = useQuery(trpc.money.overview.queryOptions());
  const wasRunning = React.useRef(false);
  React.useEffect(() => {
    if (wasRunning.current && !running) {
      for (const k of [trpc.money, trpc.sync, trpc.integrations, trpc.orders, trpc.reports, trpc.creatives]) qc.invalidateQueries({ queryKey: k.pathKey() });
      qc.invalidateQueries({ queryKey: trpc.workspace.dataHealth.queryKey() });
    }
    wasRunning.current = running;
  }, [running, qc, trpc]);
  const start = useMutation(
    trpc.sync.start.mutationOptions({
      onSuccess: (r) => {
        qc.invalidateQueries({ queryKey: trpc.sync.pathKey() });
        toast(r.alreadyRunning ? "error" : "success", r.alreadyRunning ? "A sync is already running for this workspace" : "Sync started. This page updates when it finishes.");
      },
      onError: (e) => toast("error", errorMessage(e)),
    }),
  );

  const data = overview.data;
  const timezone = workspace.data?.timezone ?? "Africa/Algiers";
  const problems = data ? ACCOUNT_PARTS.filter((p) => data.parts[p] && !data.parts[p]!.ok) : [];
  const anything = !!data && (Object.keys(data.parts).length > 0 || !!data.wallet || data.feeLines > 0 || data.stock.length > 0);

  return (
    <>
      <PageHeader
        title="Money & stock"
        description="Your MDM Express wallet, payouts, fees and stock, copied from MDM with every sync. Nothing here changes anything at MDM."
        actions={
          canSync ? (
            <Button variant="primary" onClick={() => start.mutate({ mode: "INCREMENTAL" })} disabled={start.isPending || running} className="w-full sm:w-auto">
              <RefreshCw className={cn(running && "animate-spin")} aria-hidden="true" />
              {running ? "Syncing…" : "Sync now"}
            </Button>
          ) : undefined
        }
      />
      {overview.isError ? (
        <ErrorState message={errorMessage(overview.error)} />
      ) : !data ? (
        <Loading label="Loading money and stock" />
      ) : !anything ? (
        <Card>
          <EmptyState
            icon={<Wallet className="size-6" />}
            title={data.connected ? "Nothing read from MDM yet" : "Connect MDM Express first"}
            description={data.connected ? "Your wallet, payouts, fees and stock come with the next MDM sync." : "Save your MDM API key in Settings, then run a sync. Your wallet, payouts, fees and stock come with it."}
            action={data.connected ? undefined : <Button asChild variant="primary"><Link href="/settings">Open Settings</Link></Button>}
          />
        </Card>
      ) : (
        <div className="flex min-w-0 flex-col gap-[18px]">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            {data.demo ? <Badge tone="brand">Demo data</Badge> : null}
            <span>Last MDM sync {timeAgo(data.lastSyncAt)}.</span>
            {problems.length ? <span className="text-warning">{problems.length === 1 ? "One part" : `${problems.length} parts`} couldn&apos;t be read, see below.</span> : null}
          </div>

          <section className="flex flex-col gap-3" aria-label="Wallet">
            {data.wallet ? (
              <>
                <div className="grid grid-cols-1 gap-[18px] md:grid-cols-3">
                  <WalletCard hero label="Ready to collect" def={DEF.ready} value={data.wallet.ready} currency={data.wallet.currency} sub="MDM can pay you this now" />
                  <WalletCard label="On hold" def={DEF.onHold} value={data.wallet.onHold} currency={data.wallet.currency} sub="Delivered, not released by MDM yet" />
                  <WalletCard label="Paid to you" def={DEF.paid} value={data.wallet.paid} currency={data.wallet.currency} sub={`In total · read ${timeAgo(data.walletAt)}`} />
                </div>
                <PartNote part="wallet" state={data.parts.wallet} hasData />
                <WalletDetails wallet={data.wallet} />
              </>
            ) : (
              <Card className="p-5">
                <div className="flex items-center gap-2 pb-3 text-[17px] font-bold"><Wallet className="size-5 text-brand" aria-hidden="true" />Wallet</div>
                <PartNote part="wallet" state={data.parts.wallet} hasData={false} />
              </Card>
            )}
          </section>

          <div className="grid grid-cols-1 gap-[18px] xl:grid-cols-2">
            <Payouts data={data} />
            <Fees data={data} timezone={timezone} />
          </div>
          <Stock data={data} />
          <div className="grid grid-cols-1 gap-[18px] xl:grid-cols-2">
            <Arrivals data={data} />
            <Prices data={data} />
          </div>
          <p className="flex items-center gap-2 text-[11px] text-subtle">
            <PackageOpen className="size-3.5" aria-hidden="true" />
            Read from your MDM account with your own API key. Amounts are as MDM reports them.
          </p>
        </div>
      )}
    </>
  );
}
