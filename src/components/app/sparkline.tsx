"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/** Single-series sparkline with a per-point hover readout. */
export function Sparkline({ values, labels, format, className, color = "var(--color-mint)", ariaLabel }: { values: number[]; labels: string[]; format: (v: number) => string; className?: string; color?: string; ariaLabel: string }) {
  const [hover, setHover] = React.useState<number | null>(null);
  if (values.length < 2) return null;
  const w = 120, h = 32, pad = 3;
  const max = Math.max(...values), min = Math.min(0, ...values);
  const span = max - min || 1;
  const x = (i: number) => pad + (i * (w - pad * 2)) / (values.length - 1);
  const y = (v: number) => h - pad - ((v - min) / span) * (h - pad * 2);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  return (
    <div className={cn("relative", className)}>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-8 w-full overflow-visible" role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
        <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {hover !== null ? <circle cx={x(hover)} cy={y(values[hover])} r={3} fill={color} stroke="var(--color-surface)" strokeWidth={2} /> : null}
        {values.map((_, i) => (
          <rect key={i} x={x(i) - w / values.length / 2} y={0} width={w / values.length} height={h} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
      </svg>
      {hover !== null ? (
        <div className="pointer-events-none absolute -top-7 right-0 whitespace-nowrap rounded-md border border-border-strong bg-surface-3 px-2 py-0.5 text-[11px] text-fg shadow">
          {labels[hover]} · <span className="num">{format(values[hover])}</span>
        </div>
      ) : null}
    </div>
  );
}
