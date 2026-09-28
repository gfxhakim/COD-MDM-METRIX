import { Badge } from "@/components/ui/badge";

export type VerdictValue = "KILL" | "BAD_TRAFFIC" | "SCALE" | "WATCH" | "INSUFFICIENT_DATA";

const TONE = { KILL: "negative", BAD_TRAFFIC: "warning", SCALE: "positive", WATCH: "info", INSUFFICIENT_DATA: "neutral" } as const;
const LABEL = { KILL: "Kill", BAD_TRAFFIC: "Bad traffic", SCALE: "Scale", WATCH: "Watch", INSUFFICIENT_DATA: "Not enough data" } as const;

export function VerdictBadge({ verdict }: { verdict: VerdictValue | null }) {
  if (!verdict) return <span className="text-subtle">—</span>;
  return <Badge tone={TONE[verdict]}>{LABEL[verdict]}</Badge>;
}
