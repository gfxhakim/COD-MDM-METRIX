import type { NormalizedStatus } from "@prisma/client";

/**
 * Default MDM Express provider-status → normalized-status mapping.
 * Provider strings are compared after lowercasing and collapsing separators.
 * Anything not listed maps to UNKNOWN and is surfaced for review — never
 * silently treated as delivered or returned.
 */
export const DEFAULT_MDM_STATUS_MAP: Record<string, NormalizedStatus> = {
  pending: "PENDING",
  created: "PENDING",
  preparing: "CONFIRMED",
  packaged: "CONFIRMED",
  confirmed: "CONFIRMED",
  dispatched: "SHIPPED",
  shipped: "SHIPPED",
  in_transit: "SHIPPED",
  in_delivery: "SHIPPED",
  out_for_delivery: "SHIPPED",
  delivered: "DELIVERED",
  returning: "RETURNED",
  return_received: "RETURNED",
  returned: "RETURNED",
  lost: "LOST",
  refunded: "RETURNED",
  exchanged: "EXCHANGED",
  canceled: "CANCELED",
  cancelled: "CANCELED",
};

export function statusKey(providerStatus: string): string {
  return providerStatus.trim().toLowerCase().replace(/[\s\-]+/g, "_");
}

export function normalizeProviderStatus(
  providerStatus: string | null | undefined,
  overrides: Record<string, NormalizedStatus> = {},
): NormalizedStatus {
  if (!providerStatus) return "UNKNOWN";
  const key = statusKey(providerStatus);
  return overrides[key] ?? DEFAULT_MDM_STATUS_MAP[key] ?? "UNKNOWN";
}
