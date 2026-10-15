"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { Info } from "lucide-react";
import * as React from "react";
import { useT } from "@/i18n/client";
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

/**
 * The small ⓘ that explains a label, a card or a number. On a computer it opens when the mouse is
 * over it (or it has keyboard focus); on a phone a tap opens it and a second tap, or a tap anywhere
 * else, closes it.
 */
export function HelpTip({ label, children, side, className }: { label?: string; children: React.ReactNode; side?: "top" | "right" | "bottom" | "left"; className?: string }) {
  const { t } = useT();
  const [open, setOpen] = React.useState(false);
  // Radix closes a tooltip when its button is pressed; a tap is the only way to open one on a phone.
  const press = React.useRef<{ pointer: string; wasOpen: boolean } | null>(null);
  return (
    <TooltipPrimitive.Root open={open} onOpenChange={setOpen} delayDuration={150}>
      <TooltipPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={label ? t("What is {label}?", { label }) : t("What is this?")}
          className={cn("-m-1 inline-grid shrink-0 place-items-center rounded-full p-1 text-muted/60 transition-colors hover:text-brand", className)}
          onPointerDown={(e) => {
            press.current = { pointer: e.pointerType, wasOpen: open };
            e.preventDefault();
          }}
          onClick={(e) => {
            e.preventDefault();
            const p = press.current;
            press.current = null;
            if (p?.pointer === "mouse") setOpen(true);
            else if (p) setOpen(!p.wasOpen);
            else setOpen((o) => !o);
          }}
        >
          <Info className="size-3" aria-hidden="true" />
        </button>
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content side={side} sideOffset={6} collisionPadding={12} className="animate-pop z-50 max-w-[min(18rem,calc(100vw-24px))] rounded-xl bg-ink px-3 py-2 text-xs leading-relaxed font-normal text-white shadow-xl">
          {children}
          <TooltipPrimitive.Arrow className="fill-ink" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/** A label with its ⓘ explanation beside it (see HelpTip). */
export function Term({ label, definition, hideLabel, iconClassName }: { label: string; definition: React.ReactNode; hideLabel?: boolean; iconClassName?: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {hideLabel ? null : label}
      <HelpTip label={label} className={iconClassName}>
        {definition}
      </HelpTip>
    </span>
  );
}
