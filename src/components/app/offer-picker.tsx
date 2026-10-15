"use client";

import * as React from "react";
import { Input, Select } from "@/components/ui/form";
import { MAX_PIECES_PER_ORDER, OFFER_PRESETS } from "@/domain/offers";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";

/** Pick a product's offer: a preset, or any number of pieces per order. */
export function OfferPicker({ id, label, value, onChange, disabled, className }: { id?: string; label?: string; value: number; onChange: (pieces: number) => void; disabled?: boolean; className?: string }) {
  const { t } = useT();
  const preset = OFFER_PRESETS.some((p) => p.pieces === value);
  const [other, setOther] = React.useState(!preset);
  const [typed, setTyped] = React.useState(String(value));
  return (
    <div className={cn("flex gap-2", className)}>
      <Select
        id={id}
        aria-label={label}
        value={other ? "other" : String(value)}
        disabled={disabled}
        className="min-w-0 flex-1"
        onChange={(e) => {
          if (e.target.value === "other") {
            setOther(true);
            setTyped(String(value));
            return;
          }
          setOther(false);
          onChange(Number(e.target.value));
        }}
      >
        {OFFER_PRESETS.map((p) => <option key={p.pieces} value={p.pieces}>{t(p.label)} · {t(p.detail)}</option>)}
        <option value="other">{t("Another number of pieces…")}</option>
      </Select>
      {other ? (
        <Input
          aria-label={t("Pieces per order")}
          inputMode="numeric"
          className="num w-20"
          disabled={disabled}
          value={typed}
          onChange={(e) => {
            const v = e.target.value.replace(/[^\d]/g, "");
            setTyped(v);
            const n = Number.parseInt(v, 10);
            if (n >= 1 && n <= MAX_PIECES_PER_ORDER) onChange(n);
          }}
        />
      ) : null}
    </div>
  );
}
