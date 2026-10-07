"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { Info } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({ content, children, side }: { content: React.ReactNode; children: React.ReactNode; side?: "top" | "right" | "bottom" | "left" }) {
  return (
    <TooltipPrimitive.Root delayDuration={150}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content side={side} sideOffset={6} className="animate-pop z-50 max-w-xs rounded-xl bg-ink px-3 py-2 text-xs leading-relaxed text-white shadow-xl">
          {content}
          <TooltipPrimitive.Arrow className="fill-ink" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/** Metric label with a keyboard-focusable definition tooltip. */
export function Term({ label, definition, hideLabel, iconClassName }: { label: string; definition: React.ReactNode; hideLabel?: boolean; iconClassName?: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {hideLabel ? null : label}
      <Tooltip content={definition}>
        <button type="button" className={cn("text-subtle hover:text-muted", iconClassName)} aria-label={`What is ${label}?`}>
          <Info className="size-3" />
        </button>
      </Tooltip>
    </span>
  );
}
