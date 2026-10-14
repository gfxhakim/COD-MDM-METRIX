"use client";

/**
 * The Profit tracker's charts, drawn with plain elements in the app's red and white: thin marks
 * with rounded ends, a light grid, a tooltip on every mark, and every amount also written out in
 * text next to the chart, so color is never the only clue.
 */
import * as React from "react";
import { cn, formatPercent } from "@/lib/utils";

const DAY_MS = 86_400_000;
const utc = (date: string) => Date.parse(`${date}T00:00:00Z`);
const dayLabel = (t: number, withYear = false) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" });

/** A round step for an axis: the top of the scale for `max`, in three steps. */
function niceStep(max: number) {
  if (max <= 0) return 1;
  const raw = max / 3;
  const p = 10 ** Math.floor(Math.log10(raw));
  return ([1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((k) => k * p).find((s) => s >= raw) ?? 10 * p);
}

function Tip({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div role="tooltip" className={cn("pointer-events-none absolute z-20 w-max max-w-[15rem] rounded-xl bg-ink px-3 py-2 text-[11px] leading-snug text-white shadow-[0_10px_24px_rgb(20_16_18/0.3)]", className)} style={style}>
      {children}
    </div>
  );
}

// ─────────────────────────── Where the price of one order goes ───────────────────────────

export type SplitPart = { key: string; label: string; amount: number; color: string };

/**
 * One delivered order's price as a single bar: each cost a segment, the profit last in green.
 * When the costs are more than the price, the bar is the costs and a line marks the price.
 */
export function PriceSplit({ parts, price, profit, fmt, label }: { parts: SplitPart[]; price: number; profit: number; fmt: (v: number) => string; label: string }) {
  const [active, setActive] = React.useState<string | null>(null);
  const costs = parts.filter((p) => p.amount > 0);
  const shown = profit > 0 ? [...costs, { key: "profit", label: "Profit", amount: profit, color: "#0d7a3e" }] : costs;
  const total = Math.max(price, costs.reduce((a, p) => a + p.amount, 0), 1);
  const pct = (v: number) => (v / total) * 100;
  return (
    <figure className="flex flex-col gap-3" aria-label={label}>
      <div className="relative" onMouseLeave={() => setActive(null)}>
        <div className="flex h-11 w-full gap-[2px] overflow-hidden rounded-[14px] bg-surface-3" role="img" aria-label={`${label}: ${shown.map((p) => `${p.label} ${fmt(p.amount)}`).join(", ")}`}>
          {shown.map((p, i) => (
            <span
              key={p.key}
              tabIndex={0}
              aria-label={`${p.label}: ${fmt(p.amount)}, ${formatPercent(price > 0 ? p.amount / price : null, 0)} of the price`}
              onMouseEnter={() => setActive(p.key)}
              onFocus={() => setActive(p.key)}
              onBlur={() => setActive(null)}
              className={cn("animate-grow-x h-full outline-none transition-opacity duration-200", active && active !== p.key && "opacity-45", i === 0 && "rounded-s-[14px]", i === shown.length - 1 && "rounded-e-[14px]")}
              style={{ width: `${pct(p.amount)}%`, background: p.key === "profit" ? "linear-gradient(180deg,#14a453,#0b6a35)" : p.color, animationDelay: `${120 + i * 70}ms` }}
            />
          ))}
        </div>
        {total > price && price > 0 ? (
          <span className="absolute inset-y-[-6px] w-0.5 rounded-full bg-ink" style={{ insetInlineStart: `${pct(price)}%` }} aria-hidden="true">
            <span className="absolute -top-5 -translate-x-1/2 whitespace-nowrap text-[10px] font-semibold text-fg">Price</span>
          </span>
        ) : null}
        {active ? (() => {
          let start = 0;
          for (const p of shown) {
            if (p.key === active) break;
            start += p.amount;
          }
          const p = shown.find((x) => x.key === active)!;
          return (
            <Tip className="bottom-[calc(100%+8px)] -translate-x-1/2" style={{ insetInlineStart: `${Math.min(85, Math.max(15, pct(start + p.amount / 2)))}%` }}>
              <b>{p.label}</b>: {fmt(p.amount)} · {formatPercent(price > 0 ? p.amount / price : null, 0)} of the price
            </Tip>
          );
        })() : null}
      </div>
      <figcaption>
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px] sm:grid-cols-3">
          {shown.map((p) => (
            <li key={p.key} className={cn("flex min-w-0 items-center gap-2 transition-opacity", active && active !== p.key && "opacity-50")}>
              <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: p.color }} aria-hidden="true" />
              <span className="min-w-0 text-muted leading-tight">{p.label}</span>
              <span className="num ms-auto shrink-0 font-semibold">{formatPercent(price > 0 ? p.amount / price : null, 0)}</span>
            </li>
          ))}
        </ul>
        {profit <= 0 ? <p className="mt-2 text-[12px] font-semibold text-negative">The costs are more than the price: each delivered order loses {fmt(-profit)}.</p> : null}
      </figcaption>
    </figure>
  );
}

