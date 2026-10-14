"use client";

/** Pieces the Profit tracker's views share: number tiles, the red hero tile and the bridge chart. */
import * as React from "react";
import { useMoney } from "@/components/app/currency";
import { FitMoney, FitText } from "@/components/app/fit-money";
import { Term } from "@/components/ui/tooltip";
import { currencyExponent } from "@/lib/money";
import { cn } from "@/lib/utils";

export function Stat({ label, def, children, sub, tone }: { label: string; def?: string; children: React.ReactNode; sub?: React.ReactNode; tone?: "good" | "bad" }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-2xl bg-surface-2 p-3.5">
      <span className="text-xs text-muted">{def ? <Term label={label} definition={def} /> : label}</span>
      <span className={cn("num min-w-0 text-lg font-extrabold leading-tight", tone === "good" && "text-positive", tone === "bad" && "text-negative")}>
        {/* Amounts shrink to fit a narrow phone tile instead of being cut. */}
        {typeof children === "string" ? <FitText max={18} min={12}>{children}</FitText> : children}
      </span>
      {sub ? <span className="text-[11px] text-subtle">{sub}</span> : null}
    </div>
  );
}

export function Hero({ label, def, value, currency, sub }: { label: string; def: string; value: number; currency: string; sub: React.ReactNode }) {
  return (
    <section className="relative flex min-w-0 flex-col gap-4 overflow-hidden rounded-[22px] bg-brand-hero p-5 text-white shine shadow-[0_16px_34px_rgb(204_19_37/0.35),inset_0_1px_0_rgb(255_255_255/0.35)]">
      <span className="pointer-events-none absolute -right-12 -top-16 size-44 rounded-full border-[20px] border-white/10" aria-hidden="true" />
      <span className="relative text-[15px] font-semibold"><Term label={label} definition={def} iconClassName="text-white/70 hover:text-white" /></span>
      <div className="relative min-w-0">
        <FitMoney value={Math.round(value / 10 ** currencyExponent(currency)) * 10 ** currencyExponent(currency)} currency={currency} max={38} signed codeClassName="text-white/85" className="[text-shadow:0_2px_14px_rgb(255_170_178/0.55)]" />
      </div>
      <span className="relative text-xs text-white/85">{sub}</span>
    </section>
  );
}

export type Step = { label: string; amount: number; kind: "start" | "cost" | "gain" | "end"; note?: string };

/** Where each bar starts and ends: totals stand on zero, costs and gains hang from the running total. */
function bridgeSpans(steps: Step[]) {
  return steps.reduce<{ run: number; spans: (Step & { a: number; b: number })[] }>(
    (acc, s) => {
      if (s.kind === "start" || s.kind === "end") return { run: s.amount, spans: [...acc.spans, { ...s, a: 0, b: s.amount }] };
      const b = s.kind === "cost" ? acc.run - s.amount : acc.run + s.amount;
      return { run: b, spans: [...acc.spans, { ...s, a: acc.run, b }] };
    },
    { run: 0, spans: [] },
  ).spans;
}

/**
 * A bridge from one total to another: each cost is a bar hanging from the running total, so the
 * bars line up end to end. Every amount is also written out, so the bars are never the only clue.
 */
export function Bridge({ steps, currency, label }: { steps: Step[]; currency: string; label: string }) {
  const money = useMoney();
  const spans = bridgeSpans(steps);
  const lo = Math.min(0, ...spans.flatMap((s) => [s.a, s.b]));
  const hi = Math.max(0, ...spans.flatMap((s) => [s.a, s.b]));
  const width = hi - lo || 1;
  const pos = (v: number) => ((v - lo) / width) * 100;
  return (
    <ol aria-label={label} className="flex flex-col gap-2.5">
      {spans.map((s) => {
        const left = pos(Math.min(s.a, s.b));
        const w = Math.max(0.6, pos(Math.max(s.a, s.b)) - left);
        const total = s.kind === "start" || s.kind === "end";
        return (
          <li key={s.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_7.5rem]">
            <span className={cn("min-w-0 text-[13px] leading-snug", total ? "font-bold text-fg" : "text-muted")}>
              {s.label}
              {s.note ? <span className="block text-[11px] text-subtle">{s.note}</span> : null}
            </span>
            <span className={cn("num whitespace-nowrap text-right text-[13px] sm:order-3", total ? "font-extrabold" : "font-semibold", s.kind === "cost" && "text-negative", s.kind === "gain" && "text-positive", total && s.amount < 0 && "text-negative")}>
              {s.kind === "cost" || (total && s.amount < 0) ? "−" : s.kind === "gain" ? "+" : ""}
              {money.fmt(Math.abs(s.amount), currency, { decimals: false })}
            </span>
            <span className="relative col-span-2 h-3.5 sm:order-2 sm:col-span-1" aria-hidden="true">
              {lo < 0 ? <span className="absolute inset-y-[-3px] w-px bg-border-strong" style={{ insetInlineStart: `${pos(0)}%` }} /> : null}
              <span
                className={cn(
                  "animate-grow-x absolute inset-y-0 rounded-full",
                  s.kind === "start" && "bg-[linear-gradient(90deg,#ff4254,#c8102e)]",
                  s.kind === "end" && (s.amount >= 0 ? "bg-positive" : "bg-negative"),
                  s.kind === "cost" && "bg-[#f3a3ac]",
                  s.kind === "gain" && "bg-positive/45",
                )}
                style={{ insetInlineStart: `${left}%`, width: `${w}%` }}
              />
            </span>
          </li>
        );
      })}
    </ol>
  );
}
