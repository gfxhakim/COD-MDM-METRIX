"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowUpRight, Boxes, FileWarning, Link2Off, PackageCheck, PhoneCall, SlidersHorizontal, TrendingUp, Unlink } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { AdsFilter, useAdsFilter } from "@/components/app/ads-filter";
import { useMoney } from "@/components/app/currency";
import { FitMoney, FitText, moneyParts } from "@/components/app/fit-money";
import { Money, Rate, Ratio } from "@/components/app/format";
import { useShell } from "@/components/app/shell";
import { VERDICT_LABEL, type VerdictValue } from "@/components/app/verdict";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { Term } from "@/components/ui/tooltip";
import { DEF } from "@/lib/definitions";
import { errorMessage, useTRPC } from "@/lib/trpc/client";
import { useSlidingPill } from "@/components/ui/sliding-pill";
import { cn, formatDateTime, formatPercent, timeAgo } from "@/lib/utils";

type RevenueView = "DELIVERED" | "REMITTED";
type Day = { date: string; adSpend: number; placed: number; delivered: number };

const DAY_MS = 86_400_000;
const PRESETS = [
  { days: 0, label: "All time" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
] as const;

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const utc = (date: string) => Date.parse(`${date}T00:00:00Z`);
const dayLabel = (t: number, withYear = false) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" });
const count = (n: number) => n.toLocaleString("en-US");
const compact = (n: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);

/** Every day from `from` to `to` (or the data's first and last day), zeros where nothing happened. */
function fillDays(series: Day[], from: string, to: string): Day[] {
  if (series.length === 0) return [];
  const start = utc(from || series[0].date);
  const end = utc(to || series[series.length - 1].date);
  const byDate = new Map(series.map((s) => [s.date, s]));
  const out: Day[] = [];
  for (let t = start; t <= end && out.length < 3700; t += DAY_MS) {
    const date = new Date(t).toISOString().slice(0, 10);
    out.push(byDate.get(date) ?? { date, adSpend: 0, placed: 0, delivered: 0 });
  }
  return out;
}

type Bucket = { label: string; long: string; placed: number; delivered: number; adSpend: number };

/** Days, weeks or months, picked so the chart keeps a readable number of bars. */
function bucketize(days: Day[]): { unit: "Daily" | "Weekly" | "Monthly"; buckets: Bucket[]; capped: boolean } {
  if (days.length <= 14) {
    return { unit: "Daily", capped: false, buckets: days.map((d) => ({ label: dayLabel(utc(d.date)), long: dayLabel(utc(d.date), true), placed: d.placed, delivered: d.delivered, adSpend: d.adSpend })) };
  }
  const groups = new Map<string, Bucket>();
  const weekly = days.length <= 16 * 7;
  const start = utc(days[0].date);
  const years = new Set(days.map((d) => d.date.slice(0, 4))).size;
  for (const d of days) {
    const t = utc(d.date);
    let key: string;
    let label: string;
    let long: string;
    if (weekly) {
      const first = start + Math.floor((t - start) / (7 * DAY_MS)) * 7 * DAY_MS;
      key = String(first);
      label = dayLabel(first);
      long = `Week of ${dayLabel(first, true)}`;
    } else {
      key = d.date.slice(0, 7);
      label = new Date(t).toLocaleDateString("en-US", { month: "short", ...(years > 1 ? { year: "2-digit" } : {}), timeZone: "UTC" });
      long = new Date(t).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    }
    let b = groups.get(key);
    if (!b) {
      b = { label, long, placed: 0, delivered: 0, adSpend: 0 };
      groups.set(key, b);
    }
    b.placed += d.placed;
    b.delivered += d.delivered;
    b.adSpend += d.adSpend;
  }
  const all = [...groups.values()];
  return { unit: weekly ? "Weekly" : "Monthly", buckets: all.slice(-12), capped: all.length > 12 };
}

/** A round top above `max` that splits into three even ticks. */
function niceTop(max: number) {
  if (max <= 0) return 3;
  const raw = max / 3;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((k) => k * p).find((s) => s >= raw) ?? 10 * p;
  return Math.max(3, Math.ceil(step) * 3);
}

/** Round arrow button in the corner of a card. */
function CornerLink({ href, label, onRed }: { href: string; label: string; onRed?: boolean }) {
  return (
    <Link href={href} aria-label={label} title={label} className={cn("press group/corner grid size-9 shrink-0 place-items-center rounded-full", onRed ? "bg-white/20 text-white hover:bg-white/30" : "bg-surface-3 text-fg hover:bg-brand-soft hover:text-brand-strong")}>
      <ArrowUpRight className="size-4 transition-transform duration-300 group-hover/corner:-translate-y-0.5 group-hover/corner:translate-x-0.5" aria-hidden="true" />
    </Link>
  );
}

function Panel({ className, children, ...rest }: React.HTMLAttributes<HTMLElement>) {
  return (
    <section className={cn("lift flex min-w-0 flex-col rounded-[22px] bg-surface p-5 shadow-card", className)} {...rest}>
      {children}
    </section>
  );
}

function PanelTitle({ children, action, def }: { children: string; action?: React.ReactNode; def?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-lg font-bold tracking-tight">{def ? <Term label={children} definition={def} /> : children}</h2>
      {action}
    </div>
  );
}

/** Ten blocks: the white ones are POAS, the dark tick is the target set in Settings. */
function PoasBlocks({ poas, target }: { poas: number | null; target: number }) {
  const top = target > 0 ? target * 2 : 1;
  const filled = poas === null ? 0 : Math.max(0, Math.min(10, Math.round((poas / top) * 10)));
  const tick = Math.max(0, Math.min(1, target / top)) * 78;
  return (
    <svg width="78" height="34" viewBox="0 -4 78 38" role="img" aria-label={`POAS ${poas === null ? "not known yet" : poas.toFixed(2)}, target ${target.toFixed(2)}`} className="shrink-0">
      {Array.from({ length: 10 }, (_, i) => (
        <rect key={i} x={i * 8} y={0} width={5.5} height={30} rx={2} fill={i < filled ? "#ffffff" : "rgb(255 255 255 / 0.28)"} className="animate-grow-y" style={{ animationDelay: `${200 + i * 45}ms` }} />
      ))}
      <rect x={Math.min(75.5, Math.max(0, tick - 2))} y={-4} width={2.5} height={38} rx={1.2} fill="#2a0006" />
    </svg>
  );
}

/** One thin bar per day, for the last 30 days of the period. */
function DayBars({ days, pick, label, unit }: { days: Day[]; pick: (d: Day) => number; label: string; unit: string }) {
  const last = days.slice(-30);
  if (last.length < 2) return null;
  const max = Math.max(1, ...last.map(pick));
  const pitch = 120 / last.length;
  return (
    <svg width="72" height="30" viewBox="0 0 120 40" preserveAspectRatio="none" role="img" aria-label={label} className="shrink-0 fill-brand [filter:drop-shadow(0_0_3px_rgb(255_45_66/0.5))]">
      {last.map((d, i) => {
        const h = Math.max(2, (pick(d) / max) * 40);
        return (
          <rect key={d.date} x={i * pitch} y={40 - h} width={Math.max(1, pitch * 0.6)} height={h} rx={1.2} className="animate-grow-y" style={{ animationDelay: `${200 + i * 18}ms` }}>
            <title>{`${dayLabel(utc(d.date))}: ${count(pick(d))} ${unit}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

/** Twenty squares: the red ones are the share of shipped parcels still on the road. */
function TransitSquares({ inTransit, shipped }: { inTransit: number; shipped: number }) {
  const red = shipped > 0 ? Math.round((inTransit / shipped) * 20) : 0;
  return (
    <svg width="34" height="27" viewBox="0 0 34 27" role="img" aria-label={`${shipped > 0 ? formatPercent(inTransit / shipped, 0) : "0%"} of shipped parcels are still on the road`} className="shrink-0">
      {Array.from({ length: 20 }, (_, i) => (
        <rect key={i} x={(i % 5) * 7} y={(3 - Math.floor(i / 5)) * 7} width={5.5} height={5.5} rx={1.2} fill={i < red ? "#e1182c" : "#ffd3d8"} className="animate-[fade-in_400ms_ease-out_backwards]" style={{ animationDelay: `${200 + i * 30}ms` }} />
      ))}
    </svg>
  );
}

function KpiCard({ label, def, href, linkLabel, children, graphic, sub }: { label: string; def: string; href: string; linkLabel: string; children: React.ReactNode; graphic?: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <Panel className="gap-5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[15px] font-medium text-muted"><Term label={label} definition={def} /></span>
        <CornerLink href={href} label={linkLabel} />
      </div>
      <div className="mt-auto flex items-end gap-3">
        <div className="min-w-0 flex-1">{children}</div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {graphic}
          {sub ? <span className="whitespace-nowrap text-[11px] text-muted">{sub}</span> : null}
        </div>
      </div>
    </Panel>
  );
}

const SIGNAL = { SCALE: ["#e1182c", 4], WATCH: ["#d99a00", 2], BAD_TRAFFIC: ["#d99a00", 1], KILL: ["#141012", 1], INSUFFICIENT_DATA: ["#cfc6c8", 0] } as const;

/** Signal bars and a word for a verdict. */
function VerdictSignal({ verdict }: { verdict: VerdictValue | null }) {
  if (!verdict) return <span className="text-subtle">—</span>;
  const [color, lit] = SIGNAL[verdict];
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      <svg width="18" height="12" viewBox="0 0 18 12" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => <rect key={i} x={i * 5} width={3} height={12} rx={1.5} fill={i < lit ? color : "#e6dfe0"} />)}
      </svg>
      <span className="text-[11px]">{VERDICT_LABEL[verdict]}</span>
    </span>
  );
}

function initials(text: string) {
  const words = text.replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "AD";
  return (words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 3)).toUpperCase();
}

function HealthRow({ icon, label, value, href, tone }: { icon: React.ReactNode; label: string; value: React.ReactNode; href: string; tone?: "negative" | "warning" }) {
  return (
    <Link href={href} className="press group flex items-center gap-3 rounded-2xl px-2 py-2 text-sm hover:bg-surface-2">
      <span className={cn("grid size-8 shrink-0 place-items-center rounded-full bg-surface-3 text-muted [&_svg]:size-4", tone === "negative" && "bg-negative-soft text-negative", tone === "warning" && "bg-warning-soft text-warning")}>{icon}</span>
      <span className="min-w-0 flex-1 text-muted">{label}</span>
      <span className={cn("num text-right font-semibold", tone === "negative" && "text-negative", tone === "warning" && "text-warning")}>{value}</span>
      <ArrowUpRight className="size-3.5 shrink-0 text-subtle transition-[color,translate] duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-brand-strong" aria-hidden="true" />
    </Link>
  );
}

/** Orders placed and delivered per day, week or month, with the best one in red. */
function OverviewChart({ days, fmt }: { days: Day[]; fmt: (v: number) => string }) {
  const { unit, buckets, capped } = bucketize(days);
  const [active, setActive] = React.useState<number | null>(null);
  const top = niceTop(Math.max(0, ...buckets.map((b) => Math.max(b.placed, b.delivered))));
  const best = buckets.reduce((bi, b, i) => (b.delivered > 0 && b.delivered >= (buckets[bi]?.delivered ?? 0) ? i : bi), -1);
  const spend = buckets.reduce((a, b) => a + b.adSpend, 0);
  const shown = active ?? best;
  const word = unit === "Daily" ? "day" : unit === "Weekly" ? "week" : "month";
  return (
    <Panel className="h-full gap-3">
      <PanelTitle action={<span className="whitespace-nowrap rounded-full bg-surface-3 px-3 py-1 text-[11px] font-medium text-muted">{capped ? "Last 12 months" : `${buckets.length} ${word}${buckets.length === 1 ? "" : "s"}`}</span>}>{`${unit} overview`}</PanelTitle>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] border border-[#d8d2d3] bg-[#ebe8e8]" />Orders placed</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] bg-[#b9b0b2]" />Delivered</span>
        {best >= 0 ? <span className="flex items-center gap-1.5 text-brand-strong"><span className="size-2.5 rounded-[3px] bg-brand" />Best {word}</span> : null}
      </div>
      {buckets.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">No orders in this period.</p>
      ) : (
        <>
          <div className="mt-2 flex min-h-44 flex-1 gap-2">
            <div className="relative w-8 shrink-0 text-right text-[10px] text-subtle" aria-hidden="true">
              {[1, 2 / 3, 1 / 3, 0].map((f) => <span key={f} className="absolute right-0 -translate-y-1/2" style={{ top: `${(1 - f) * 100}%` }}>{compact(top * f)}</span>)}
            </div>
            <div className="relative min-h-44 min-w-0 flex-1" onMouseLeave={() => setActive(null)}>
              {[0, 1 / 3, 2 / 3].map((f) => <div key={f} className="absolute inset-x-0 border-t border-[#f1eeee]" style={{ top: `${f * 100}%` }} aria-hidden="true" />)}
              <div className="absolute inset-x-0 bottom-0 border-t border-border" aria-hidden="true" />
              <div className="absolute inset-0 flex items-end gap-[3%]">
                {buckets.map((b, i) => {
                  const hi = i === best;
                  const dim = active !== null && active !== i && "opacity-55";
                  return (
                    <button
                      key={b.label + i}
                      type="button"
                      className="relative h-full min-w-0 flex-1 cursor-default rounded-lg"
                      aria-label={`${b.long}: ${count(b.placed)} orders placed, ${count(b.delivered)} delivered, ${fmt(b.adSpend)} on ads`}
                      onMouseEnter={() => setActive(i)}
                      onFocus={() => setActive(i)}
                      onBlur={() => setActive(null)}
                    >
                      <span
                        className={cn("animate-grow-y absolute inset-x-0 bottom-0 mx-auto max-w-9 rounded-[9px] transition-[height,opacity] duration-500 ease-[var(--ease-out)]", hi ? "[background-image:repeating-linear-gradient(45deg,#c8102e_0_3px,#ff4a5a_3px_7px)] [filter:drop-shadow(0_6px_10px_rgb(225_24_44/0.35))]" : "bg-[#ebe8e8]", dim)}
                        style={{ height: `${Math.max(b.placed > 0 ? 2 : 0, (b.placed / top) * 100)}%`, animationDelay: `${150 + i * 55}ms` }}
                      />
                      <span
                        className={cn("animate-grow-y absolute inset-x-0 bottom-0 mx-auto max-w-9 rounded-[9px] border-t-2 border-surface transition-[height,opacity] duration-500 ease-[var(--ease-out)]", hi ? "bg-brand-deep" : "bg-[#b9b0b2]", dim)}
                        style={{ height: `${Math.max(b.delivered > 0 ? 2 : 0, (b.delivered / top) * 100)}%`, animationDelay: `${250 + i * 55}ms` }}
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="flex gap-[3%] pl-10 text-center text-[10px] text-muted" aria-hidden="true">
            {buckets.map((b, i) => (
              <span key={b.label + i} className={cn("min-w-0 flex-1 whitespace-nowrap", i === best && "font-bold text-brand-strong", buckets.length > 5 && (buckets.length - 1 - i) % 2 === 1 && i !== best && "invisible")}>{b.label}</span>
            ))}
          </div>
          <p className="min-h-4 text-[11px] text-muted" aria-live="polite">
            {shown >= 0 && buckets[shown] ? (
              <>
                <span className="font-semibold text-fg">{buckets[shown].long}</span>: <span className="num">{count(buckets[shown].placed)}</span> placed, <span className="num">{count(buckets[shown].delivered)}</span> delivered, <span className="num">{fmt(buckets[shown].adSpend)}</span> on ads
              </>
            ) : null}
          </p>
        </>
      )}
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-[#f1eeee] pt-3">
        <span className="text-xs text-muted"><Term label="Ad spend" definition={DEF.adSpend} /></span>
        <span className="num text-right text-sm font-bold">{fmt(spend)}</span>
      </div>
    </Panel>
  );
}

/** Shipped parcels as one strip of thin bars: delivered, returned, still on the road, other. */
function ParcelStrip({ delivered, returned, inTransit, other }: { delivered: number; returned: number; inTransit: number; other: number }) {
  const total = delivered + returned + inTransit + other;
  const N = 100;
  const parts = [
    { n: delivered, fill: "url(#dash-red)" },
    { n: returned, fill: "#141012" },
    { n: inTransit, fill: "#e3dcdd" },
    { n: other, fill: "#9c9194" },
  ];
  // Largest remainder, so the bars always add up to N.
  const exact = parts.map((p) => (total > 0 ? (p.n / total) * N : 0));
  const bars = exact.map(Math.floor);
  let left = total > 0 ? N - bars.reduce((a, b) => a + b, 0) : 0;
  for (const [, i] of exact.map((e, i) => [e - Math.floor(e), i] as const).sort((a, b) => b[0] - a[0])) {
    if (left-- > 0) bars[i]++;
  }
  const fills = total > 0 ? parts.flatMap((p, i) => Array.from({ length: bars[i] }, () => p.fill)) : Array.from({ length: N }, () => "#f1eeee");
  const pct = (n: number) => (total > 0 ? formatPercent(n / total, 0) : "0%");
  return (
    <svg viewBox="0 0 640 48" preserveAspectRatio="none" className="block h-12 w-full" role="img" aria-label={`Of ${count(total)} shipped parcels: ${pct(delivered)} delivered, ${pct(returned)} returned, ${pct(inTransit)} still on the road${other ? `, ${pct(other)} lost or exchanged` : ""}`}>
      <defs>
        <linearGradient id="dash-red" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff4a58" /><stop offset="1" stopColor="#b80e1e" /></linearGradient>
      </defs>
      {fills.map((f, i) => <rect key={i} x={i * 6.4} y={0} width={3.6} height={48} rx={1.8} fill={f} className="animate-grow-y" style={{ animationDelay: `${150 + i * 6}ms` }} />)}
    </svg>
  );
}

function RateCard({ title, icon, value, of, caption, rateLabel, rate, def, note }: { title: string; icon: React.ReactNode; value: number; of: number; caption: string; rateLabel: string; rate: number | null; def: string; note?: React.ReactNode }) {
  return (
    <Panel className="gap-3 p-[18px]">
      <span className="text-sm font-semibold">{title}</span>
      <div className="flex items-center gap-3">
        <span className="bg-brand grid size-10 shrink-0 place-items-center rounded-xl shadow-[0_6px_14px_rgb(225_24_44/0.35)] [&_svg]:size-[18px]" aria-hidden="true">{icon}</span>
        <div className="flex min-w-0 flex-col">
          <span className="num truncate text-[15px] font-bold">{count(value)} of {count(of)}</span>
          <span className="truncate text-xs text-muted">{caption}</span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between gap-2 text-[11px] text-muted">
          <Term label={rateLabel} definition={def} />
          <Rate value={rate} className="font-bold text-fg" />
        </div>
        <div className="h-1.5 rounded-full bg-[#f1eeee]">
          <div className="bg-brand-bar animate-grow-x h-1.5 rounded-full shadow-[0_0_8px_rgb(255_45_66/0.6)] transition-[width] duration-700 ease-[var(--ease-out)] [animation-delay:250ms]" style={{ width: `${Math.max(0, Math.min(1, rate ?? 0)) * 100}%` }} />
        </div>
        {note ? <span className="text-[11px] text-muted">{note}</span> : null}
      </div>
    </Panel>
  );
}

export function DashboardView() {
  const trpc = useTRPC();
  const { user } = useShell();
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [preset, setPreset] = React.useState<number | null>(0);
  const [productId, setProductId] = React.useState("");
  const [creativeId, setCreativeId] = React.useState("");
  const [view, setView] = React.useState<RevenueView | "">("");
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const ads = useAdsFilter().filter;
  const { boxRef: presetsRef, pill: presetPill } = useSlidingPill<HTMLDivElement>();
  const facets = useQuery(trpc.orders.facets.queryOptions());
  const ws = useQuery(trpc.workspace.getCurrent.queryOptions());
  const money = useMoney();
  const report = useQuery({
    ...trpc.reports.dashboard.queryOptions({
      from: from ? new Date(`${from}T00:00:00Z`) : undefined,
      to: to ? new Date(`${to}T23:59:59Z`) : undefined,
      productId: productId || undefined,
      creativeId: creativeId || undefined,
      revenueView: view || undefined,
      ads,
    }),
    placeholderData: keepPreviousData,
  });
  const r = report.data;
  const m = r?.metrics;
  const cur = r?.currency ?? "DZD";
  const fmt = (v: number) => money.fmt(v, cur);
  const h = r?.health;
  const target = ws.data?.verdictThresholds.targetPoas ?? 0.3;
  const days = React.useMemo(() => (r ? fillDays(r.series, from, to) : []), [r, from, to]);
  const firstName = user.name.trim().split(/\s+/)[0] || user.name;

  const pickPreset = (n: number) => {
    setPreset(n);
    if (n === 0) {
      setFrom("");
      setTo("");
      return;
    }
    const today = new Date();
    setTo(ymd(today));
    setFrom(ymd(new Date(today.getFullYear(), today.getMonth(), today.getDate() - (n - 1))));
  };

  /** Amounts shown without their code, where the code is already in a column title. */
  const shownCode = money.convert(0, cur).currency;
  const bare = (v: number, signed = false) => {
    const c = money.convert(v, cur);
    return moneyParts(c.minor, c.currency, signed).number;
  };

  const best = r?.topCreatives.find((c) => c.trueNetProfit > 0) ?? null;
  const unpaid = m ? Math.max(0, m.deliveredRevenue - m.remittedCash) : 0;
  const other = m ? Math.max(0, m.shipped - m.delivered - m.returned - m.inTransit) : 0;

  const tips: React.ReactNode[] = [];
  if (m && r) {
    if (m.truePoas !== null) {
      tips.push(
        m.truePoas < target ? (
          <>Your POAS is <b className="text-fg">{m.truePoas.toFixed(2)}</b>, under your <b className="text-fg">{target.toFixed(2)}</b> target. Cut the ads marked Kill first.</>
        ) : (
          <>Your POAS is <b className="text-fg">{m.truePoas.toFixed(2)}</b>, above your <b className="text-fg">{target.toFixed(2)}</b> target. Put more budget on the ads marked Scale.</>
        ),
      );
    }
    const risky = r.wilayas.filter((w) => w.shipped >= 10 && (w.returnRate ?? 0) >= 0.3).sort((a, b) => (b.returnRate ?? 0) - (a.returnRate ?? 0)).slice(0, 2);
    if (risky.length) {
      tips.push(<>{risky.map((w) => w.wilaya).join(" and ")} send{risky.length > 1 ? "" : "s"} back about <b className="text-fg">{Math.round((risky[0].returnRate ?? 0) * 10)} parcels in 10</b>. Confirm those orders twice.</>);
    }
    if (unpaid > 0) tips.push(<><b className="text-fg">{fmt(unpaid)}</b> is delivered but not paid out to you yet.</>);
  }

  const filterField = "h-10 rounded-full border-transparent bg-surface shadow-card";
  const neonButton = "neon shine press flex h-12 items-center justify-center gap-2 rounded-full bg-[linear-gradient(135deg,#ff4254_0%,#d8142a_60%,#a80b1c_100%)] text-[15px] font-bold text-white hover:brightness-110";

  return (
    <>
      <section className="stagger mb-6 flex flex-col gap-3">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="flex min-w-0 flex-col gap-2">
            <span className="text-base text-muted sm:text-lg">Ready to grow your profit?</span>
            <h1 className="break-words text-[30px] font-extrabold leading-tight tracking-[-0.035em] sm:text-[46px]">Welcome back, {firstName}.</h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div ref={presetsRef} data-slide="" role="group" aria-label="Period" className="no-scrollbar relative flex max-w-full gap-0.5 overflow-x-auto rounded-full bg-surface p-1 shadow-card">
              {presetPill}
              {PRESETS.map((p) => (
                <button key={p.days} type="button" aria-pressed={preset === p.days} onClick={() => pickPreset(p.days)} className={cn("slide-item press h-8 whitespace-nowrap rounded-full px-3.5 text-xs font-medium", preset === p.days ? "bg-brand glow" : "text-muted hover:bg-surface-3 hover:text-fg")}>
                  {p.label}
                </button>
              ))}
            </div>
            <button type="button" aria-expanded={filtersOpen} aria-controls="dash-filters" onClick={() => setFiltersOpen((o) => !o)} className={cn("press relative grid size-10 shrink-0 place-items-center rounded-full shadow-card md:hidden", filtersOpen ? "bg-brand glow" : "bg-surface text-fg")} aria-label="More filters">
              <SlidersHorizontal className="size-4" aria-hidden="true" />
              {from || to || productId || creativeId || view ? <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-brand ring-2 ring-surface" /> : null}
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 md:justify-end">
        <AdsFilter />
        <div id="dash-filters" className={cn("flex-wrap items-center gap-2 md:contents", filtersOpen ? "flex" : "hidden")}>
          <div className="flex items-center gap-1.5">
            <Input aria-label="From date" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPreset(null); }} className={cn(filterField, "w-38")} />
            <span className="text-subtle" aria-hidden>→</span>
            <Input aria-label="To date" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPreset(null); }} className={cn(filterField, "w-38")} />
          </div>
          <Select aria-label="Product" value={productId} onChange={(e) => { setProductId(e.target.value); setCreativeId(""); }} className={cn(filterField, "w-40")}>
            <option value="">All products</option>
            {facets.data?.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Select aria-label="Creative" value={creativeId} onChange={(e) => setCreativeId(e.target.value)} className={cn(filterField, "w-40")}>
            <option value="">All creatives</option>
            {facets.data?.creatives.map((c) => <option key={c.id} value={c.id}>{c.externalCreativeId}</option>)}
          </Select>
          <Select aria-label="Revenue basis" value={view || r?.revenueView || "DELIVERED"} onChange={(e) => setView(e.target.value as RevenueView)} className={cn(filterField, "w-52")}>
            <option value="DELIVERED">Delivered revenue view</option>
            <option value="REMITTED">Cash remitted view</option>
          </Select>
        </div>
        </div>
      </section>

      {report.error ? <ErrorState message={errorMessage(report.error)} /> : null}

      <div className={cn("stagger grid grid-cols-1 gap-[18px] transition-opacity duration-300 md:grid-cols-2 xl:grid-cols-4", report.isPlaceholderData && "opacity-60")} aria-busy={report.isFetching}>
        {!m || !r ? (
          <>
            <Skeleton className="h-40 rounded-[22px] md:col-span-2 xl:col-span-1" />
            <Skeleton className="h-40 rounded-[22px]" />
            <Skeleton className="h-40 rounded-[22px]" />
            <Skeleton className="h-80 rounded-[22px] md:col-span-2 xl:col-span-1 xl:row-span-2" />
            <Skeleton className="h-72 rounded-[22px] md:col-span-2 xl:col-span-1" />
            <Skeleton className="h-72 rounded-[22px] md:col-span-2" />
          </>
        ) : (
          <>
            <section className="bg-brand-hero shine relative flex min-w-0 flex-col gap-5 overflow-hidden rounded-[22px] p-5 md:col-span-2 xl:col-span-1 shadow-[0_16px_34px_rgb(204_19_37/0.35),inset_0_1px_0_rgb(255_255_255/0.35)]">
              <span className="pointer-events-none absolute -right-12 -top-16 size-48 rounded-full border-[22px] border-white/10" aria-hidden="true" />
              <div className="relative flex items-center justify-between gap-3">
                <span className="text-[15px] font-semibold"><Term label="True net profit" definition={DEF.trueNetProfit} iconClassName="text-white/70 hover:text-white" /></span>
                <CornerLink href="/creatives" label="Open profit by ad" onRed />
              </div>
              <div className="relative mt-auto flex items-end gap-3">
                <div className="min-w-0 flex-1">
                  <FitMoney value={m.trueNetProfit} currency={cur} max={36} codeClassName="text-white/85" className="[text-shadow:0_2px_14px_rgb(255_170_178/0.55)]" />
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <PoasBlocks poas={m.truePoas} target={target} />
                  <span className="whitespace-nowrap text-[11px]">
                    <Term label={`POAS ${m.truePoas === null ? "—" : m.truePoas.toFixed(2)} / ${target.toFixed(2)}`} definition={`${DEF.truePoas} The dark tick is your target in Settings.`} iconClassName="text-white/70 hover:text-white" />
                  </span>
                </div>
              </div>
              <span className="relative -mt-2 text-[11px] text-white/85">{m.trueNetProfit < 0 ? "Loss" : "Profit"} after ads and every cost, on {m.revenueView === "DELIVERED" ? "delivered revenue" : "cash remitted"}</span>
            </section>

            <KpiCard label="Delivered revenue" def={DEF.deliveredRevenue} href="/orders" linkLabel="Open orders and parcels" graphic={<DayBars days={days} pick={(d) => d.delivered} unit="delivered" label="Delivered parcels per day, by order date" />} sub={`${count(m.delivered)} parcels`}>
              <FitMoney value={m.deliveredRevenue} currency={cur} max={36} />
            </KpiCard>

            <KpiCard label="Cash in transit" def={DEF.cashInTransit} href="/orders" linkLabel="Open orders and parcels" graphic={<TransitSquares inTransit={m.inTransit} shipped={m.shipped} />} sub={`${count(m.inTransit)} parcels`}>
              <FitMoney value={m.cashInTransit} currency={cur} max={36} />
            </KpiCard>

            <div className="flex min-w-0 flex-col gap-[18px] md:col-span-2 md:flex-row xl:col-span-1 xl:row-span-2 xl:flex-col">
              <Panel className="flex-1 gap-4 md:basis-0 xl:basis-auto">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[15px] font-medium text-muted">Best ad right now</span>
                  <CornerLink href="/creatives" label="Open all ads" />
                </div>
                <div className="relative flex flex-1 flex-col pt-[22px]">
                  <div className="absolute left-10 right-0 top-0 h-16 rounded-[22px] bg-[#efeced]" aria-hidden="true" />
                  <div className="absolute left-5 right-0 top-[11px] h-16 rounded-[22px] bg-[#e2dddf]" aria-hidden="true" />
                  <div className="relative flex flex-1 flex-col gap-3.5 overflow-hidden rounded-[22px] bg-ink p-5 text-white shadow-[0_18px_40px_rgb(20_16_18/0.28)]">
                    <span className="pointer-events-none absolute -bottom-24 -right-16 size-56 rounded-full bg-[radial-gradient(circle,rgb(255_40_60/0.55),rgb(255_40_60/0)_70%)]" aria-hidden="true" />
                    {best ? (
                      <>
                        <div className="relative flex items-start justify-between gap-2">
                          <span className="line-clamp-2 min-w-0 break-words text-[22px] font-bold leading-tight tracking-tight">{best.name || `Ad ${best.externalCreativeId}`}</span>
                          {best.verdict ? <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-ink">{VERDICT_LABEL[best.verdict]}</span> : null}
                        </div>
                        <span className="relative line-clamp-2 break-words text-[13px] text-[#d9d0d2]">Ad {best.externalCreativeId} · {count(best.shipped)} parcels shipped</span>
                        <div className="relative grid grid-cols-2 gap-2.5">
                          <div className="flex min-w-0 flex-col gap-0.5"><span className="text-[11px] text-[#bdb2b5]">Profit, {shownCode}</span><FitText max={20} min={12}>{bare(best.trueNetProfit, true)}</FitText></div>
                          <div className="flex min-w-0 flex-col gap-0.5"><span className="text-[11px] text-[#bdb2b5]">POAS</span><FitText max={20} min={12}>{best.truePoas === null ? "—" : best.truePoas.toFixed(2)}</FitText></div>
                        </div>
                        <Link href="/creatives" className={cn(neonButton, "mt-auto")}>
                          <TrendingUp className="size-4" aria-hidden="true" /> Compare every ad
                        </Link>
                      </>
                    ) : (
                      <>
                        <span className="relative text-[22px] font-bold leading-tight">No ad is making money yet</span>
                        <span className="relative text-[13px] text-[#d9d0d2]">Once orders carry the ad ID (utm_content), your best ad shows here.</span>
                        <Link href="/creatives" className={cn(neonButton, "mt-auto")}>Open ads</Link>
                      </>
                    )}
                  </div>
                </div>
              </Panel>
              <Panel className="gap-3 md:flex-1 md:basis-0 xl:flex-none xl:basis-auto">
                <div className="flex items-center gap-2.5">
                  <span className="size-[30px] shrink-0 rounded-full bg-[radial-gradient(circle_at_35%_30%,#ff9aa3_0%,#ff2d42_45%,#9b0718_100%)] shadow-[0_0_16px_rgb(255_45_66/0.75)]" aria-hidden="true" />
                  <h2 className="text-[15px] font-bold">Smart tips</h2>
                </div>
                <ul className="flex flex-col gap-2.5 text-[13px] leading-relaxed text-muted">
                  {tips.length ? tips.map((t, i) => <li key={i}>{t}</li>) : <li>Nothing needs your attention right now.</li>}
                </ul>
              </Panel>
            </div>

            <div className="min-w-0 md:col-span-2 xl:col-span-1">
              <OverviewChart days={days} fmt={fmt} />
            </div>

            <div className="flex min-w-0 flex-col gap-[18px] md:col-span-2">
              <Panel className="gap-3.5">
                <PanelTitle action={<CornerLink href="/orders" label="Open orders and parcels" />}>Order statistics</PanelTitle>
                {m.placed === 0 ? (
                  <EmptyState icon={<Boxes />} title="No orders in this period" description="Change the filters, import orders, or add one manually." />
                ) : (
                  <>
                    <div className="flex flex-wrap items-end justify-between gap-4">
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="text-xs text-muted">Orders placed</span>
                        <div className="flex items-center gap-2.5">
                          <span className="num text-[40px] font-extrabold leading-none">{count(m.placed)}</span>
                          <span className="whitespace-nowrap rounded-full bg-brand-soft px-2.5 py-1 text-[11px] font-bold text-brand-deep"><span className="num">{count(m.shipped)}</span> shipped</span>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                        <span className="flex items-center gap-1.5"><span className="glow-soft size-[9px] rounded-full bg-brand" />Delivered <b className="num text-fg">{count(m.delivered)}</b></span>
                        <span className="flex items-center gap-1.5"><span className="size-[9px] rounded-full bg-ink" />Returned <b className="num text-fg">{count(m.returned)}</b></span>
                        <span className="flex items-center gap-1.5"><span className="size-[9px] rounded-full border border-[#cfc6c8] bg-[#e3dcdd]" />On the road <b className="num text-fg">{count(m.inTransit)}</b></span>
                        {other > 0 ? <span className="flex items-center gap-1.5"><span className="size-[9px] rounded-full bg-[#9c9194]" />Lost or exchanged <b className="num text-fg">{count(other)}</b></span> : null}
                      </div>
                    </div>
                    <ParcelStrip delivered={m.delivered} returned={m.returned} inTransit={m.inTransit} other={other} />
                  </>
                )}
                {m.unknownStatus > 0 || m.missingCostOrders > 0 ? (
                  <p className="flex items-start gap-2 rounded-2xl bg-warning-soft px-3 py-2 text-xs text-warning">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      {m.unknownStatus > 0 ? `${m.unknownStatus} parcels have an unknown carrier status and are not counted as delivered or returned. ` : ""}
                      {m.missingCostOrders > 0 ? `${m.missingCostOrders} orders have no cost version for their date; their COGS is counted as 0.` : ""}
                    </span>
                  </p>
                ) : null}
              </Panel>
              <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2">
                <RateCard title="Confirmed by the call center" icon={<PhoneCall />} value={m.confirmed} of={m.placed} caption="orders confirmed" rateLabel="Confirmation rate" rate={m.confirmationRate} def={DEF.confirmationRate} note={<>Shipping rate <Rate value={m.shippingRate} className="font-semibold text-fg" /></>} />
                <RateCard title="Delivered to the customer" icon={<PackageCheck />} value={m.delivered} of={m.finished} caption="finished parcels delivered" rateLabel="Delivery rate" rate={m.deliveryRate} def={DEF.deliveryRate} note={<>Return rate <Rate value={m.returnRate} className={cn("font-semibold", (m.returnRate ?? 0) > 0.3 ? "text-negative" : "text-fg")} /></>} />
              </div>
            </div>

            <Panel className="gap-3 md:col-span-2">
              <PanelTitle action={<CornerLink href="/creatives" label="Open all ads" />}>Ads list</PanelTitle>
              {r.topCreatives.length === 0 ? (
                <EmptyState title="No ads with orders yet" description="Orders need the ad ID (utm_content) to be linked to an ad." />
              ) : (
                <div className="flex flex-col" role="table" aria-label="Most profitable ads">
                  <div role="row" className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 pb-2 text-xs text-muted sm:grid-cols-[minmax(0,1fr)_104px_56px_112px]">
                    <span role="columnheader">Name</span>
                    <span role="columnheader" className="hidden sm:block">Verdict</span>
                    <span role="columnheader" className="hidden text-right sm:block">POAS</span>
                    <span role="columnheader" className="text-right">Profit, {shownCode}</span>
                  </div>
                  {r.topCreatives.map((c, i) => {
                    const label = c.name || `Ad ${c.externalCreativeId}`;
                    return (
                      <div role="row" key={c.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-[#f4f1f1] py-2 text-[13px] sm:grid-cols-[minmax(0,1fr)_104px_56px_112px]">
                        <span role="cell" className="flex min-w-0 items-center gap-2.5">
                          <span className={cn("grid size-9 shrink-0 place-items-center rounded-full text-[11px] font-extrabold", i === 0 && c.trueNetProfit > 0 ? "bg-brand-hero" : c.trueNetProfit > 0 ? "bg-brand-soft text-brand-deep" : "bg-surface-3 text-muted")} aria-hidden="true">{initials(label)}</span>
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate font-semibold">{label}</span>
                            <span className="truncate font-mono text-[11px] text-subtle">{c.externalCreativeId}</span>
                          </span>
                        </span>
                        <span role="cell" className="hidden sm:block"><VerdictSignal verdict={c.verdict} /></span>
                        <span role="cell" className="hidden text-right font-semibold sm:block"><Ratio value={c.truePoas} /></span>
                        <span role="cell" className="flex min-w-0 justify-end">
                          <span className={cn("num max-w-full truncate rounded-full px-2.5 py-1 text-xs font-bold", c.trueNetProfit < 0 ? "bg-ink text-white" : i === 0 ? "bg-brand glow-soft" : "bg-brand-soft text-brand-deep")}>{bare(c.trueNetProfit, true)}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>

            <Panel className="gap-2.5">
              <PanelTitle action={<span className="text-xs font-semibold text-subtle">{shownCode}</span>}>Where your cash is</PanelTitle>
              {[
                { label: "Collected", sub: m.deliveredRevenue > 0 ? `${formatPercent(m.remittedCash / m.deliveredRevenue, 0)} of delivered` : "Paid out to you", value: m.remittedCash, def: DEF.netCashCollected },
                { label: "On the road", sub: `${count(m.inTransit)} parcels`, value: m.cashInTransit, def: DEF.cashInTransit },
                { label: "Not paid yet", sub: "Delivered, not paid out", value: unpaid, def: "Delivered revenue minus the cash already paid out to you, for orders placed in this period." },
                { label: "Lost on returns", sub: `${count(m.returned)} parcels`, value: -m.rtoLoss, def: DEF.rtoLoss },
              ].map((row, i) => (
                <div key={row.label} className={cn("flex items-center gap-3 rounded-2xl p-3", i === 0 ? "bg-brand glow" : "bg-surface-2")}>
                  <span className={cn("grid size-7 shrink-0 place-items-center rounded-full bg-white text-xs font-extrabold", i === 0 ? "text-brand-strong" : "text-fg")}>{i + 1}</span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[13px] font-semibold"><Term label={row.label} definition={row.def} iconClassName={i === 0 ? "text-white/70 hover:text-white" : undefined} /></span>
                    <span className={cn("truncate text-[11px]", i === 0 ? "text-white/85" : "text-muted")}>{row.sub}</span>
                  </span>
                  <span className={cn("num shrink-0 text-[15px] font-extrabold", row.value < 0 && "text-negative")}>{bare(row.value)}</span>
                </div>
              ))}
            </Panel>

            <Panel className="gap-3">
              <PanelTitle def={DEF.deliveryRate} action={<CornerLink href="#wilayas" label="Open the full wilaya table" />}>Delivery by wilaya</PanelTitle>
              {r.wilayas.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted">No wilaya data yet.</p>
              ) : (
                <ul className="flex flex-col gap-3 text-[13px]">
                  {[...r.wilayas].sort((a, b) => b.shipped - a.shipped).slice(0, 6).map((w, i) => (
                    <li key={w.wilaya} className="flex flex-col gap-1.5">
                      <div className="flex justify-between gap-2"><span className="truncate font-semibold">{w.wilaya}</span><Rate value={w.deliveryRate} className="font-bold" /></div>
                      <div className="h-1.5 rounded-full bg-[#f1eeee]"><div className={cn("animate-grow-x h-1.5 rounded-full transition-[width] duration-700 ease-[var(--ease-out)]", (w.returnRate ?? 0) > 0.3 ? "bg-ink" : "bg-brand-bar")} style={{ width: `${Math.max(0, Math.min(1, w.deliveryRate ?? 0)) * 100}%`, animationDelay: `${250 + i * 60}ms` }} /></div>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-auto flex items-center gap-2 border-t border-[#f1eeee] pt-3 text-[11px] text-muted"><span className="size-2 shrink-0 rounded-full bg-ink" />Black bar: more than 3 parcels in 10 come back.</p>
            </Panel>
          </>
        )}
      </div>

      <div className={cn("stagger mt-[18px] grid grid-cols-1 gap-[18px] transition-opacity duration-300 lg:grid-cols-2 xl:grid-cols-3", report.isPlaceholderData && "opacity-60")}>
        <Card>
          <CardHeader title="Profit breakdown" description={m ? `Revenue basis: ${m.revenueView === "DELIVERED" ? "delivered revenue" : "cash remitted"}` : undefined} />
          <CardBody className="p-3 pt-0">
            {!m ? <Skeleton className="h-48" /> : (
              <dl className="flex flex-col text-sm">
                {[
                  ["Revenue", m.revenue, DEF.deliveredRevenue],
                  ["Ad spend", -m.adSpend, DEF.adSpend],
                  ["COGS", -m.cogs, DEF.cogs],
                  ["Outbound shipping", -m.outboundShipping, "Forward shipping on every shipped parcel (observed carrier fee when available)."],
                  ["RTO fees", -m.rtoCost, "RTO fee on returned parcels."],
                  ["Call center", -m.callCenterCost, "Call-center fee × the configured basis (lead, confirmed order or call attempt)."],
                  ["Packaging", -m.packagingCost, "Packaging fee on every shipped parcel."],
                  ["Overhead", -m.allocatedOverhead, DEF.overhead],
                ].map(([label, v, def]) => (
                  <div key={label as string} className="flex items-center justify-between gap-3 rounded-xl px-2 py-1.5 hover:bg-surface-2">
                    <dt className="text-muted"><Term label={label as string} definition={def as string} /></dt>
                    <dd className={cn("num text-right", (v as number) < 0 ? "text-fg" : "text-positive")}>{fmt(v as number)}</dd>
                  </div>
                ))}
                <div className="mt-1 flex items-center justify-between gap-3 rounded-xl bg-brand-soft px-2 py-2 font-bold">
                  <dt>True net profit</dt>
                  <dd className={cn("num text-right", m.trueNetProfit < 0 ? "text-negative" : "text-positive")}>{fmt(m.trueNetProfit)}</dd>
                </div>
                <div className="flex items-center justify-between gap-3 px-2 pt-2 text-xs text-muted">
                  <dt><Term label="Cost per delivered order" definition={DEF.cpdo} /></dt>
                  <dd><Money value={m.cpdo} currency={cur} /></dd>
                </div>
              </dl>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Worst RTO ads" description="Cheap orders that come back cost twice." />
          {!r ? <Skeleton className="m-4 h-40" /> : r.worstRtoCreatives.length === 0 ? <EmptyState title="No shipped parcels yet" /> : (
            <Table>
              <THead><tr><Th>Ad</Th><Th className="text-right">RTO</Th><Th className="text-right">Returned</Th></tr></THead>
              <tbody>
                {r.worstRtoCreatives.map((c) => (
                  <Tr key={c.key}>
                    <Td className="font-mono text-xs">{c.externalCreativeId} {c.belowSample ? <Badge className="ml-1" title="Fewer shipped parcels than the BAD TRAFFIC threshold">small n</Badge> : null}</Td>
                    <Td className="text-right"><Rate value={c.returnRate} className={(c.returnRate ?? 0) > 0.3 ? "font-semibold text-negative" : undefined} /></Td>
                    <Td className="num text-right text-muted">{c.returned}/{c.shipped}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card className="lg:col-span-2 xl:col-span-1">
          <CardHeader title="Data health" description="What could make these numbers wrong." />
          <CardBody className="flex flex-col gap-0.5 p-3 pt-0">
            {!h ? <Skeleton className="h-40" /> : (
              <>
                <HealthRow icon={<Link2Off />} label="MDM connection" value={h.connectionStatus === "CONNECTED" ? `synced ${timeAgo(h.lastSuccessfulSyncAt)}` : h.connectionStatus.replace("_", " ").toLowerCase()} href="/settings?tab=mdm" tone={h.connectionStatus === "CONNECTED" ? undefined : "warning"} />
                <HealthRow icon={<Unlink />} label="Unmatched records" value={h.unmatchedRecords} href="/syncs" tone={h.unmatchedRecords ? "negative" : undefined} />
                <HealthRow icon={<AlertTriangle />} label="Unknown parcel statuses" value={h.unknownStatusParcels} href="/orders?parcelStatus=UNKNOWN" tone={h.unknownStatusParcels ? "negative" : undefined} />
                <HealthRow icon={<FileWarning />} label="Import / sync errors" value={h.importRowErrors + h.failedSyncItems} href="/imports" tone={h.importRowErrors + h.failedSyncItems ? "warning" : undefined} />
                <HealthRow icon={<FileWarning />} label="Unmatched ad spend rows" value={h.unmatchedSpendRows} href="/creatives" tone={h.unmatchedSpendRows ? "warning" : undefined} />
                <HealthRow icon={<FileWarning />} label="Bank rows awaiting review" value={h.pendingBankRows} href="/expenses" tone={h.pendingBankRows ? "warning" : undefined} />
                <p className="px-2 pt-2 text-[11px] text-subtle">Last successful MDM sync: {formatDateTime(h.lastSuccessfulSyncAt)}</p>
              </>
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-[18px] scroll-mt-24" id="wilayas">
        <CardHeader title="By wilaya" description="Contribution before ads = revenue − COGS − shipping − RTO − call center − packaging. Ad spend is not split by wilaya." />
        {!r ? <Skeleton className="m-4 h-40" /> : r.wilayas.length === 0 ? <EmptyState title="No wilaya data" /> : (
          <Table>
            <THead><tr><Th>Wilaya</Th><Th className="text-right">Placed</Th><Th className="text-right">Shipped</Th><Th className="text-right">Delivery rate</Th><Th className="text-right">RTO rate</Th><Th className="text-right">Delivered revenue</Th><Th className="text-right">Contribution before ads</Th></tr></THead>
            <tbody>
              {r.wilayas.map((w) => (
                <Tr key={w.wilaya}>
                  <Td>{w.wilaya}</Td>
                  <Td className="num text-right">{w.placed}</Td>
                  <Td className="num text-right">{w.shipped}</Td>
                  <Td className="text-right"><Rate value={w.deliveryRate} /></Td>
                  <Td className="text-right"><Rate value={w.returnRate} className={(w.returnRate ?? 0) > 0.3 ? "text-negative" : undefined} /></Td>
                  <Td className="text-right"><Money value={w.deliveredRevenue} currency={cur} /></Td>
                  <Td className="text-right"><Money value={w.contributionBeforeAds} currency={cur} signed /></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