// ─────────────────────────── Profit by day, week or month ───────────────────────────

export type ProfitDay = { date: string; placed: number; delivered: number; returned: number; inTransit: number; revenue: number; costs: number; adSpend: number; profit: number };

type Bucket = ProfitDay & { label: string; long: string };

/** Space between bars: about a third of each slot, so many bars stay wide enough to see. */
const gap = (n: number) => `${Math.min(3, 33 / Math.max(1, n))}%`;

/** Days, or weeks past a month, or months past half a year; zeros where nothing happened. */
function bucketize(days: ProfitDay[], from?: string, to?: string): { unit: "day" | "week" | "month"; buckets: Bucket[] } {
  if (days.length === 0) return { unit: "day", buckets: [] };
  const start = utc(from || days[0].date);
  const end = utc(to || days[days.length - 1].date);
  const byDate = new Map(days.map((d) => [d.date, d]));
  const all: ProfitDay[] = [];
  for (let t = start; t <= end && all.length < 3700; t += DAY_MS) {
    const date = new Date(t).toISOString().slice(0, 10);
    all.push(byDate.get(date) ?? { date, placed: 0, delivered: 0, returned: 0, inTransit: 0, revenue: 0, costs: 0, adSpend: 0, profit: 0 });
  }
  const unit = all.length <= 31 ? "day" : all.length <= 26 * 7 ? "week" : "month";
  const years = new Set(all.map((d) => d.date.slice(0, 4))).size;
  const groups = new Map<string, Bucket>();
  for (const d of all) {
    const t = utc(d.date);
    let key = d.date;
    let label = dayLabel(t);
    let long = dayLabel(t, true);
    if (unit === "week") {
      const first = start + Math.floor((t - start) / (7 * DAY_MS)) * 7 * DAY_MS;
      key = String(first);
      label = dayLabel(first);
      long = `Week of ${dayLabel(first, true)}`;
    } else if (unit === "month") {
      key = d.date.slice(0, 7);
      label = new Date(t).toLocaleDateString("en-US", { month: "short", ...(years > 1 ? { year: "2-digit" } : {}), timeZone: "UTC" });
      long = new Date(t).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    }
    const b = groups.get(key) ?? groups.set(key, { ...d, placed: 0, delivered: 0, returned: 0, inTransit: 0, revenue: 0, costs: 0, adSpend: 0, profit: 0, label, long }).get(key)!;
    b.placed += d.placed;
    b.delivered += d.delivered;
    b.returned += d.returned;
    b.inTransit += d.inTransit;
    b.revenue += d.revenue;
    b.costs += d.costs;
    b.adSpend += d.adSpend;
    b.profit += d.profit;
  }
  return { unit, buckets: [...groups.values()] };
}

/**
 * Real profit of the orders placed each day (week, month): what their delivered parcels collected,
 * minus their costs and that day's ad spend. Green above zero, red below; a striped bar still has
 * parcels on the road, so its profit can still change.
 */
