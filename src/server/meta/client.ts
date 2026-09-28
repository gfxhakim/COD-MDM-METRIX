import { MoneyError, parseToMinor } from "@/lib/money";
import { MetaError, type MetaAdAccount, type MetaAdapter, type MetaErrorKind, type MetaSpendPage, type MetaSpendRow } from "./types";

/**
 * Live Meta Marketing API client (read-only).
 *
 * - Host is fixed to graph.facebook.com; nothing user-supplied goes into the URL path.
 * - The access token travels only in the Authorization header, never in a URL.
 * - Only GET requests: ad accounts (`/me/adaccounts`), insights (`/act_<id>/insights`), and the
 *   token's granted permissions (`/me/permissions`) to explain a refused listing.
 * - Insights are read per ad per day (`level=ad`, `time_increment=1`), including ads
 *   that were paused, archived or deleted since, so their spend still counts.
 * - Spend comes back as a string in the account currency's major units ("1234.56").
 *
 * API version: Marketing API v25.0 (the newest as of Sep 2026). Override with
 * META_GRAPH_VERSION when Meta retires it.
 */
export const META_HOST = "https://graph.facebook.com";
export const metaVersion = () => (/^v\d{2}\.0$/.test(process.env.META_GRAPH_VERSION ?? "") ? process.env.META_GRAPH_VERSION! : "v25.0");

const TIMEOUT_MS = 30_000;
const MAX_BODY_BYTES = 20 * 1024 * 1024;
export const INSIGHTS_PAGE_SIZE = 500;

const INSIGHT_FIELDS = ["date_start", "ad_id", "ad_name", "adset_id", "adset_name", "campaign_id", "campaign_name", "spend", "impressions", "inline_link_clicks", "account_currency"].join(",");
/** Every ad state, so spend of ads paused, archived or deleted later is still read. */
const ALL_AD_STATES = ["ACTIVE", "PAUSED", "DELETED", "ARCHIVED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "IN_PROCESS", "WITH_ISSUES", "DISAPPROVED", "PENDING_REVIEW", "PREAPPROVED", "PENDING_BILLING_INFO"];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);
const int = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.round(n) : null;
};

/**
 * Fixed, user-facing messages per Graph error; the provider's own text is never shown or stored.
 * Meta's error number is kept (it is only a number) so a failure can be diagnosed from a screenshot.
 */
export function metaErrorFrom(status: number, body: unknown, retryAfterMs?: number): MetaError {
  const err = isObj(body) && isObj(body.error) ? body.error : {};
  const code = typeof err.code === "number" ? err.code : null;
  const subcode = typeof err.error_subcode === "number" ? err.error_subcode : null;
  const msg = typeof err.message === "string" ? err.message : "";
  const metaCode = code !== null ? `${code}${subcode !== null ? `, subcode ${subcode}` : ""}` : undefined;
  const e = (message: string, kind: MetaErrorKind, retry?: number) => new MetaError(metaCode ? `${message} (Meta error ${metaCode})` : message, kind, retry, metaCode);
  if (code === 190 || status === 401) return e("Meta rejected the access token. It may have expired or been revoked: generate a new one and save it here.", "AUTH");
  if (code === 4 || code === 17 || code === 32 || code === 613 || (code !== null && code >= 80000 && code <= 80014)) return e("Meta's rate limit was reached. The sync will try again shortly.", "RATE_LIMIT", retryAfterMs ?? 60_000);
  if (code === 10 || (code !== null && code >= 200 && code <= 299) || status === 403) return e("The token can't read this ad account. Give the system user access to it with the ads_read permission.", "PERMISSION");
  if (code === 100 && /appsecret_proof/i.test(msg)) return e("Your Meta app requires an app secret proof. In the app's Advanced settings, turn off \"Require app secret\", or use a token from an app without it.", "CONFIG");
  if (code === 1 || code === 2 || status >= 500) return e(`Meta had a temporary problem (${status}). The sync will try again.`, "SERVER", retryAfterMs);
  if (code === 100 || status === 400) return e("Meta refused the request as invalid.", "BAD_REQUEST");
  return e(`Meta returned ${status}.`, "BAD_RESPONSE");
}

/** Permissions the token was granted (`/me/permissions`), or null when Meta won't say. */
async function grantedPermissions(token: string, signal?: AbortSignal): Promise<Set<string> | null> {
  try {
    const body = await metaGet(token, "/me/permissions", { limit: "100" }, signal);
    if (!Array.isArray(body.data)) return null;
    return new Set(body.data.filter((p) => isObj(p) && p.status === "granted" && typeof p.permission === "string").map((p) => (p as Obj).permission as string));
  } catch {
    return null;
  }
}

/**
 * Meta refused to list the token's ad accounts at all (as opposed to listing none).
 * Says which side to fix: a token made without ads_read, or an app Meta won't let read ads.
 */
async function listingRefused(token: string, e: MetaError, signal?: AbortSignal): Promise<MetaError> {
  const granted = await grantedPermissions(token, signal);
  const suffix = e.metaCode ? ` (Meta error ${e.metaCode})` : "";
  const message = !granted
    ? "Meta won't let this token list its ad accounts. Generate a new token for the system user with ads_read ticked, and check that your Meta app has the Marketing API."
    : granted.has("ads_read") || granted.has("ads_management")
      ? "The token has ads_read, but Meta still won't list its ad accounts. Check that your Meta app has the Marketing API and is connected to this Business Manager, then generate a new token."
      : "This token was made without the ads_read permission, so Meta won't list its ad accounts. Generate a new token for the system user with ads_read ticked, then use Replace token.";
  return new MetaError(message + suffix, "PERMISSION", undefined, e.metaCode);
}

