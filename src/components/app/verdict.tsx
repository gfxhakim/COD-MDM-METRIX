"use client";

import { Badge } from "@/components/ui/badge";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/core";

export type VerdictValue = "KILL" | "BAD_TRAFFIC" | "SCALE" | "WATCH" | "INSUFFICIENT_DATA";

const TONE = { KILL: "negative", BAD_TRAFFIC: "warning", SCALE: "positive", WATCH: "info", INSUFFICIENT_DATA: "neutral" } as const;
export const VERDICT_LABEL = { KILL: msg("Kill"), BAD_TRAFFIC: msg("Bad traffic"), SCALE: msg("Scale"), WATCH: msg("Watch"), INSUFFICIENT_DATA: msg("Not enough data") } as const;

export function VerdictBadge({ verdict }: { verdict: VerdictValue | null }) {
  const { t } = useT();
  if (!verdict) return <span className="text-subtle">—</span>;
  return <Badge tone={TONE[verdict]}>{t(VERDICT_LABEL[verdict])}</Badge>;
}
