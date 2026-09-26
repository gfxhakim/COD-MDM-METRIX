"use client";

import * as React from "react";
import { Input } from "@/components/ui/form";
import { minorToMajor } from "@/lib/money";

/** Text input in major units (e.g. "3900" DZD); callers convert with parseToMinor. */
export function MoneyInput({ id, value, onChange, currency = "DZD", ...rest }: { id: string; value: string; onChange: (v: string) => void; currency?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return (
    <div className="relative">
      <Input id={id} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} className="num pr-12" {...rest} />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-subtle">{currency}</span>
    </div>
  );
}

export const minorToInput = (minor: number | null | undefined, currency = "DZD") => (minor === null || minor === undefined ? "" : String(minorToMajor(minor, currency)));
