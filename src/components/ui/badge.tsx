import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

export const badgeVariants = cva("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap border", {
  variants: {
    tone: {
      neutral: "bg-surface-3 text-muted border-border-strong",
      positive: "bg-positive-soft text-positive border-positive/25",
      warning: "bg-warning-soft text-warning border-warning/25",
      negative: "bg-negative-soft text-negative border-negative/25",
      info: "bg-info-soft text-info border-info/25",
      mint: "bg-mint/10 text-mint border-mint/25",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({ className, tone, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