/** Hardened read-only GET to the Graph API. The token only goes in the Authorization header. */
export async function metaGet(token: string, path: string, params: Record<string, string>, signal?: AbortSignal): Promise<Obj> {
  if (!/^\/[A-Za-z0-9_/]+$/.test(path)) throw new MetaError("Refusing an unexpected Meta API path", "CONFIG");
  const url = new URL(`${META_HOST}/${metaVersion()}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: new Headers({ accept: "application/json", authorization: `Bearer ${token}`, "user-agent": "cod-flow-tracker/1.0" }),
      redirect: "error",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      cache: "no-store",
    });
  } catch {
    throw new MetaError("Could not reach Meta (network error or timeout).", "NETWORK");
  }
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_BODY_BYTES) throw new MetaError("Meta's response was too large.", "BAD_RESPONSE");
  const text = await res.text();
  if (text.length > MAX_BODY_BYTES) throw new MetaError("Meta's response was too large.", "BAD_RESPONSE");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  if (!res.ok || (isObj(body) && isObj(body.error))) {
    const ra = Number(res.headers.get("retry-after"));
    throw metaErrorFrom(res.status, body, Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 300_000) : undefined);
  }
  if (!isObj(body)) throw new MetaError("Meta returned a response that is not JSON.", "BAD_RESPONSE");
  return body;
}

export function mapAdAccount(raw: unknown): MetaAdAccount | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id) ?? (str(raw.account_id) ? `act_${str(raw.account_id)}` : null);
  if (!id || !/^act_\d{1,30}$/.test(id)) return null;
  return { id, name: str(raw.name), currency: str(raw.currency)?.toUpperCase() ?? null, timezone: str(raw.timezone_name), accountStatus: int(raw.account_status) };
}

/** One insights row. Rows without an ad ID or date are skipped; a spend that is not a number fails the page. */
export function mapSpendRow(raw: unknown, fallbackCurrency: string): MetaSpendRow | null {
  if (!isObj(raw)) return null;
  const adId = str(raw.ad_id);
  const date = str(raw.date_start);
  if (!adId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const currency = (str(raw.account_currency) ?? fallbackCurrency).toUpperCase();
  let spend: number;
  try {
    spend = raw.spend == null || raw.spend === "" ? 0 : parseToMinor(raw.spend as string | number, currency);
  } catch (e) {
    if (e instanceof MoneyError) throw new MetaError("Meta sent a spend amount that is not a number.", "BAD_RESPONSE");
    throw e;
  }
  return {
    date,
    adId,
    adName: str(raw.ad_name),
    adsetId: str(raw.adset_id),
    adsetName: str(raw.adset_name),
    campaignId: str(raw.campaign_id),
    campaignName: str(raw.campaign_name),
    spend,
    currency,
    impressions: int(raw.impressions),
    clicks: int(raw.inline_link_clicks),
  };
}

const after = (body: Obj): string | null => {
  const paging = isObj(body.paging) ? body.paging : {};
  const cursors = isObj(paging.cursors) ? paging.cursors : {};
  // Meta only sends `next` when there is another page.
  return typeof paging.next === "string" && typeof cursors.after === "string" && cursors.after ? cursors.after : null;
};

export function createLiveMetaAdapter(token: string | null): MetaAdapter {
  const ready = () => {
    if (!token) throw new MetaError("No Meta access token saved for this workspace.", "CONFIG");
    return token;
  };
  return {
    kind: "live",
    async listAdAccounts(signal) {
      const t = ready();
      const out: MetaAdAccount[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 20; page++) {
        let body: Obj;
        try {
          body = await metaGet(t, "/me/adaccounts", { fields: "id,account_id,name,currency,timezone_name,account_status", limit: "100", ...(cursor ? { after: cursor } : {}) }, signal);
        } catch (e) {
          throw e instanceof MetaError && e.kind === "PERMISSION" ? await listingRefused(t, e, signal) : e;
        }
        if (!Array.isArray(body.data)) throw new MetaError("Unexpected response from Meta (ad accounts).", "BAD_RESPONSE");
        for (const a of body.data) {
          const m = mapAdAccount(a);
          if (m) out.push(m);
        }
        cursor = after(body);
        if (!cursor) break;
      }
      return out;
    },
    async dailyAdSpend({ accountId, since, until, cursor, currency }, signal): Promise<MetaSpendPage> {
      const t = ready();
      if (!/^act_\d{1,30}$/.test(accountId)) throw new MetaError("Unexpected ad account ID.", "CONFIG");
      const body = await metaGet(
        t,
        `/${accountId}/insights`,
        {
          level: "ad",
          time_increment: "1",
          time_range: JSON.stringify({ since, until }),
          fields: INSIGHT_FIELDS,
          filtering: JSON.stringify([{ field: "ad.effective_status", operator: "IN", value: ALL_AD_STATES }]),
          limit: String(INSIGHTS_PAGE_SIZE),
          ...(cursor ? { after: cursor } : {}),
        },
        signal,
      );
      if (!Array.isArray(body.data)) throw new MetaError("Unexpected response from Meta (insights).", "BAD_RESPONSE");
      const rows = body.data.map((r) => mapSpendRow(r, currency)).filter((r): r is MetaSpendRow => r !== null);
      return { rows, next: after(body) };
    },
  };
}
