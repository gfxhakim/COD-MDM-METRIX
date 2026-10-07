import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  // min-w-0: a wide table inside scrolls sideways instead of stretching the card past a phone screen.
  return <div className={cn("min-w-0 rounded-[22px] border border-border/70 bg-surface shadow-card", className)} {...props} />;
}

export function CardHeader({ title, description, actions, className }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 px-5 pb-3 pt-5", className)}>
      <div className="min-w-0">
        <h2 className="text-[17px] font-bold tracking-[-0.02em] text-fg">{title}</h2>
        {description ? <p className="mt-1 text-[13px] leading-snug text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5", className)} {...props} />;
}
