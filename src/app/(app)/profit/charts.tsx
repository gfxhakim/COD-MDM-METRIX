"use client";

/**
 * The Profit tracker's charts, in the app's red and white: thin marks with 4px rounded ends on a
 * single baseline, hairline grids, a tooltip on every mark, a legend wherever there are two kinds
 * of mark, and every amount also written out (labels, tooltips or a table), so color is never the
 * only clue. Colors were checked for color blindness (delivered, on the road and returned side by
 * side); orders not finished yet are striped, a second clue besides color.
 */
import Link from "next/link";
import * as React from "react";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { HelpTip } from "@/components/ui/tooltip";
import { useT } from "@/i18n/client";
import type { TFunction } from "@/i18n/core";
import { cn, formatPercent } from "@/lib/utils";

/** Delivered, on the road, returned, lost: checked side by side for color blindness. */
export const STATE_COLORS = { delivered: "#0d7a3e", road: "#2a78d6", returned: "#e2462f", lost: "#8c8285" } as const;
const PROFIT = "#0d7a3e";
const LOSS = "#e2462f";
/** Diagonal stripes of a color: what isn't finished yet. */
export const stripes = (color: string) => `repeating-linear-gradient(135deg, ${color} 0 3px, color-mix(in srgb, ${color} 28%, white) 3px 6px)`;

const DAY_MS = 86_400_000;
const utc = (date: string) => Date.parse(`${date}T00:00:00Z`);
/** A day (in UTC milliseconds) written out with these Intl options, in the picked language. */
type DayFormat = (ms: number, opts: Intl.DateTimeFormatOptions) => string;
const dayLabel = (day: DayFormat, ms: number, withYear = false) => day(ms, { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}) });

/** A round step for an axis: the top of the scale for `max`, in about three steps. */
function niceStep(max: number) {
  if (max <= 0) return 1;
  const raw = max / 3;
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((k) => k * p).find((s) => s >= raw) ?? 10 * p;
}

/** A vertical scale from the lowest value (or 0) to the highest (or 0), in round steps. */
function scale(values: number[]) {
  const hi = Math.max(0, ...values);
  const lo = Math.min(0, ...values);
  const step = niceStep(Math.max(hi, -lo));
  const top = Math.ceil(hi / step) * step || step;
  const bottom = Math.floor(lo / step) * step;
  const span = top - bottom || 1;
  const ticks: number[] = [];
  for (let v = top; v >= bottom - 1e-9; v -= step) ticks.push(Math.round(v));
  return { y: (v: number) => ((top - v) / span) * 100, ticks };
}

function Tip({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div role="tooltip" className={cn("pointer-events-none absolute z-20 w-max max-w-[16rem] rounded-xl bg-ink px-3 py-2 text-[11px] leading-snug text-white shadow-[0_10px_24px_rgb(20_16_18/0.3)]", className)} style={style}>
      {children}
    </div>
  );
}

