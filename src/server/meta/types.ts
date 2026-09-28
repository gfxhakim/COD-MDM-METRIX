/** Provider-neutral shapes the spend sync works with. The Meta client translates Graph API responses into these. */

export type MetaAdAccount = {
  /** "act_<id>" */
  id: string;
  name: string | null;
  currency: string | null;
  timezone: string | null;
  accountStatus: number | null;
};

/** One ad's delivery on one day, in the ad account's currency and time zone. */
export type MetaSpendRow = {
  /** YYYY-MM-DD in the ad account's time zone. */
  date: string;
  adId: string;
  adName: string | null;
  adsetId: string | null;
  adsetName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  /** Integer minor units of `currency`. */
  spend: number;
  currency: string;
  impressions: number | null;
  /** Link clicks, as in the Ads Manager export. */
  clicks: number | null;
};

export type MetaSpendPage = { rows: MetaSpendRow[]; next: string | null };

export type MetaErrorKind = "AUTH" | "PERMISSION" | "RATE_LIMIT" | "SERVER" | "NETWORK" | "BAD_REQUEST" | "BAD_RESPONSE" | "CONFIG";

export class MetaError extends Error {
  constructor(
    message: string,
    public kind: MetaErrorKind,
    public retryAfterMs?: number,
  ) {
    super(message);
    this.name = "MetaError";
  }
  get retryable(): boolean {
    return this.kind === "RATE_LIMIT" || this.kind === "SERVER" || this.kind === "NETWORK";
  }
}

export interface MetaAdapter {
  readonly kind: "mock" | "live";
  /** Ad accounts the token can read. Read-only. */
  listAdAccounts(signal?: AbortSignal): Promise<MetaAdAccount[]>;
  /** Spend per ad per day for `since`..`until` (inclusive, account time zone), one page at a time. */
  dailyAdSpend(q: { accountId: string; since: string; until: string; cursor: string | null; currency: string }, signal?: AbortSignal): Promise<MetaSpendPage>;
}
