import { afterEach, describe, expect, it, vi } from "vitest";
import { createLiveMetaAdapter, mapSpendRow, metaErrorFrom } from "@/server/meta/client";
import { addDays, localDate, syncWindow } from "@/server/meta/sync";

/**
 * Contract tests for the Meta Marketing API client, built from Meta's documented
 * response shapes (`/me/adaccounts`, `/act_<id>/insights`). Placeholder IDs and a
 * placeholder token only.
 */
const TOKEN = "EAAplaceholderTOKEN0000000000000001";

type Call = { url: URL; headers: Headers; method: string };
function stubGraph(handler: (url: URL) => { status?: number; body: unknown }) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: URL, init: RequestInit) => {
    const u = new URL(String(url));
    calls.push({ url: u, headers: new Headers(init.headers), method: String(init.method) });
    const r = handler(u);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  }));
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("Meta client", () => {
  it("lists ad accounts with the token in a header only, following pages", async () => {
    const calls = stubGraph((u) =>
      u.searchParams.get("after")
        ? { body: { data: [{ id: "act_222", account_id: "222", name: "Second", currency: "usd", timezone_name: "America/Los_Angeles", account_status: 1 }], paging: { cursors: { before: "b", after: "c2" } } } }
        : { body: { data: [{ id: "act_111", account_id: "111", name: "First", currency: "DZD", timezone_name: "Africa/Algiers", account_status: 1 }, { id: "not-an-account" }], paging: { cursors: { before: "a", after: "c1" }, next: "https://graph.facebook.com/v25.0/me/adaccounts?after=c1" } } },
    );
    const accounts = await createLiveMetaAdapter(TOKEN).listAdAccounts();
    expect(accounts).toEqual([
      { id: "act_111", name: "First", currency: "DZD", timezone: "Africa/Algiers", accountStatus: 1 },
      { id: "act_222", name: "Second", currency: "USD", timezone: "America/Los_Angeles", accountStatus: 1 },
    ]);
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      expect(c.method).toBe("GET");
      expect(c.url.origin).toBe("https://graph.facebook.com");
      expect(c.url.pathname).toBe("/v25.0/me/adaccounts");
      expect(c.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
      expect(c.url.toString()).not.toContain(TOKEN);
      expect(c.url.searchParams.has("access_token")).toBe(false);
    }
    expect(calls[1].url.searchParams.get("after")).toBe("c1");
  });

  it("reads spend per ad per day, including ads paused, archived or deleted since", async () => {
    const calls = stubGraph(() => ({
      body: {
        data: [
          { date_start: "2026-09-27", date_stop: "2026-09-27", ad_id: "120000000000041", ad_name: "Hook 41", adset_id: "9", adset_name: "Broad", campaign_id: "7", campaign_name: "Spring", spend: "12.34", impressions: "5000", inline_link_clicks: "80", account_currency: "USD" },
          { date_start: "2026-09-27", spend: "3.00" },
        ],
        paging: { cursors: { after: "n1" }, next: "https://graph.facebook.com/next" },
      },
    }));
    const page = await createLiveMetaAdapter(TOKEN).dailyAdSpend({ accountId: "act_222", since: "2026-09-01", until: "2026-09-27", cursor: null, currency: "USD" });
    expect(page).toEqual({
      rows: [{ date: "2026-09-27", adId: "120000000000041", adName: "Hook 41", adsetId: "9", adsetName: "Broad", campaignId: "7", campaignName: "Spring", spend: 1234, currency: "USD", impressions: 5000, clicks: 80 }],
      next: "n1",
    });
    const p = calls[0].url.searchParams;
    expect(calls[0].url.pathname).toBe("/v25.0/act_222/insights");
    expect(p.get("level")).toBe("ad");
    expect(p.get("time_increment")).toBe("1");
    expect(JSON.parse(p.get("time_range")!)).toEqual({ since: "2026-09-01", until: "2026-09-27" });
    expect(p.get("fields")).toContain("spend");
    expect(JSON.parse(p.get("filtering")!)[0]).toMatchObject({ field: "ad.effective_status", operator: "IN", value: expect.arrayContaining(["ACTIVE", "PAUSED", "ARCHIVED", "DELETED"]) });
    await expect(createLiveMetaAdapter(TOKEN).dailyAdSpend({ accountId: "act_1/../me", since: "2026-09-01", until: "2026-09-27", cursor: null, currency: "USD" })).rejects.toMatchObject({ kind: "CONFIG" });
  });

  it("maps Graph errors to fixed messages, never Meta's own text", () => {
    const e = (code: number, message = "secret detail from Meta", status = 400) => metaErrorFrom(status, { error: { code, message, type: "OAuthException" } });
    expect(e(190)).toMatchObject({ kind: "AUTH" });
    expect(e(17)).toMatchObject({ kind: "RATE_LIMIT", retryable: true });
    expect(e(80000)).toMatchObject({ kind: "RATE_LIMIT" });
    expect(e(200)).toMatchObject({ kind: "PERMISSION", retryable: false });
    expect(e(100, "API calls from the server require an appsecret_proof argument")).toMatchObject({ kind: "CONFIG" });
    expect(e(2, "x", 500)).toMatchObject({ kind: "SERVER", retryable: true });
    for (const code of [190, 17, 200, 100, 2]) expect(e(code).message).not.toContain("secret detail");
    // Meta's error number (never its text) is kept so a screenshot is enough to diagnose.
    expect(e(200).message).toMatch(/\(Meta error 200\)$/);
    expect(metaErrorFrom(400, { error: { code: 100, error_subcode: 33, message: "secret detail" } })).toMatchObject({ metaCode: "100, subcode 33", message: expect.stringMatching(/\(Meta error 100, subcode 33\)$/) });
    expect(metaErrorFrom(403, null).message).not.toMatch(/Meta error/);
    expect(() => mapSpendRow({ ad_id: "1", date_start: "2026-09-01", spend: "lots" }, "USD")).toThrow(/not a number/);
  });

  it("surfaces a rejected token from the API as an auth error", async () => {
    stubGraph(() => ({ status: 400, body: { error: { code: 190, message: "Error validating access token", type: "OAuthException" } } }));
    await expect(createLiveMetaAdapter(TOKEN).listAdAccounts()).rejects.toMatchObject({ kind: "AUTH" });
    await expect(createLiveMetaAdapter(null).listAdAccounts()).rejects.toMatchObject({ kind: "CONFIG" });
  });
});

