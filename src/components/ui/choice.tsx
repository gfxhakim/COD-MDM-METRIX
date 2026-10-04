"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/** Building blocks of the picker panels (export, custom sync): pill choices, titled sections, tri-state checkboxes. */

export function Chip({ active, children, className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "press h-8 whitespace-nowrap rounded-full border px-3.5 text-xs font-medium transition-colors",
        active ? "border-transparent bg-brand glow" : "border-border-strong bg-surface text-muted hover:bg-surface-2 hover:text-fg",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-bold tracking-tight">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Check3({ state, label, disabled, onChange }: { state: "on" | "off" | "some"; label: string; disabled?: boolean; onChange: () => void }) {
  const ref = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "some";
  }, [state]);
  return <input ref={ref} type="checkbox" aria-label={label} className="size-4 shrink-0 accent-[#e1182c] disabled:opacity-40" checked={state === "on"} disabled={disabled} onChange={onChange} />;
}
