import type { NormalizedStatus } from "@prisma/client";

/**
 * Default MDM Express provider-status → normalized-status mapping.
 * Provider strings are compared after lowercasing and collapsing separators.
 * Anything not listed maps to UNKNOWN and is surfaced for review — never
 * silently treated as delivered or returned. Partial deliveries and collection
 * states are left out on purpose. A workspace's own mapping (Settings → Status
 * mappings) always wins over these defaults.
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
  // MDM Express vocabulary. The API sends kebab-case ("out-for-delivery"); some
  // endpoints use camelCase. Their lifecycle, from MDM's shipping-performance
  // transitions: preparing → packaged → received → in-transit → ready-for-delivery
  // → out-for-delivery → delivery-attempt-failed (retried) → delivered, or
  // delivery-failed → return-ready → returned.
  waiting_collection: "CONFIRMED",
  ready_for_dispatch: "CONFIRMED",
  // Waiting for stock: never left the warehouse.
  out_of_stock: "CONFIRMED",
  // MDM's hub has the parcel; it is in the carrier's hands.
  received: "SHIPPED",
  ready_for_delivery: "SHIPPED",
  // Still out with the carrier and will be tried again.
  delivery_attempt_failed: "SHIPPED",
  postponed: "SHIPPED",
  waiting_for_client: "SHIPPED",
  // MDM is still searching; only "lost" is final.
  missing: "SHIPPED",
  // Final failure: the next MDM steps are return-ready and returned.
  delivery_failed: "RETURNED",
  return_ready: "RETURNED",
  payment_ready: "DELIVERED",
  settled: "DELIVERED",
  refunded: "RETURNED",
  exchanged: "EXCHANGED",
  canceled: "CANCELED",
  cancelled: "CANCELED",
};

export function statusKey(providerStatus: string): string {
  return providerStatus
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase().replace(/[\s\-]+/g, "_");
}

export function normalizeProviderStatus(
  providerStatus: string | null | undefined,
  overrides: Record<string, NormalizedStatus> = {},
): NormalizedStatus {
  if (!providerStatus) return "UNKNOWN";
  const key = statusKey(providerStatus);
  return overrides[key] ?? DEFAULT_MDM_STATUS_MAP[key] ?? "UNKNOWN";
}

/** Statuses that mean the parcel left the warehouse. */
export const SHIPPED_STATES: NormalizedStatus[] = ["SHIPPED", "DELIVERED", "RETURNED", "LOST", "EXCHANGED"];
