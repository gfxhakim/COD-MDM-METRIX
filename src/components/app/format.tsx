"use client";

import { useMoney } from "@/components/app/currency";
import { formatMoney } from "@/lib/money";
import { cn, formatPercent } from "@/lib/utils";

/**
 * Money cell: "—" for null, red for negative when `signed`. Shown in the currency being
 * viewed (hover shows the amount as kept); `asIs` keeps it in its own currency.
 */
export function Money({ value, currency, signed, asIs, className }: { value: number | null | undefined; currency: string; signed?: boolean; asIs?: boolean; className?: string }) {
  const money = useMoney();
  if (value === null || value === undefined) return <span className={cn("text-subtle", className)} title="Not enough data">—</span>;
  const c = asIs ? { minor: value, currency, converted: false } : money.convert(value, currency);
  return (
    <span className={cn("num", signed && value < 0 && "text-negative", signed && value > 0 && "text-positive", className)} title={c.converted ? `${formatMoney(value, currency)} (${money.rateNote(currency)})` : undefined}>
      {formatMoney(c.minor, c.currency)}
    </span>
  );
}

export function Rate({ value, className }: { value: number | null | undefined; className?: string }) {
  if (value === null || value === undefined) return <span className={cn("text-subtle", className)} title="Not enough data">—</span>;
  return <span className={cn("num", className)}>{formatPercent(value)}</span>;
}

export function Ratio({ value, className }: { value: number | null | undefined; className?: string }) {
  if (value === null || value === undefined) return <span className={cn("text-subtle", className)} title="Not enough data">—</span>;
  return <span className={cn("num", value < 0 ? "text-negative" : "text-fg", className)}>{value.toFixed(2)}</span>;
}
