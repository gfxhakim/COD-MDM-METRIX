import { AlertTriangle, Loader2 } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export function EmptyState({ icon, title, description, action, className }: { icon?: React.ReactNode; title: string; description?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 px-6 py-14 text-center", className)}>
      {icon ? <div className="rounded-xl border border-border bg-surface-2 p-3 text-muted [&_svg]:size-5">{icon}</div> : null}
      <div>
        <p className="text-sm font-medium text-fg">{title}</p>
        {description ? <p className="mx-auto mt-1 max-w-md text-xs text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted" role="status">
      <Loader2 className="size-4 animate-spin" /> {label}…
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="m-4 flex items-start gap-2 rounded-lg border border-negative/30 bg-negative-soft p-3 text-sm text-negative" role="alert">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {message}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-surface-3", className)} />;
}
