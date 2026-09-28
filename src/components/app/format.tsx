import { formatMoney } from "@/lib/money";
import { cn, formatPercent } from "@/lib/utils";

/** Money cell: "—" for null, red for negative when `signed`. */
export function Money({ value, currency, signed, className }: { value: number | null | undefined; currency: string; signed?: boolean; className?: string }) {
  if (value === null || value === undefined) return <span className={cn("text-subtle", className)} title="Not enough data">—</span>;
  return <span className={cn("num", signed && value < 0 && "text-negative", signed && value > 0 && "text-positive", className)}>{formatMoney(value, currency)}</span>;
}

export function Rate({ value, className }: { value: number | null | undefined; className?: string }) {
  if (value === null || value === undefined) return <span className={cn("text-subtle", className)} title="Not enough data">—</span>;
  return <span className={cn("num", className)}>{formatPercent(value)}</span>;
}

export function Ratio({ value, className }: { value: number | null | undefined; className?: string }) {
  if (value === null || value === undefined) return <span className={cn("text-subtle", className)} title="Not enough data">—</span>;
  return <span className={cn("num", value < 0 ? "text-negative" : "text-fg", className)}>{value.toFixed(2)}</span>;
}