describe("Meta refusing to list a token's ad accounts", () => {
  const refused = (permissions: { status?: number; body: unknown }) =>
    stubGraph((u) => (u.pathname.endsWith("/me/permissions") ? permissions : { status: 400, body: { error: { code: 200, message: "secret detail from Meta", type: "OAuthException" } } }));

  it("says so when the token was made without ads_read", async () => {
    const calls = refused({ body: { data: [{ permission: "business_management", status: "granted" }, { permission: "ads_read", status: "declined" }] } });
    const e = await createLiveMetaAdapter(TOKEN).listAdAccounts().catch((x) => x);
    expect(e).toMatchObject({ kind: "PERMISSION", metaCode: "200" });
    expect(e.message).toMatch(/^This token was made without the ads_read permission.*\(Meta error 200\)$/);
    expect(e.message).not.toContain("secret detail");
    expect(calls.map((c) => c.url.pathname)).toEqual(["/v25.0/me/adaccounts", "/v25.0/me/permissions"]);
    for (const c of calls) {
      expect(c.method).toBe("GET");
      expect(c.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
      expect(c.url.toString()).not.toContain(TOKEN);
    }
  });

  it("points at the Meta app when the token does have ads_read", async () => {
    refused({ body: { data: [{ permission: "ads_read", status: "granted" }] } });
    await expect(createLiveMetaAdapter(TOKEN).listAdAccounts()).rejects.toMatchObject({ kind: "PERMISSION", message: expect.stringMatching(/^The token has ads_read, but Meta still won't list.*Marketing API/) });
  });

  it("falls back to both checks when Meta won't show the permissions", async () => {
    refused({ status: 400, body: { error: { code: 100, message: "secret detail" } } });
    await expect(createLiveMetaAdapter(TOKEN).listAdAccounts()).rejects.toMatchObject({ kind: "PERMISSION", message: expect.stringMatching(/^Meta won't let this token list its ad accounts.*ads_read.*\(Meta error 200\)$/) });
  });

  it("keeps the per-account message when one ad account is refused", async () => {
    stubGraph(() => ({ status: 403, body: { error: { code: 10, message: "secret detail" } } }));
    await expect(createLiveMetaAdapter(TOKEN).dailyAdSpend({ accountId: "act_222", since: "2026-09-01", until: "2026-09-27", cursor: null, currency: "USD" })).rejects.toMatchObject({ kind: "PERMISSION", message: expect.stringMatching(/^The token can't read this ad account.*\(Meta error 10\)$/) });
  });
});

describe("Meta sync window", () => {
  const now = new Date("2026-09-28T23:30:00Z");
  it("uses the ad account's own calendar day", () => {
    expect(localDate(now, "Africa/Algiers")).toBe("2026-09-29");
    expect(localDate(now, "America/Los_Angeles")).toBe("2026-09-28");
    expect(localDate(now, "Not/AZone")).toBe("2026-09-28");
  });

  it("reads 180 days the first time, then the days since the last sync plus 3", () => {
    expect(syncWindow({ timezone: "Africa/Algiers", lastSyncedAt: null }, now, false)).toEqual({ since: addDays("2026-09-29", -179), until: "2026-09-29" });
    expect(syncWindow({ timezone: "Africa/Algiers", lastSyncedAt: new Date("2026-09-28T10:00:00Z") }, now, false)).toEqual({ since: "2026-09-25", until: "2026-09-29" });
    expect(syncWindow({ timezone: "Africa/Algiers", lastSyncedAt: new Date("2025-01-01T00:00:00Z") }, now, false).since).toBe(addDays("2026-09-29", -179));
    expect(syncWindow({ timezone: "Africa/Algiers", lastSyncedAt: new Date("2026-09-28T10:00:00Z") }, now, true).since).toBe(addDays("2026-09-29", -179));
  });
});
