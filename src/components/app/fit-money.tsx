"use client";

import * as React from "react";
import { useMoney } from "@/components/app/currency";
import { currencyExponent, formatMoney, minorToMajor } from "@/lib/money";
import { cn } from "@/lib/utils";

/** "326,200" and "DZD" apart, so the code can sit small above the number. The sign uses a real minus. */
export function moneyParts(minor: number, currency: string, signed = false) {
  const exp = currencyExponent(currency);
  const decimals = minor % 10 ** exp !== 0 ? exp : 0;
  const number = new Intl.NumberFormat("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(Math.abs(minorToMajor(minor, currency)));
  const sign = minor < 0 ? "−" : signed && minor > 0 ? "+" : "";
  return { code: currency, number: sign + number };
}

/**
 * Shrinks a one-line text until it fits the width of its box, from `max` down to `min` pixels.
 * Runs before paint, again when the box resizes and once the web font has loaded.
 */
export function useFitText<B extends HTMLElement, T extends HTMLElement>(max: number, min: number, text: string) {
  const box = React.useRef<B>(null);
  const el = React.useRef<T>(null);
  React.useLayoutEffect(() => {
    const b = box.current;
    const t = el.current;
    if (!b || !t) return;
    const fit = () => {
      t.style.fontSize = `${max}px`;
      const room = b.clientWidth;
      const need = t.scrollWidth;
      // A little under the exact ratio, so rounding never leaves a pixel hanging out.
      t.style.fontSize = `${need > room && room > 0 ? Math.max(min, Math.floor(((max * room * 0.98) / need) * 10) / 10) : max}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(b);
    let live = true;
    document.fonts?.ready.then(() => live && fit());
    return () => {
      live = false;
      ro.disconnect();
    };
  }, [max, min, text]);
  return { box, el };
}

/** Any short value (a count, a ratio) that must stay on one line inside its card. */
export function FitText({ children, max = 34, min = 14, className }: { children: string; max?: number; min?: number; className?: string }) {
  const { box, el } = useFitText<HTMLSpanElement, HTMLSpanElement>(max, min, children);
  return (
    <span ref={box} className="block w-full min-w-0">
      <span ref={el} className={cn("num inline-block whitespace-nowrap font-extrabold leading-none", className)} style={{ fontSize: max }}>
        {children}
      </span>
    </span>
  );
}

/**
 * A money amount that always fits its card: the currency code sits small above the number,
 * and the number shrinks with the card. Shown in the currency being viewed; hover shows the
 * amount as kept and the rate used.
 */
export function FitMoney({
  value,
  currency,
  max = 34,
  min = 14,
  signed,
  className,
  codeClassName,
}: {
  value: number | null | undefined;
  currency: string;
  max?: number;
  min?: number;
  /** Adds "+" to gains. */
  signed?: boolean;
  className?: string;
  codeClassName?: string;
}) {
  const money = useMoney();
  const c = value === null || value === undefined ? null : money.convert(value, currency);
  const parts = c ? moneyParts(c.minor, c.currency, signed) : { code: money.view, number: "—" };
  const { box, el } = useFitText<HTMLSpanElement, HTMLSpanElement>(max, min, parts.number);
  const title = c?.converted && value != null ? `${formatMoney(value, currency)} (${money.rateNote(currency)})` : undefined;
  return (
    <span ref={box} className="flex w-full min-w-0 flex-col gap-1" title={title}>
      <span className={cn("text-[11px] font-bold leading-none tracking-[0.08em] text-subtle", codeClassName)}>{parts.code}</span>
      <span ref={el} className={cn("num inline-block self-start whitespace-nowrap font-extrabold leading-none", className)} style={{ fontSize: max }}>
        {parts.number}
      </span>
    </span>
  );
}
