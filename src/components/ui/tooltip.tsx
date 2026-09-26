"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { Info } from "lucide-react";
import * as React from "react";

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({ content, children }: { content: React.ReactNode; children: React.ReactNode }) {
  return (
    <TooltipPrimitive.Root delayDuration={150}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content sideOffset={6} className="z-50 max-w-xs rounded-lg border border-border-strong bg-surface-3 px-3 py-2 text-xs leading-relaxed text-fg shadow-xl">
          {content}
          <TooltipPrimitive.Arrow className="fill-surface-3" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/** Metric label with a keyboard-focusable definition tooltip. */
export function Term({ label, definition }: { label: string; definition: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <Tooltip content={definition}>
        <button type="button" className="text-subtle hover:text-muted" aria-label={`What is ${label}?`}>
          <Info className="size-3" />
        </button>
      </Tooltip>
    </span>
  );
}
