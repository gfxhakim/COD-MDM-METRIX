import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

export const badgeVariants = cva("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4 whitespace-nowrap border", {
  variants: {
    tone: {
      neutral: "bg-surface-3 text-muted border-border",
      positive: "bg-positive-soft text-positive border-positive/20",
      warning: "bg-warning-soft text-warning border-warning/20",
      negative: "bg-negative-soft text-negative border-negative/20",
      info: "bg-info-soft text-info border-info/20",
      mint: "bg-mint/10 text-mint border-mint/20",
      brand: "bg-brand-soft text-brand-strong border-brand/20",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({ className, tone, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
