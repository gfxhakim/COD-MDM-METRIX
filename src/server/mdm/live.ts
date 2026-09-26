import { assertPublicHost, validateMdmBaseUrl } from "./url";
import { MdmError, type MdmAdapter, type MdmPage, type MdmParcel } from "./types";

/**
 * Live MDM Express adapter.
 *
 * Everything that depends on MDM's API contract lives in `LIVE_SCHEMA` below:
 * the authentication header, the read-only test endpoint, how parcels are
 * listed/searched and paginated, and how response fields map to `MdmParcel`.
 *
 * It is deliberately `null`. The project rule is to read the raw OpenAPI schema
 * before implementing it rather than guess from endpoint names, and the schema
 * could not be fetched from this build environment (api.mdm.express is blocked
 * by its network policy). While it is null, the adapter refuses to run and sends
 * no request, so no credential ever leaves the server on a guessed contract.
 */
export type LiveSchema = {
  /** Set the auth header(s) on an outbound request. Never log the headers. */
  applyAuth(headers: Headers, credential: string): void;
  /** A cheap GET that proves the credential works and changes nothing. */
  testRequest(): { path: string; query?: Record<string, string> };
  accountLabel(body: unknown): string | null;
  /** GET request for one page of parcels. */
  parcelsRequest(q: { cursor: string | null; updatedSince: Date | null; pageSize: number }): { path: string; query?: Record<string, string> };
  parseParcelsPage(body: unknown): { items: MdmParcel[]; nextCursor: string | null; total?: number | null };
};

export const LIVE_SCHEMA: LiveSchema | null = null;

export const LIVE_ADAPTER_UNAVAILABLE =
  "The live MDM Express adapter is not enabled yet: its OpenAPI schema (authentication, pagination, parcel search and response fields) has not been verified. No request was sent to MDM.";

const TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 10 * 1024 * 1024;

function retryAfterMs(res: Response): number | undefined {
  const h = res.headers.get("retry-after");
  if (!h) return undefined;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.min(secs * 1000, 120_000);
  const at = Date.parse(h);
  return Number.isFinite(at) ? Math.max(0, Math.min(at - Date.now(), 120_000)) : undefined;
}

/** Hardened GET: SSRF checks, timeout, no redirects, body cap, typed errors. The credential is only placed in headers. */
export async function mdmGet(baseUrl: string, credential: string, schema: LiveSchema, req: { path: string; query?: Record<string, string> }, signal?: AbortSignal): Promise<unknown> {
  const base = validateMdmBaseUrl(baseUrl);
  const url = new URL(base + (req.path.startsWith("/") ? req.path : `/${req.path}`));
  if (url.origin !== new URL(base).origin) throw new MdmError("Refusing to call a different host", "CONFIG");
  for (const [k, v] of Object.entries(req.query ?? {})) url.searchParams.set(k, v);
  try {
    await assertPublicHost(url.hostname);
  } catch (e) {
    throw new MdmError((e as Error).message, "CONFIG");
  }
  const headers = new Headers({ accept: "application/json", "user-agent": "cod-flow-tracker/1.0" });
  schema.applyAuth(headers, credential);
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { method: "GET", headers, redirect: "error", signal: signal ? AbortSignal.any([signal, timeout]) : timeout, cache: "no-store" });
  } catch {
    throw new MdmError("Could not reach MDM Express (network error or timeout)", "NETWORK");
  }
  if (res.status === 401 || res.status === 403) throw new MdmError("MDM rejected the credential", "AUTH");
  if (res.status === 429) throw new MdmError("MDM rate limit reached", "RATE_LIMIT", retryAfterMs(res));
  if (res.status >= 500) throw new MdmError(`MDM server error (${res.status})`, "SERVER", retryAfterMs(res));
  if (!res.ok) throw new MdmError(`MDM returned ${res.status}`, "BAD_RESPONSE");
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_BODY_BYTES) throw new MdmError("MDM response too large", "BAD_RESPONSE");
  const text = await res.text();
  if (text.length > MAX_BODY_BYTES) throw new MdmError("MDM response too large", "BAD_RESPONSE");
  try {
    return JSON.parse(text);
  } catch {
    throw new MdmError("MDM returned a response that is not JSON", "BAD_RESPONSE");
  }
}

export function createLiveAdapter(opts: { baseUrl: string; credential: string | null; schema?: LiveSchema | null }): MdmAdapter {
  const schema = opts.schema === undefined ? LIVE_SCHEMA : opts.schema;
  const ready = () => {
    if (!schema) throw new MdmError(LIVE_ADAPTER_UNAVAILABLE, "NOT_AVAILABLE");
    if (!opts.credential) throw new MdmError("No credential saved for this workspace", "CONFIG");
    return { schema, credential: opts.credential };
  };
  return {
    kind: "live",
    async testConnection(signal) {
      const { schema: s, credential } = ready();
      const body = await mdmGet(opts.baseUrl, credential, s, s.testRequest(), signal);
      return { accountLabel: s.accountLabel(body) };
    },
    async listParcels(q, signal): Promise<MdmPage> {
      const { schema: s, credential } = ready();
      const body = await mdmGet(opts.baseUrl, credential, s, s.parcelsRequest(q), signal);
      try {
        return s.parseParcelsPage(body);
      } catch (e) {
        throw new MdmError(`Unexpected MDM response shape: ${(e as Error).message}`, "BAD_RESPONSE");
      }
    },
  };
}
