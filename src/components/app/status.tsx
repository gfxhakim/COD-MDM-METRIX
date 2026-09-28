import type { NormalizedStatus, OrderStatus } from "@prisma/client";
import { Badge } from "@/components/ui/badge";

const PARCEL_TONE: Record<NormalizedStatus, "neutral" | "positive" | "warning" | "negative" | "info" | "mint"> = {
  PENDING: "neutral",
  CONFIRMED: "info",
  SHIPPED: "warning",
  DELIVERED: "positive",
  RETURNED: "negative",
  LOST: "negative",
  CANCELED: "neutral",
  EXCHANGED: "mint",
  UNKNOWN: "negative",
};

export function ParcelStatusBadge({ status }: { status: NormalizedStatus | null | undefined }) {
  if (!status) return <span className="text-subtle">—</span>;
  return (
    <Badge tone={PARCEL_TONE[status]} className={status === "UNKNOWN" ? "border-dashed" : undefined}>
      {status === "UNKNOWN" ? "Unknown ⚠" : status.charAt(0) + status.slice(1).toLowerCase()}
    </Badge>
  );
}

const ORDER_TONE: Record<OrderStatus, "neutral" | "info" | "negative"> = { PENDING: "neutral", CONFIRMED: "info", CANCELED: "negative" };

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge tone={ORDER_TONE[status]}>{status.charAt(0) + status.slice(1).toLowerCase()}</Badge>;
}