export function ProfitByDay({ days, from, to, fmt, tick }: { days: ProfitDay[]; from?: string; to?: string; fmt: (v: number) => string; tick: (v: number) => string }) {
  const { unit, buckets } = bucketize(days, from, to);
  const [active, setActive] = React.useState<number | null>(null);
  if (buckets.length === 0) return <p className="py-10 text-center text-sm text-muted">No orders or ad spend in these days.</p>;
  const hi = Math.max(0, ...buckets.map((b) => b.profit));
  const lo = Math.min(0, ...buckets.map((b) => b.profit));
  const step = niceStep(Math.max(hi, -lo));
  const top = Math.ceil(hi / step) * step;
  const bottom = Math.floor(lo / step) * step;
  const span = top - bottom || 1;
  const y = (v: number) => ((top - v) / span) * 100;
  const ticks: number[] = [];
  for (let v = top; v >= bottom - 1e-9; v -= step) ticks.push(v);
  const total = buckets.reduce((a, b) => a + b.profit, 0);
  const label = `Profit by ${unit}: ${fmt(total)} in total over ${buckets.length} ${unit}s`;
  return (
    <figure className="flex flex-col gap-2" aria-label={label}>
      <div className="flex h-56 gap-2">
        <div className="relative w-12 shrink-0 text-end text-[10px] text-subtle" aria-hidden="true">
          {ticks.map((v) => <span key={v} className="absolute end-0 -translate-y-1/2" style={{ top: `${y(v)}%` }}>{tick(v)}</span>)}
        </div>
        <div className="relative min-w-0 flex-1" onMouseLeave={() => setActive(null)} role="img" aria-label={label}>
          {ticks.map((v) => <div key={v} className={cn("absolute inset-x-0 border-t", v === 0 ? "border-border-strong" : "border-dashed border-[#f1eeee]")} style={{ top: `${y(v)}%` }} aria-hidden="true" />)}
          <div className="absolute inset-0 flex px-0.5" style={{ gap: gap(buckets.length) }}>
            {buckets.map((b, i) => {
              const up = b.profit >= 0;
              const h = (Math.abs(b.profit) / span) * 100;
              const pending = b.inTransit > 0;
              return (
                <button
                  key={b.label + i}
                  type="button"
                  className="relative h-full min-w-0 flex-1 cursor-default rounded-md outline-none"
                  aria-label={`${b.long}: profit ${fmt(b.profit)}, ${b.placed} orders placed, ${b.delivered} delivered${pending ? `, ${b.inTransit} still on the road` : ""}, ${fmt(b.adSpend)} on ads`}
                  onMouseEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                >
                  {b.profit !== 0 ? (
                    <span
                      className={cn(
                        "animate-grow-y absolute inset-x-0 mx-auto max-w-8 transition-opacity duration-200",
                        up ? "origin-bottom rounded-t-[6px] bg-[linear-gradient(180deg,#19b45c,#0b6a35)]" : "origin-top rounded-b-[6px] bg-[linear-gradient(0deg,#ff4254,#b91c1c)]",
                        pending && (up ? "[background-image:repeating-linear-gradient(45deg,#0d7a3e_0_3px,#5fcf8f_3px_7px)]" : "[background-image:repeating-linear-gradient(45deg,#b91c1c_0_3px,#ff8a95_3px_7px)]"),
                        active !== null && active !== i && "opacity-45",
                      )}
                      style={{ top: up ? `${y(b.profit)}%` : `${y(0)}%`, height: `${Math.max(1.2, h)}%`, animationDelay: `${120 + i * 30}ms` }}
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
          {active !== null && buckets[active] ? (
            <Tip className="top-1 -translate-x-1/2" style={{ insetInlineStart: `${Math.min(80, Math.max(20, ((active + 0.5) / buckets.length) * 100))}%` }}>
              <b className="block text-[12px]">{buckets[active].long}</b>
              <span className={cn("num block font-bold", buckets[active].profit < 0 ? "text-[#ff9aa3]" : "text-[#7be3a6]")}>Profit {fmt(buckets[active].profit)}</span>
              <span className="block text-white/80">{buckets[active].placed} placed · {buckets[active].delivered} delivered{buckets[active].inTransit ? ` · ${buckets[active].inTransit} on the road` : ""}</span>
              <span className="block text-white/80">Collected {fmt(buckets[active].revenue)} · costs {fmt(buckets[active].costs)} · ads {fmt(buckets[active].adSpend)}</span>
            </Tip>
          ) : null}
        </div>
      </div>
      <div className="flex ps-14 text-center text-[10px] text-muted" style={{ gap: gap(buckets.length) }} aria-hidden="true">
        {buckets.map((b, i) => (
          <span key={b.label + i} className={cn("min-w-0 flex-1 whitespace-nowrap", buckets.length > 8 && i % Math.ceil(buckets.length / 8) !== 0 && "invisible")}>{b.label}</span>
        ))}
      </div>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] bg-positive" aria-hidden="true" />Profit</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] bg-negative" aria-hidden="true" />Loss</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] [background-image:repeating-linear-gradient(45deg,#0d7a3e_0_2px,#5fcf8f_2px_4px)]" aria-hidden="true" />Parcels still on the road: can still change</span>
      </figcaption>
    </figure>
  );
}

// ─────────────────────────── Campaigns side by side ───────────────────────────

export type CampaignBar = { id: string; name: string; value: number | null; note: string };

/**
 * Ad cost per delivered order for each campaign, longest bar on top, with a line at the most a
 * delivered order can pay for ads. Bars past the line lose money on each delivered order.
 */
export function CampaignBars({ rows, limit, fmt }: { rows: CampaignBar[]; limit: number | null; fmt: (v: number) => string }) {
  const [active, setActive] = React.useState<string | null>(null);
  const known = rows.filter((r): r is CampaignBar & { value: number } => r.value !== null).sort((a, b) => b.value - a.value);
  const unknown = rows.filter((r) => r.value === null);
  if (known.length === 0) return <p className="py-6 text-center text-sm text-muted">Not enough confirmed and delivered orders yet to compare campaigns.</p>;
  const max = Math.max(...known.map((r) => r.value), limit !== null && limit > 0 ? limit : 0) * 1.04 || 1;
  const x = (v: number) => (Math.max(0, v) / max) * 100;
  return (
    <figure className="flex flex-col gap-3" aria-label="Ad cost per delivered order, by campaign">
      <ul className="relative flex flex-col gap-3" onMouseLeave={() => setActive(null)}>
        {limit !== null && limit > 0 ? (
          <li aria-hidden="true" className="pointer-events-none absolute inset-y-[-4px] end-[6rem] start-0 sm:start-[12.75rem]">
            <span className="absolute inset-y-0 border-s-2 border-dashed border-ink/60" style={{ insetInlineStart: `${x(limit)}%` }} />
          </li>
        ) : null}
        {known.map((r, i) => {
          const over = limit !== null && r.value > limit;
          return (
            <li key={r.id} className="grid grid-cols-1 items-center gap-1 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-3">
              <span className="min-w-0 truncate text-[12px] font-semibold" title={r.name}>{r.name}</span>
              <span
                className="relative grid h-7 grid-cols-[minmax(0,1fr)_5.5rem] items-center gap-2 outline-none"
                tabIndex={0}
                aria-label={`${r.name}: ${fmt(r.value)} of ads per delivered order. ${r.note}${over ? ". More than a delivered order can pay." : ""}`}
                onMouseEnter={() => setActive(r.id)}
                onFocus={() => setActive(r.id)}
                onBlur={() => setActive(null)}
              >
                <span className="flex min-w-0">
                  <span
                    className={cn("animate-grow-x h-3.5 rounded-e-full rounded-s-[4px] transition-opacity duration-200", over ? "bg-[linear-gradient(90deg,#3a3335,#141012)]" : "bg-brand-bar glow-soft", active && active !== r.id && "opacity-45")}
                    style={{ width: `${Math.max(1.5, x(r.value))}%`, animationDelay: `${120 + i * 60}ms` }}
                  />
                </span>
                <span className={cn("num whitespace-nowrap text-[12px] font-bold", over && "text-negative")}>{fmt(r.value)}</span>
                {active === r.id ? <Tip className="bottom-[calc(100%+4px)] start-0">{r.note}</Tip> : null}
              </span>
            </li>
          );
        })}
      </ul>
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-full bg-brand-bar" aria-hidden="true" />Earns money</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-full bg-ink" aria-hidden="true" />Loses money on each delivered order</span>
        {limit !== null && limit > 0 ? <span className="flex items-center gap-1.5"><span className="h-3 border-s-2 border-dashed border-ink/60" aria-hidden="true" />Most a delivered order can pay: <b className="num text-fg">{fmt(limit)}</b></span> : null}
        {unknown.length ? <span>{unknown.length} campaign{unknown.length === 1 ? " has" : "s have"} no confirmed or delivered orders yet.</span> : null}
      </figcaption>
    </figure>
  );
}

// ─────────────────────────── From orders placed to delivered ───────────────────────────

export type FunnelStep = { label: string; value: number; rate: number | null; rateLabel?: string };

/** Orders placed, confirmed, shipped and delivered as shrinking bars, each with the share it keeps. */
export function OrderFunnel({ steps }: { steps: FunnelStep[] }) {
  const max = Math.max(1, ...steps.map((s) => s.value));
  return (
    <ol className="flex flex-col gap-2.5" aria-label="Orders from placed to delivered">
      {steps.map((s, i) => (
        <li key={s.label} className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-3">
          <span className="text-[12px] text-muted">{s.label}</span>
          <span className="flex min-w-0 items-center gap-2">
            <span className="animate-grow-x h-6 rounded-e-[8px] rounded-s-[4px] bg-brand-bar" style={{ width: `${Math.max(1.5, (s.value / max) * 100)}%`, opacity: 1 - i * 0.14, animationDelay: `${120 + i * 80}ms` }} aria-hidden="true" />
            <span className="num shrink-0 whitespace-nowrap text-[13px] font-bold">{s.value.toLocaleString("en-US")}</span>
            {s.rate !== null && i > 0 ? <span className="shrink-0 whitespace-nowrap rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand-strong">{formatPercent(s.rate, 0)}{s.rateLabel ? ` ${s.rateLabel}` : ""}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}
