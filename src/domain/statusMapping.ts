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
  // Generic carrier vocabulary.
  created: "PENDING",
  confirmed: "CONFIRMED",
  shipped: "SHIPPED",
  in_delivery: "SHIPPED",
  return_received: "RETURNED",
  settled: "DELIVERED",
  refunded: "RETURNED",
  exchanged: "EXCHANGED",
  canceled: "CANCELED",

  // MDM Express, as the business owner described each status (2026-09-28). MDM sends
  // kebab-case ("out-for-delivery"); some endpoints use camelCase.
  // Confirmation calls: not confirmed yet, nothing counted.
  pending: "PENDING",
  not_answer: "PENDING",
  not_answered: "PENDING",
  no_answer: "PENDING",
  call_later: "PENDING",
  // Waiting for stock: neither confirmed nor canceled yet.
  out_of_stock: "PENDING",
  // Canceled by the client, before or after confirming: counted as canceled, not confirmed.
  cancelled: "CANCELED",
  canceled_after_confirmation: "CANCELED",
  cancelled_after_confirmation: "CANCELED",
  // Confirmed and being prepared in the warehouse.
  preparing: "CONFIRMED",
  packaged: "CONFIRMED",
  ready_for_dispatch: "CONFIRMED",
  waiting_collection: "CONFIRMED",
  // With the carrier, result not known yet: dispatched → received at the station →
  // in-transit to the wilaya's stop desk → ready-for-delivery → out-for-delivery, with
  // postponements and failed attempts that are tried again.
  dispatched: "SHIPPED",
  received: "SHIPPED",
  in_transit: "SHIPPED",
  ready_for_delivery: "SHIPPED",
  out_for_delivery: "SHIPPED",
  postponed: "SHIPPED",
  delivery_attempt_failed: "SHIPPED",
  waiting_for_client: "SHIPPED",
  // MDM is still searching; only "lost" is final.
  missing: "SHIPPED",
  // Delivered and paid by the client.
  delivered: "DELIVERED",
  payment_ready: "DELIVERED",
  // Delivery stopped after repeated failures, and the way back to the warehouse.
  delivery_failed: "RETURNED",
  returning: "RETURNED",
  return_ready: "RETURNED",
  returned: "RETURNED",
  lost: "LOST",
};

export function statusKey(providerStatus: string): string {
  return providerStatus
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase().replace(/[\s\-]+/g, "_");
}

/** "outForDelivery" or "not-answered" → "Out for delivery" or "Not answered". */
export function providerStatusLabel(providerStatus: string): string {
  const words = statusKey(providerStatus).replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
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

/** A parcel in one of these means its order was confirmed. */
export const CONFIRMING_STATES: NormalizedStatus[] = ["CONFIRMED", ...SHIPPED_STATES];
