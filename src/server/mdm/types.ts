/** Provider-neutral shapes the sync engine works with. Adapters translate MDM responses into these. */

export type MdmEvent = { status: string; at: Date };

export type MdmParcel = {
  trackingId: string;
  /** The merchant's order reference as MDM stores it (first matching key). */
  reference: string | null;
  /** Store order ID echoed by MDM, when present (third matching key). */
  sourceOrderId: string | null;
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

export interface MdmAdapter {
  readonly kind: "mock" | "live";
  /** Read-only call proving the credential works. Must not create or change anything at MDM. */
  testConnection(signal?: AbortSignal): Promise<{ accountLabel: string | null }>;
  listParcels(query: { cursor: string | null; updatedSince: Date | null; pageSize: number }, signal?: AbortSignal): Promise<MdmPage>;
}
