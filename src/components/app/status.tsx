"use client";

import type { NormalizedStatus, OrderStatus } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/core";

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

const PARCEL_LABEL: Record<NormalizedStatus, string> = {
  PENDING: msg("Pending"),
  CONFIRMED: msg("Confirmed"),
  SHIPPED: msg("Shipped"),
  DELIVERED: msg("Delivered"),
  RETURNED: msg("Returned"),
  LOST: msg("Lost"),
  CANCELED: msg("Canceled"),
  EXCHANGED: msg("Exchanged"),
  UNKNOWN: msg("Unknown ⚠"),
};

export function ParcelStatusBadge({ status }: { status: NormalizedStatus | null | undefined }) {
  const { t } = useT();
  if (!status) return <span className="text-subtle">—</span>;
  return (
    <Badge tone={PARCEL_TONE[status]} className={status === "UNKNOWN" ? "border-dashed" : undefined}>
      {t(PARCEL_LABEL[status])}
    </Badge>
  );
}

const ORDER_TONE: Record<OrderStatus, "neutral" | "info" | "negative"> = { PENDING: "neutral", CONFIRMED: "info", CANCELED: "negative" };
const ORDER_LABEL: Record<OrderStatus, string> = { PENDING: msg("Pending"), CONFIRMED: msg("Confirmed"), CANCELED: msg("Canceled") };

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const { t } = useT();
  return <Badge tone={ORDER_TONE[status]}>{t(ORDER_LABEL[status])}</Badge>;
}
