"use client";

import { ChevronDown } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Pages show what a beginner needs first; the rest folds under "More details". Whether it is open
 * is remembered per page in this browser, a convenience only: anywhere else it starts folded.
 */
const memory = new Map<string, boolean>();
const listeners = new Set<() => void>();
const storageKey = (id: string) => `more-details:${id}`;

function read(id: string) {
  if (memory.has(id)) return memory.get(id)!;
  try {
    return localStorage.getItem(storageKey(id)) === "1";
  } catch {
    return false;
  }
}

function write(id: string, open: boolean) {
  memory.set(id, open);
  try {
    localStorage.setItem(storageKey(id), open ? "1" : "0");
  } catch {
    // Kept for this visit only.
  }
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** Whether this page's details are open, and a way to open or fold them. */
export function useMoreDetails(id: string): [boolean, (open: boolean) => void] {
  const open = React.useSyncExternalStore(subscribe, () => read(id), () => false);
  const set = React.useCallback((o: boolean) => write(id, o), [id]);
  return [open, set];
}

/** "More details" / "Fewer details" by default; `labels` gives other words, folded first. */
export function MoreDetailsButton({ open, onToggle, what = "details", labels, controls, className }: { open: boolean; onToggle: (open: boolean) => void; what?: string; labels?: [string, string]; controls?: string; className?: string }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      onClick={() => onToggle(!open)}
      className={cn("press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-border-strong bg-surface px-4 text-sm font-semibold text-muted shadow-card transition-colors hover:text-fg", open && "text-fg", className)}
    >
      {labels ? labels[open ? 1 : 0] : open ? `Fewer ${what}` : `More ${what}`}
      <ChevronDown className={cn("size-4 transition-transform duration-300", open && "rotate-180")} aria-hidden="true" />
    </button>
  );
}

/** A page's secondary sections, folded until someone asks for them. `hint` says what is inside. */
export function MoreDetails({ id, hint, children, className }: { id: string; hint?: string; children: React.ReactNode; className?: string }) {
  const [open, setOpen] = useMoreDetails(id);
  const domId = `more-details-${id}`;
  return (
    <section className={cn("flex flex-col gap-[18px]", className)}>
      <div className="flex flex-col items-center gap-1.5 text-center">
        <MoreDetailsButton open={open} onToggle={setOpen} controls={domId} />
        {!open && hint ? <p className="max-w-md text-xs text-subtle">{hint}</p> : null}
      </div>
      {open ? <div id={domId} className="flex min-w-0 flex-col gap-[18px]">{children}</div> : null}
    </section>
  );
}
