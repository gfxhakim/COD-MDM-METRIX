/** Provider-neutral shapes the sync engine works with. Adapters translate MDM responses into these. */

export type MdmEvent = { status: string; at: Date };

export type MdmParcel = {
  trackingId: string;
  /** The merchant's order reference as MDM stores it (first matching key). */
  reference: string | null;
  /** Store order ID echoed by MDM, when present (third matching key). */
  sourceOrderId: string | null;
  /** MDM's tracking ID of the order this parcel ships, when the adapter knows it. */
  mdmOrderId?: string | null;
  status: string | null;
  statusAt: Date | null;
  /** Integer minor units in `currency`. */
  codAmount: number | null;
  currency: string;
  shippingFee: number | null;
  returnFee: number | null;
  wilaya: string | null;
  dispatchedAt: Date | null;
  deliveredAt: Date | null;
  returnedAt: Date | null;
  events: MdmEvent[];
  /** Original provider payload. PII keys are redacted before storage. */
  raw: unknown;
};

export type MdmPage = { items: MdmParcel[]; nextCursor: string | null; total?: number | null };

export type MdmUtm = { source: string | null; medium: string | null; campaign: string | null; content: string | null };

export type MdmOrderProduct = { ref: string | null; variantOf: string | null; name: string | null; quantity: number; unitPrice: number | null };

/**
 * An order as MDM's call center sees it. The customer's name, phones and street address are
 * carried so the sync can store them encrypted (src/server/customers.ts); the IP and GPS
 * position are never read.
 */
export type MdmOrder = {
  trackingId: string;
  /** The store's order ID or number (Shopify, EasySell…), when MDM has it. */
  externalId: string | null;
  status: string | null;
  statusAt: Date | null;
  /** MDM's own "confirmed" flag, used only when the status is not mapped. */
  confirmed: boolean | null;
  placedAt: Date;
  /** Integer minor units in `currency`. */
  total: number | null;
  currency: string;
  phone: string | null;
  /** Name, second phone and street address; null when MDM has none. */
  customer?: { name: string | null; phone2: string | null; address: string | null } | null;
  /** "HOME" or "STOP_DESK" when MDM says. */
  deliveryType?: "HOME" | "STOP_DESK" | null;
  storeName?: string | null;
  wilaya: string | null;
  city: string | null;
  utm: MdmUtm;
  products: MdmOrderProduct[];
};

/** `unreadable`: tracking IDs (or "?") of orders on the page that could not be read; the rest still sync. */
export type MdmOrdersPage = { items: MdmOrder[]; nextCursor: string | null; total?: number | null; unreadable?: string[] };

export type MdmErrorKind = "AUTH" | "RATE_LIMIT" | "SERVER" | "NETWORK" | "BAD_RESPONSE" | "NOT_AVAILABLE" | "CONFIG";

export class MdmError extends Error {
  constructor(
    message: string,
    public kind: MdmErrorKind,
    public retryAfterMs?: number,
  ) {
    super(message);
    this.name = "MdmError";
  }
  get retryable(): boolean {
    return this.kind === "RATE_LIMIT" || this.kind === "SERVER" || this.kind === "NETWORK";
  }
}

export type MdmDateRange = { start?: Date; end?: Date };

/** Search filters MDM's order search accepts (GetOrdersRequestFilters). A custom sync uses them to read fewer orders. */
export type MdmOrderFilters = {
  createdAt?: MdmDateRange;
  statusDate?: MdmDateRange;
  isStopDesk?: boolean;
  trackingIds?: string[];
  externalIds?: string[];
};

export type MdmOrderQuery = { cursor: string | null; updatedSince: Date | null; pageSize: number; filters?: MdmOrderFilters };
/** `mdmOrderIds`: only the parcels of these MDM orders (GetParcelsRequestFilters.orderId). */
export type MdmParcelQuery = { cursor: string | null; updatedSince: Date | null; pageSize: number; mdmOrderIds?: string[] };

export const hasOrderFilters = (f?: MdmOrderFilters) => !!f && Object.values(f).some((v) => v !== undefined && (!Array.isArray(v) || v.length > 0));

export interface MdmAdapter {
  readonly kind: "mock" | "live";
  /** Read-only call proving the credential works. Must not create or change anything at MDM. */
  testConnection(signal?: AbortSignal): Promise<{ accountLabel: string | null; providerStatuses?: string[] }>;
  listParcels(query: MdmParcelQuery, signal?: AbortSignal): Promise<MdmPage>;
  /** Orders created or changed since `updatedSince`, narrowed by `filters`. Adapters without order access leave it out. */
  listOrders?(query: MdmOrderQuery, signal?: AbortSignal): Promise<MdmOrdersPage>;
  /** UTM tags found in an order's status history (the landing URL the store sent), or null. */
  orderUtm?(trackingId: string, signal?: AbortSignal): Promise<MdmUtm | null>;
}