/** A small segmented choice above a chart. */
export function ChartViews<K extends string>({ views, value, onChange, label }: { views: { key: K; label: string }[]; value: K; onChange: (k: K) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex w-fit max-w-full overflow-x-auto rounded-full bg-surface-2 p-1 ring-1 ring-border/70">
      {views.map((v) => (
        <button key={v.key} type="button" aria-pressed={value === v.key} onClick={() => onChange(v.key)} className={cn("press whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition-colors", value === v.key ? "bg-brand text-white glow-soft" : "text-muted hover:text-fg")}>
          {v.label}
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────── Profit by day, week or month ───────────────────────────

export type ProfitDay = { date: string; placed: number; delivered: number; returned: number; open: number; revenue: number; costs: number; adSpend: number; profit: number; expected: number };
type Bucket = ProfitDay & { label: string; long: string };
const EMPTY = { placed: 0, delivered: 0, returned: 0, open: 0, revenue: 0, costs: 0, adSpend: 0, profit: 0, expected: 0 };

/** Days, or weeks past a month, or months past half a year; zeros where nothing happened. */
function bucketize(days: ProfitDay[], day: DayFormat, t: TFunction, from?: string, to?: string): { unit: "day" | "week" | "month"; buckets: Bucket[] } {
  if (days.length === 0) return { unit: "day", buckets: [] };
  const start = utc(from || days[0].date);
  const end = utc(to || days[days.length - 1].date);
  const byDate = new Map(days.map((d) => [d.date, d]));
  const all: ProfitDay[] = [];
  for (let ms = start; ms <= end && all.length < 3700; ms += DAY_MS) {
    const date = new Date(ms).toISOString().slice(0, 10);
    all.push(byDate.get(date) ?? { date, ...EMPTY });
  }
  const unit = all.length <= 31 ? "day" : all.length <= 26 * 7 ? "week" : "month";
  const years = new Set(all.map((d) => d.date.slice(0, 4))).size;
  const groups = new Map<string, Bucket>();
  for (const d of all) {
    const ms = utc(d.date);
    let key = d.date;
    let label = dayLabel(day, ms);
    let long = dayLabel(day, ms, true);
    if (unit === "week") {
      const first = start + Math.floor((ms - start) / (7 * DAY_MS)) * 7 * DAY_MS;
      key = String(first);
      label = dayLabel(day, first);
      long = t("Week of {date}", { date: dayLabel(day, first, true) });
    } else if (unit === "month") {
      key = d.date.slice(0, 7);
      label = day(ms, { month: "short", ...(years > 1 ? { year: "2-digit" } : {}) });
      long = day(ms, { month: "long", year: "numeric" });
    }
    const b = groups.get(key) ?? groups.set(key, { date: d.date, ...EMPTY, label, long }).get(key)!;
    for (const k of Object.keys(EMPTY) as (keyof typeof EMPTY)[]) b[k] += d[k];
  }
  return { unit, buckets: [...groups.values()] };
}

/**
 * A bar is the day's profit with what its open orders should still bring. When real and expected
 * pull the same way, the real part is solid and the rest striped; otherwise the whole bar depends on
 * orders not finished yet, so all of it is striped.
 */
function barParts(b: Bucket) {
  const total = b.profit + b.expected;
  const solid = b.expected === 0 ? total : b.profit !== 0 && Math.sign(b.profit) === Math.sign(b.expected) ? b.profit : 0;
  return { total, solid };
}

type DaysView = "bars" | "running" | "table";

/**
 * Profit of the orders placed each day (week, month): what their delivered parcels collected,
 * minus their costs and that day's ads, plus what their orders not finished yet should bring
 * (striped). "Running total" adds the days up; "Table" writes every number out.
 */
export function ProfitByDay({ days, from, to, fmt, tick }: { days: ProfitDay[]; from?: string; to?: string; fmt: (v: number) => string; tick: (v: number) => string }) {
  const { t, date, locale } = useT();
  const day: DayFormat = (ms, opts) => (locale === "en" ? new Date(ms).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" }) : date(new Date(ms), { ...opts, timeZone: "UTC" }));
  const { unit, buckets } = bucketize(days, day, t, from, to);
  const [view, setView] = React.useState<DaysView>("bars");
  const [active, setActive] = React.useState<number | null>(null);
  if (buckets.length === 0) return <p className="py-10 text-center text-sm text-muted">{t("No orders or ad spend in these days.")}</p>;

  const views: { key: DaysView; label: string }[] = [
    { key: "bars", label: unit === "day" ? t("Each day") : unit === "week" ? t("Each week") : t("Each month") },
    { key: "running", label: t("Running total") },
    { key: "table", label: t("Table") },
  ];
  const totals = buckets.map((b) => b.profit + b.expected);
  const running: { real: number; total: number }[] = [];
  let real = 0;
  let total = 0;
  for (const b of buckets) {
    real += b.profit;
    total += b.profit + b.expected;
    running.push({ real, total });
  }
  const { y, ticks } = scale(view === "running" ? running.flatMap((r) => [r.real, r.total]) : totals);
  const n = buckets.length;
  const x = (i: number) => ((i + 0.5) / n) * 100;
  const vars = { total: fmt(total), n };
  const label = unit === "day" ? t("Profit by day: {total} in total over {n} days", vars) : unit === "week" ? t("Profit by week: {total} in total over {n} weeks", vars) : t("Profit by month: {total} in total over {n} months", vars);
  const hasOpen = buckets.some((b) => b.expected !== 0);
  const b = active !== null ? buckets[active] : null;

  return (
    <figure className="flex min-w-0 flex-col gap-3" aria-label={label}>
      <ChartViews views={views} value={view} onChange={(v) => { setView(v); setActive(null); }} label={t("How to show the days")} />
      {view === "table" ? (
        <div className="max-h-80 overflow-auto rounded-2xl ring-1 ring-border/70">
          <Table>
            <THead>
              <tr>
                <Th>{unit === "day" ? t("Day") : unit === "week" ? t("Week") : t("Month")}</Th>
                <Th className="text-end">{t("Orders")}</Th>
                <Th className="text-end">{t("Delivered")}</Th>
                <Th className="text-end">{t("Not finished")}</Th>
                <Th className="text-end">{t("Ads")}</Th>
                <Th className="text-end">{t("Real profit")}</Th>
                <Th className="text-end">{t("Still expected")}</Th>
                <Th className="text-end">{t("Profit")}</Th>
              </tr>
            </THead>
            <tbody>
              {buckets.map((r, i) => (
                <Tr key={r.label + i}>
                  <Td className="whitespace-nowrap">{r.long}</Td>
                  <Td className="num text-end">{r.placed}</Td>
                  <Td className="num text-end">{r.delivered}</Td>
                  <Td className="num text-end">{r.open}</Td>
                  <Td className="num text-end">{fmt(r.adSpend)}</Td>
                  <Td className={cn("num text-end", r.profit < 0 && "text-negative")}>{fmt(r.profit)}</Td>
                  <Td className="num text-end text-muted">{r.expected ? fmt(r.expected) : "—"}</Td>
                  <Td className={cn("num text-end font-bold", totals[i] < 0 ? "text-negative" : "text-positive")}>{fmt(totals[i])}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      ) : (
        <>
          <div className="flex h-60 gap-2">
            <div className="relative w-11 shrink-0 text-end text-[10px] text-subtle" aria-hidden="true">
              {ticks.map((v) => <span key={v} className="num absolute end-0 -translate-y-1/2" style={{ top: `${y(v)}%` }}>{tick(v)}</span>)}
            </div>
            <div className="relative min-w-0 flex-1" onMouseLeave={() => setActive(null)} role="img" aria-label={label}>
              {ticks.map((v) => <div key={v} className={cn("absolute inset-x-0 border-t", v === 0 ? "border-border-strong" : "border-[#f1eeee]")} style={{ top: `${y(v)}%` }} aria-hidden="true" />)}
              {view === "running" ? <RunningLines running={running} y={y} x={x} /> : null}
              <div className="absolute inset-0 flex">
                {buckets.map((r, i) => {
                  const p = barParts(r);
                  const up = p.total >= 0;
                  const color = up ? PROFIT : LOSS;
                  const top = up ? y(p.total) : y(0);
                  const height = Math.abs(y(p.total) - y(0));
                  const solid = Math.min(height, Math.abs(y(p.solid) - y(0)));
                  const striped = height - solid > 0.05;
                  return (
                    <button
                      key={r.label + i}
                      type="button"
                      className="relative h-full min-w-0 flex-1 cursor-default outline-none"
                      aria-label={
                        r.expected
                          ? t("{date}: profit {profit}, of which {expected} still expected from {open} orders not finished. {placed} orders placed, {delivered} delivered, {ads} on ads", { date: r.long, profit: fmt(p.total), expected: fmt(r.expected), open: r.open, placed: r.placed, delivered: r.delivered, ads: fmt(r.adSpend) })
                          : t("{date}: profit {profit}, {placed} orders placed, {delivered} delivered, {ads} on ads", { date: r.long, profit: fmt(p.total), placed: r.placed, delivered: r.delivered, ads: fmt(r.adSpend) })
                      }
                      onMouseEnter={() => setActive(i)}
                      onFocus={() => setActive(i)}
                      onBlur={() => setActive(null)}
                    >
                      {active === i ? <span className="absolute inset-y-0 inset-x-[6%] rounded-md bg-ink/[0.04]" aria-hidden="true" /> : null}
                      {view === "bars" && p.total !== 0 ? (
                        <span
                          className={cn("animate-grow-y absolute inset-x-0 mx-auto flex w-[62%] max-w-6 transition-opacity duration-200", up ? "origin-bottom flex-col" : "origin-top flex-col-reverse", active !== null && active !== i && "opacity-45")}
                          style={{ top: `${top}%`, height: `max(2px, ${height}%)`, animationDelay: `${100 + i * 25}ms` }}
                          aria-hidden="true"
                        >
                          {/* The striped part at the bar's end, then the solid real part on the baseline, 2px apart. */}
                          {striped ? <span className={cn("min-h-0 w-full flex-1", up ? "rounded-t-[4px]" : "rounded-b-[4px]")} style={{ backgroundImage: stripes(color) }} /> : null}
                          {solid > 0.05 ? <span className={cn("w-full shrink-0", striped ? (up ? "mt-[2px]" : "mb-[2px]") : up ? "rounded-t-[4px]" : "rounded-b-[4px]")} style={{ height: `${(solid / Math.max(height, 0.0001)) * 100}%`, background: color }} /> : null}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              {b && active !== null ? (
                <Tip className="top-1 -translate-x-1/2 rtl:translate-x-1/2" style={{ insetInlineStart: `${Math.min(78, Math.max(22, x(active)))}%` }}>
                  <b className="block text-[12px]">{b.long}</b>
                  {view === "running" ? (
                    <>
                      <span className="num block font-bold">{t("Total so far {amount}", { amount: fmt(running[active].total) })}</span>
                      <span className="num block text-white/80">{t("Real so far {amount}", { amount: fmt(running[active].real) })}</span>
                    </>
                  ) : (
                    <>
                      <span className={cn("num block font-bold", totals[active] < 0 ? "text-[#ff9aa3]" : "text-[#7be3a6]")}>{t("Profit {amount}", { amount: fmt(totals[active]) })}</span>
                      {b.expected ? <span className="num block text-white/80">{t("Real {real} + still expected {expected}", { real: fmt(b.profit), expected: fmt(b.expected) })}</span> : null}
                    </>
                  )}
                  <span className="block text-white/80">
                    {b.open ? t("{placed} placed · {delivered} delivered · {open} not finished", { placed: b.placed, delivered: b.delivered, open: b.open }) : t("{placed} placed · {delivered} delivered", { placed: b.placed, delivered: b.delivered })}
                  </span>
                  <span className="block text-white/80">{t("Collected {revenue} · costs {costs} · ads {ads}", { revenue: fmt(b.revenue), costs: fmt(b.costs), ads: fmt(b.adSpend) })}</span>
                </Tip>
              ) : null}
            </div>
          </div>
          <div className="flex ps-[3.25rem] text-center text-[10px] text-muted" aria-hidden="true">
            {buckets.map((r, i) => (
              <span key={r.label + i} className={cn("min-w-0 flex-1 whitespace-nowrap", n > 7 && i % Math.ceil(n / 7) !== 0 && "invisible")}>{r.label}</span>
            ))}
          </div>
          <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
            {view === "running" ? (
              <>
                <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded-full bg-ink" aria-hidden="true" />{t("Profit with orders not finished")}</span>
                <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dotted border-positive" aria-hidden="true" />{t("Real profit so far")}</span>
              </>
            ) : (
              <>
                <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-[3px]" style={{ background: PROFIT }} aria-hidden="true" />{t("Profit")}</span>
                <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-[3px]" style={{ background: LOSS }} aria-hidden="true" />{t("Loss")}</span>
                {hasOpen ? <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-[3px]" style={{ backgroundImage: stripes(PROFIT) }} aria-hidden="true" />{t("Still expected: orders not finished yet")}</span> : null}
              </>
            )}
          </figcaption>
        </>
      )}
    </figure>
  );
}

/** The running totals as two lines over the same days: real so far (dotted) and with what's still expected. */
function RunningLines({ running, y, x }: { running: { real: number; total: number }[]; y: (v: number) => number; x: (i: number) => number }) {
  const path = (k: "real" | "total") => running.map((r, i) => `${i ? "L" : "M"}${x(i)},${y(r[k])}`).join(" ");
  const last = running.length - 1;
  return (
    <div className="pointer-events-none absolute inset-0 rtl:-scale-x-100" aria-hidden="true">
      <svg className="absolute inset-0 size-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
        <path d={`${path("total")} L${x(last)},${y(0)} L${x(0)},${y(0)} Z`} fill="#141012" fillOpacity={0.06} />
        <path d={path("real")} fill="none" stroke={PROFIT} strokeWidth={2} strokeDasharray="2 4" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        <path d={path("total")} fill="none" stroke="#141012" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink ring-2 ring-surface" style={{ left: `${x(last)}%`, top: `${y(running[last].total)}%` }} />
    </div>
  );
}

// ─────────────────────────── One delivered order, from its price to its profit ───────────────────────────

export type WaterStep = { key: string; label: string; short: string; amount: number; kind: "start" | "cost" | "end"; note?: string };

function spans(steps: WaterStep[]) {
  let run = 0;
  return steps.map((s) => {
    if (s.kind !== "cost") {
      run = s.amount;
      return { ...s, a: 0, b: s.amount };
    }
    const a = run;
    run -= s.amount;
    return { ...s, a, b: run };
  });
}

/**
 * The price of one delivered order, each cost taken off in turn, down to its profit: columns from a
 * small tablet up, rows on a phone. Every amount is written on its mark.
 */
export function Waterfall({ steps, fmt, label }: { steps: WaterStep[]; fmt: (v: number) => string; label: string }) {
  const s = spans(steps);
  const lo = Math.min(0, ...s.flatMap((x) => [x.a, x.b]));
  const hi = Math.max(0, ...s.flatMap((x) => [x.a, x.b]));
  const span = hi - lo || 1;
  const pos = (v: number) => ((v - lo) / span) * 100;
  const [active, setActive] = React.useState<string | null>(null);
  const fill = (x: (typeof s)[number]) => (x.kind === "start" ? "linear-gradient(180deg,#ff4254,#c8102e)" : x.kind === "end" ? (x.amount >= 0 ? PROFIT : LOSS) : "#f3a3ac");
  const sign = (x: (typeof s)[number]) => (x.kind === "cost" || x.amount < 0 ? "−" : "");
  return (
    <figure aria-label={label} className="min-w-0">
      <div className="hidden h-64 pt-5 sm:flex" onMouseLeave={() => setActive(null)} aria-hidden="true">
        {s.map((x, i) => {
          const top = 100 - pos(Math.max(x.a, x.b));
          const h = Math.max(0.8, Math.abs(pos(x.a) - pos(x.b)));
          return (
            <div key={x.key} className="relative flex min-w-0 flex-1 flex-col" onMouseEnter={() => setActive(x.key)}>
              <div className="relative flex-1">
                {lo < 0 ? <span className="absolute inset-x-0 border-t border-border-strong" style={{ top: `${100 - pos(0)}%` }} /> : null}
                {/* A thin connector from the end of the bar before. */}
                {i > 0 ? <span className="absolute -start-[21%] end-[79%] border-t border-border-strong" style={{ top: `${100 - pos(s[i - 1].b)}%` }} /> : null}
                <span
                  className={cn("animate-grow-y absolute inset-x-0 mx-auto w-[58%] max-w-12 origin-bottom transition-opacity", x.kind === "cost" ? "rounded-[4px]" : "rounded-t-[4px]", active && active !== x.key && "opacity-50")}
                  style={{ top: `${top}%`, height: `${h}%`, background: fill(x), animationDelay: `${100 + i * 60}ms` }}
                />
                <span className={cn("num absolute inset-x-0 -translate-y-full whitespace-nowrap pb-1 text-center text-[11.5px] leading-none", x.kind === "cost" ? "font-semibold text-muted" : "font-extrabold text-fg")} style={{ top: `${top}%` }}>
                  {sign(x)}{fmt(Math.abs(x.amount))}
                </span>
              </div>
              <span className={cn("mt-2 min-h-8 px-0.5 text-center text-[11px] leading-tight", x.kind === "cost" ? "text-muted" : "font-bold text-fg")}>{x.short}</span>
              {active === x.key && x.note ? <Tip className="bottom-12 start-1/2 -translate-x-1/2 rtl:translate-x-1/2">{x.note}</Tip> : null}
            </div>
          );
        })}
      </div>
      <ol className="flex flex-col gap-2.5 sm:hidden">
        {s.map((x) => {
          const left = pos(Math.min(x.a, x.b));
          const w = Math.max(0.8, pos(Math.max(x.a, x.b)) - left);
          const total = x.kind !== "cost";
          return (
            <li key={x.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
              <span className={cn("min-w-0 text-[13px] leading-snug", total ? "font-bold text-fg" : "text-muted")}>
                {x.label}
                {x.note ? <span className="block text-[11px] text-subtle">{x.note}</span> : null}
              </span>
              <span className={cn("num whitespace-nowrap text-end text-[13px]", total ? "font-extrabold" : "font-semibold text-muted")}>{sign(x)}{fmt(Math.abs(x.amount))}</span>
              <span className="relative col-span-2 h-3" aria-hidden="true">
                <span className="absolute inset-y-0 rounded-[4px]" style={{ insetInlineStart: `${left}%`, width: `${w}%`, background: fill(x) }} />
              </span>
            </li>
          );
        })}
      </ol>
      <ul className="sr-only max-sm:hidden">
        {s.map((x) => <li key={x.key}>{`${x.label}: ${sign(x)}${fmt(Math.abs(x.amount))}${x.note ? ` (${x.note})` : ""}`}</li>)}
      </ul>
    </figure>
  );
}

// ─────────────────────────── From orders placed to cash ───────────────────────────

export type FlowStep = { key: string; label: string; value: number; rate: number | null; rateLabel?: string; href?: string; help?: string };
export type FlowPart = { key: keyof typeof STATE_COLORS; label: string; value: number; href?: string };

const partFill = (key: keyof typeof STATE_COLORS) => (key === "road" ? { backgroundImage: stripes(STATE_COLORS.road) } : { background: STATE_COLORS[key] });

/**
 * Orders placed, confirmed and shipped as shrinking bars, each with the share it keeps of the
 * step above; then where the shipped orders are now (delivered, on the road, returned, lost) as
 * one bar. Each count opens its orders.
 */
export function OrderFlow({ steps, parts, partsLabel }: { steps: FlowStep[]; parts: FlowPart[]; partsLabel: string }) {
  const { t } = useT();
  const max = Math.max(1, ...steps.map((s) => s.value));
  const shipped = parts.reduce((a, p) => a + p.value, 0);
  const [active, setActive] = React.useState<string | null>(null);
  const count = (v: number) => v.toLocaleString("en-US");
  const number = (v: number, href?: string) =>
    href && v > 0 ? <Link href={href} className="num shrink-0 text-[13px] font-bold underline decoration-border-strong underline-offset-4 hover:text-brand-strong hover:decoration-brand">{count(v)}</Link> : <span className="num shrink-0 text-[13px] font-bold">{count(v)}</span>;
  return (
    <div className="flex flex-col gap-5">
      <ol className="flex flex-col gap-2.5" aria-label={t("Orders from placed to shipped")}>
        {steps.map((s, i) => (
          <li key={s.key} className="grid grid-cols-[6.75rem_minmax(0,1fr)] items-center gap-3">
            <span className="flex min-w-0 items-center gap-1 text-[12px] text-muted">
              {s.label}
              {s.help ? <HelpTip label={s.label}>{s.help}</HelpTip> : null}
            </span>
            <span className="flex min-w-0 items-center gap-2">
              <span className="animate-grow-x h-5 rounded-e-[4px] bg-brand-bar" style={{ width: `${Math.max(1.5, (s.value / max) * 100)}%`, opacity: 1 - i * 0.16, animationDelay: `${100 + i * 70}ms` }} aria-hidden="true" />
              {number(s.value, s.href)}
              {s.rate !== null ? <span className="num shrink-0 whitespace-nowrap rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand-strong">{formatPercent(s.rate, 0)}{s.rateLabel ? ` ${s.rateLabel}` : ""}</span> : null}
            </span>
          </li>
        ))}
      </ol>
      <div className="flex flex-col gap-2">
        <span className="text-[12px] font-semibold text-fg">{partsLabel}</span>
        {shipped > 0 ? (
          <div className="flex h-4 w-full gap-[2px] overflow-hidden rounded-[4px]" onMouseLeave={() => setActive(null)} role="img" aria-label={`${partsLabel}: ${parts.map((p) => `${p.label} ${p.value}`).join(", ")}`}>
            {parts.filter((p) => p.value > 0).map((p) => (
              <span key={p.key} onMouseEnter={() => setActive(p.key)} className={cn("h-full transition-opacity", active && active !== p.key && "opacity-45")} style={{ width: `${(p.value / shipped) * 100}%`, ...partFill(p.key) }} />
            ))}
          </div>
        ) : <p className="text-xs text-muted">{t("Nothing shipped yet.")}</p>}
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
          {parts.map((p) => (
            <li key={p.key} className={cn("flex min-w-0 items-center gap-2 transition-opacity", active && active !== p.key && "opacity-50")}>
              <span className="size-2.5 shrink-0 rounded-[3px]" style={partFill(p.key)} aria-hidden="true" />
              <span className="min-w-0 truncate text-muted">{p.label}</span>
              <span className="ms-auto">{number(p.value, p.href)}</span>
              <span className="num w-9 shrink-0 text-end text-[11px] text-subtle">{shipped > 0 ? formatPercent(p.value / shipped, 0) : ""}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ─────────────────────────── Campaigns side by side ───────────────────────────

export type CampaignBar = { id: string; name: string; value: number | null; note: string };

/**
 * Ad cost per delivered order for each campaign, longest bar on top, with a line at the most a
 * delivered order can pay for ads. Bars past the line lose money on each delivered order.
 */
export function CampaignBars({ rows, limit, fmt }: { rows: CampaignBar[]; limit: number | null; fmt: (v: number) => string }) {
  const { t, tx } = useT();
  const [active, setActive] = React.useState<string | null>(null);
  const known = rows.filter((r): r is CampaignBar & { value: number } => r.value !== null).sort((a, b) => b.value - a.value);
  const unknown = rows.filter((r) => r.value === null);
  if (known.length === 0) return <p className="py-6 text-center text-sm text-muted">{t("Not enough confirmed and delivered orders yet to compare campaigns.")}</p>;
  const max = Math.max(...known.map((r) => r.value), limit !== null && limit > 0 ? limit : 0) * 1.04 || 1;
  const x = (v: number) => (Math.max(0, v) / max) * 100;
  return (
    <figure className="flex flex-col gap-3" aria-label={t("Ad cost per delivered order, by campaign")}>
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
                aria-label={
                  over
                    ? t("{name}: {amount} of ads per delivered order. {note}. More than a delivered order can pay.", { name: r.name, amount: fmt(r.value), note: r.note })
                    : t("{name}: {amount} of ads per delivered order. {note}", { name: r.name, amount: fmt(r.value), note: r.note })
                }
                onMouseEnter={() => setActive(r.id)}
                onFocus={() => setActive(r.id)}
                onBlur={() => setActive(null)}
              >
                <span className="flex min-w-0">
                  <span
                    className={cn("animate-grow-x h-3.5 rounded-e-[4px] transition-opacity duration-200", over ? "bg-[linear-gradient(90deg,#3a3335,#141012)]" : "bg-brand-bar glow-soft", active && active !== r.id && "opacity-45")}
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
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-[3px] bg-brand-bar" aria-hidden="true" />{t("Earns money")}</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-[3px] bg-ink" aria-hidden="true" />{t("Loses money on each delivered order")}</span>
        {limit !== null && limit > 0 ? (
          <span className="flex items-center gap-1.5">
            <span className="h-3 border-s-2 border-dashed border-ink/60" aria-hidden="true" />
            {tx("Most a delivered order can pay: {amount}", { amount: <b className="num text-fg">{fmt(limit)}</b> })}
            <HelpTip label={t("Most a delivered order can pay: {amount}", { amount: fmt(limit) })}>{t("Profit of one delivered order before ads: profit per delivered order + its ads. A campaign whose ads cost more than this per delivered order loses money.")}</HelpTip>
          </span>
        ) : null}
        {unknown.length ? <span>{unknown.length === 1 ? t("1 campaign has no confirmed or delivered orders yet.") : t("{n} campaigns have no confirmed or delivered orders yet.", { n: unknown.length })}</span> : null}
      </figcaption>
    </figure>
  );
}

// ─────────────────────────── Profit by confirmation and delivery rate ───────────────────────────

/**
 * Profit for each pair of confirmation and delivery rates, laid out like MDM's own calculator:
 * green cells earn, red cells lose, the deeper the color the bigger the amount, and every cell says
 * its amount. The cell nearest the rates in use is ringed.
 */
export function RateGrid({ confirmations, deliveries, values, current, fmt, label }: { confirmations: number[]; deliveries: number[]; values: number[][]; current: { row: number; col: number }; fmt: (v: number) => string; label: string }) {
  const { t } = useT();
  const max = Math.max(1, ...values.flat().map((v) => Math.abs(v)));
  const shade = (v: number) => {
    const k = Math.min(1, Math.abs(v) / max);
    // Lighter near zero, deeper further from it; the text turns white on the deep cells.
    return { background: `color-mix(in srgb, ${v >= 0 ? PROFIT : LOSS} ${Math.round(8 + k * 77)}%, white)`, color: k > 0.5 ? "#fff" : "var(--color-fg)" };
  };
  return (
    <figure className="min-w-0" aria-label={label}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[18rem] border-separate border-spacing-[3px] text-center">
          <caption className="sr-only">{label}</caption>
          <thead>
            <tr>
              <th scope="col" className="w-16 text-[10px] font-semibold leading-tight text-subtle">{t("Confirmed ↓ Delivered →")}</th>
              {deliveries.map((d) => <th key={d} scope="col" className="num text-[11px] font-bold text-muted">{formatPercent(d, 0)}</th>)}
            </tr>
          </thead>
          <tbody>
            {confirmations.map((c, i) => (
              <tr key={c}>
                <th scope="row" className="num text-[11px] font-bold text-muted">{formatPercent(c, 0)}</th>
                {deliveries.map((d, j) => {
                  const v = values[i][j];
                  const here = current.row === i && current.col === j;
                  return (
                    <td key={d} className={cn("num h-9 rounded-[6px] px-1 text-[11px] font-bold", here && "ring-2 ring-ink ring-offset-1")} style={shade(v)} title={t("{conf} confirmed, {del} delivered: {amount}", { conf: formatPercent(c, 0), del: formatPercent(d, 0), amount: fmt(v) })}>
                      {fmt(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-[3px]" style={{ background: PROFIT }} aria-hidden="true" />{t("Profit")}</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-[3px]" style={{ background: LOSS }} aria-hidden="true" />{t("Loss")}</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] ring-2 ring-ink" aria-hidden="true" />{t("Your rates now")}</span>
      </figcaption>
    </figure>
  );
}
