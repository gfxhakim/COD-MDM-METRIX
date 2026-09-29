"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  title,
  description,
  children,
  className,
  side,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** "right" renders a full-height drawer. */
  side?: "right";
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-ink/40 backdrop-blur-[2px] data-[state=open]:animate-[fade-in_220ms_ease-out_backwards] data-[state=closed]:animate-[fade-out_160ms_ease-in_both]" />
      <DialogPrimitive.Content
        className={cn(
          "fixed z-50 flex flex-col border border-border bg-surface shadow-2xl focus:outline-none",
          side === "right"
            ? "inset-y-0 right-0 h-full w-full max-w-2xl border-y-0 border-r-0 data-[state=open]:animate-[slide-in-right_420ms_var(--ease-out)_backwards] data-[state=closed]:animate-[slide-out-right_220ms_ease-in_both] sm:rounded-l-[28px]"
            : "left-1/2 top-1/2 max-h-[90vh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-[22px] data-[state=open]:animate-[zoom-in_280ms_var(--ease-out)_backwards] data-[state=closed]:animate-[zoom-out_160ms_ease-in_both]",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <DialogPrimitive.Title className="text-lg font-bold tracking-tight">{title}</DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-1 text-xs text-muted">{description}</DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-fg" aria-label="Close">
            <X className="size-4" />
          </DialogPrimitive.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
