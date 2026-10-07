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
  /** MDM's upsell flag, when the order itself carries one (the documented order shape does not). */
  upsell?: boolean | null;
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
  /** Only orders MDM's call center upsold. */
  upsell?: boolean;
};

export type MdmOrderQuery = { cursor: string | null; updatedSince: Date | null; pageSize: number; filters?: MdmOrderFilters };
/** `mdmOrderIds`: only the parcels of these MDM orders (GetParcelsRequestFilters.orderId). */
export type MdmParcelQuery = { cursor: string | null; updatedSince: Date | null; pageSize: number; mdmOrderIds?: string[] };

export const hasOrderFilters = (f?: MdmOrderFilters) => !!f && Object.values(f).some((v) => v !== undefined && (!Array.isArray(v) || v.length > 0));

// ───────────── The seller's MDM account: money and stock (read-only) ─────────────

/** Integer minor units of the wallet's currency. */
export type MdmWalletAmounts = { onHold: number; ready: number; paid: number };
export const WALLET_PARTS = ["gross", "taxes", "refunds", "sourcing", "addedCharges", "deductedCharges"] as const;
export type MdmWalletPart = (typeof WALLET_PARTS)[number];
/**
 * The seller's MDM wallet: money MDM holds back (on hold, e.g. still inside the return window),
 * money the seller can collect now (ready), and money already paid out.
 */
export type MdmWallet = MdmWalletAmounts & { currency: string; details: Partial<Record<MdmWalletPart, Partial<MdmWalletAmounts>>> };

export type MdmPayoutRecord = { id: string; amount: number; currency: string; status: string; confirmed: boolean; sellerId: string | null; storeNames: string[]; createdAt: Date; updatedAt: Date };
/** What a payout is made of, by MDM's line type. Totals in minor units. */
export type MdmPayoutBreakdown = { currency: string; items: { type: string; count: number; total: number; grossTotal: number | null }[]; taxes: { type: string; count: number; total: number }[] };

/** One line of the seller's account at MDM: money collected for a parcel, or a fee charged for it. */
export type MdmFeeLine = {
  id: string;
  sellerId: string | null;
  entityId: string | null;
  type: string;
  subType: string | null;
  amount: number;
  grossAmount: number | null;
  taxes: number | null;
  currency: string;
  status: string;
  payoutId: string | null;
  /** The parcel and order the line is about, when MDM says. */
  parcelTrackingId: string | null;
  orderTrackingId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MdmCallCenterPrices = { type: string | null; perLead: number | null; perConfirmed: number | null; perDelivered: number | null; upsellExtra: number | null };
export type MdmFulfilmentPrices = { type: string | null; perDispatched: number | null; perDelivered: number | null; maxItems: number | null; extraPerItem: number | null };
export type MdmDeliveryPrice = { wilaya: string; code: string | null; home: number | null; stopDesk: number | null; return: number | null; exchange: number | null };
/** What MDM charges this seller, from its price list. Minor units of `currency`. */
export type MdmPriceList = { currency: string; callCenter: MdmCallCenterPrices | null; fulfilment: MdmFulfilmentPrices | null; delivery: MdmDeliveryPrice[]; usdRate: number | null; euroRate: number | null };

export type MdmVariant = { id: string; productId: string; productName: string; variantName: string | null; sku: string | null; sellingPrice: number | null; purchasePrice: number | null; currency: string; archived: boolean };
export const STOCK_COUNTS = ["totalInbound", "incoming", "available", "processing", "inDelivery", "delivered", "returning", "returned", "damaged", "discharged", "lost"] as const;
export type MdmStockCounts = Record<(typeof STOCK_COUNTS)[number], number>;
export const CAPITAL_BUCKETS = ["totalInbound", "available", "processing", "inDelivery", "returning", "lost"] as const;
/** Stock units and their value by state. Values in minor units of `currency`. */
export type MdmCapital = { currency: string; buckets: Record<(typeof CAPITAL_BUCKETS)[number], { units: number; value: number }> };

/** Stock sent into MDM's warehouse. */
export type MdmArrival = { id: string; status: string; operation: string | null; products: { name: string; sku: string | null; expected: number }[]; expectedUnits: number; receivedUnits: number; damagedUnits: number; createdAt: Date; updatedAt: Date };

export type MdmListQuery = { cursor: string | null; updatedSince: Date | null; pageSize: number };
/** `unreadable`: records on the page that came in an unexpected shape and were skipped. */
export type MdmList<T> = { items: T[]; nextCursor: string | null; total?: number | null; unreadable?: number };

/** Read-only access to the seller's money and stock at MDM. Each read may be refused (AUTH) on its own. */
export interface MdmAccountReader {
  /** MDM's ID for the logged-in account. */
  profileId(signal?: AbortSignal): Promise<string | null>;
  wallet(signal?: AbortSignal): Promise<MdmWallet>;
  payouts(q: MdmListQuery, signal?: AbortSignal): Promise<MdmList<MdmPayoutRecord>>;
  payoutBreakdown(payoutId: string, signal?: AbortSignal): Promise<MdmPayoutBreakdown>;
  fees(q: MdmListQuery, signal?: AbortSignal): Promise<MdmList<MdmFeeLine>>;
  prices(sellerId: string, signal?: AbortSignal): Promise<MdmPriceList>;
  /** Product variants, newest first, with their product's name. */
  variants(q: MdmListQuery, signal?: AbortSignal): Promise<MdmList<MdmVariant>>;
  stock(variant: { productId: string; id: string }, signal?: AbortSignal): Promise<MdmStockCounts>;
  capital(currency: string, signal?: AbortSignal): Promise<MdmCapital>;
  /** Stock arrivals, newest first. */
  arrivals(q: MdmListQuery, signal?: AbortSignal): Promise<MdmList<MdmArrival>>;
}

export interface MdmAdapter {
  readonly kind: "mock" | "live";
  /** Read-only call proving the credential works. Must not create or change anything at MDM. */
  testConnection(signal?: AbortSignal): Promise<{ accountLabel: string | null; providerStatuses?: string[] }>;
  listParcels(query: MdmParcelQuery, signal?: AbortSignal): Promise<MdmPage>;
  /** Orders created or changed since `updatedSince`, narrowed by `filters`. Adapters without order access leave it out. */
  listOrders?(query: MdmOrderQuery, signal?: AbortSignal): Promise<MdmOrdersPage>;
  /** UTM tags found in an order's status history (the landing URL the store sent), or null. */
  orderUtm?(trackingId: string, signal?: AbortSignal): Promise<MdmUtm | null>;
  /** The seller's wallet, payouts, fees, prices and stock. Adapters without it leave it out. */
  account?: MdmAccountReader;
}
