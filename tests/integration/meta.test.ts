import { beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { reencryptCredentials } from "@/server/crypto/rotate";
import { decryptSecret } from "@/server/crypto/secrets";
import { testMeta } from "@/server/meta/connection";
import { createMockMetaAdapter, type MockMetaOptions } from "@/server/meta/mock";
import { runDueMetaSyncs, runMetaSync } from "@/server/meta/sync";
import { MetaError, metaTokenPurpose, type MetaAdAccount, type MetaAdapter, type MetaSpendRow } from "@/server/meta/types";
import { addMember, cost, makeTenant } from "../helpers";

type Tenant = Awaited<ReturnType<typeof makeTenant>>;
const TOKEN = "EAAplaceholderTOKEN0000000000000042";
const NOW = new Date("2026-09-28T12:00:00Z");
const noSleep = async () => {};
const DAY = "2026-09-27";
const RANGE = { from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-09-30T23:59:59Z") };

const DZD_ACCOUNT: MetaAdAccount = { id: "act_111", name: "Main account", currency: "DZD", timezone: "Africa/Algiers", accountStatus: 1 };
const USD_ACCOUNT: MetaAdAccount = { id: "act_222", name: "Dollar account", currency: "USD", timezone: "America/Los_Angeles", accountStatus: 1 };
const row = (adId: string, spend: number, over: Partial<MetaSpendRow> = {}): MetaSpendRow => ({
  date: DAY, adId, adName: `Hook ${adId.slice(-2)}`, adsetId: "900", adsetName: "Broad", campaignId: "700", campaignName: "Spring", spend, currency: "DZD", impressions: 4000, clicks: 60, ...over,
});

async function connected(name: string) {
  const t = await makeTenant(name);
  await t.caller.integrations.saveMetaToken({ label: "Main BM", token: TOKEN });
  await db.metaToken.updateMany({ where: { workspaceId: t.ws.id }, data: { status: "CONNECTED" } });
  await db.integrationConnection.updateMany({ where: { workspaceId: t.ws.id, provider: "META_ADS" }, data: { status: "CONNECTED" } });
  return t;
}
const tokenId = async (t: Tenant, label = "Main BM") => (await db.metaToken.findFirstOrThrow({ where: { workspaceId: t.ws.id, label } })).id;

function sync(t: Tenant, opts: Omit<MockMetaOptions, "token">, extra: { full?: boolean; now?: Date } = {}) {
  const adapter = createMockMetaAdapter({ token: TOKEN, ...opts });
  const run = runMetaSync(t.ws.id, { full: extra.full }, { adapterFactory: async () => adapter, sleep: noSleep, now: () => extra.now ?? NOW });
  return run.then((result) => ({ result, adapter }));
}

const spendTotal = async (t: Tenant) => (await t.caller.reports.dashboard(RANGE)).metrics.adSpend;

describe("Meta token", () => {
  it("is encrypted, only ever shown masked, and only owners and admins manage it", async () => {
    const t = await makeTenant("MetaToken");
    const view = await t.caller.integrations.saveMetaToken({ token: TOKEN });
    expect(view).toMatchObject({ hasToken: true, status: "UNTESTED", tokens: [{ label: "Business Manager 1", maskedLabel: "••••0042", status: "UNTESTED", accounts: 0 }] });
    expect(JSON.stringify(view)).not.toContain(TOKEN);
    const row = await db.metaToken.findFirstOrThrow({ where: { workspaceId: t.ws.id } });
    expect(row.encryptedCredential).toMatch(/^v1:/);
    expect(row.encryptedCredential).not.toContain("placeholderTOKEN");
    // Bound to this token: it can't be decrypted as another token or another workspace.
    expect(decryptSecret(row.encryptedCredential, { workspaceId: t.ws.id, purpose: metaTokenPurpose(row.id) })).toBe(TOKEN);
    expect(() => decryptSecret(row.encryptedCredential, { workspaceId: t.ws.id, purpose: metaTokenPurpose("00000000-0000-4000-8000-000000000000") })).toThrow();
    expect(JSON.stringify(await db.auditLog.findMany({ where: { workspaceId: t.ws.id } }))).not.toContain("placeholderTOKEN");

    const analyst = await addMember(t.ws.id, "ANALYST");
    await expect(analyst.caller.integrations.saveMetaToken({ token: TOKEN })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(analyst.caller.integrations.syncMeta({ full: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(JSON.stringify(await analyst.caller.integrations.meta())).not.toContain(TOKEN);
    await expect(t.caller.integrations.saveMetaToken({ token: "short" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Another workspace's token can't be touched.
    const other = await makeTenant("MetaTokenOther");
    await expect(other.caller.integrations.saveMetaToken({ id: row.id, label: "Mine now" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(other.caller.integrations.removeMetaToken({ id: row.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(other.caller.integrations.testMeta({ id: row.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Sync needs a passing test first.
    await expect(t.caller.integrations.syncMeta({ full: false })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("the connection test lists every ad account and switches them all on", async () => {
    const t = await makeTenant("MetaTest");
    await t.caller.integrations.saveMetaToken({ label: "Main BM", token: TOKEN });
    const id = await tokenId(t);
    const ok = await testMeta(t.ctx, { id }, async () => createMockMetaAdapter({ token: TOKEN, accounts: [DZD_ACCOUNT, USD_ACCOUNT] }));
    expect(ok).toMatchObject({ ok: true, connection: { status: "CONNECTED" } });
    expect(ok.message).toContain("2 ad accounts");
    expect(ok.connection.accounts.map((a) => [a.externalId, a.enabled, a.tokenId])).toEqual(expect.arrayContaining([["act_111", true, id], ["act_222", true, id]]));
    expect(ok.connection.tokens).toMatchObject([{ id, status: "CONNECTED", accounts: 2 }]);

    const bad = await testMeta(t.ctx, { id }, async () => createMockMetaAdapter({ token: "invalid-token-0000000000000" }));
    expect(bad).toMatchObject({ ok: false, connection: { status: "ERROR", tokens: [{ id, status: "ERROR" }] } });
  });
});

describe("Meta spend sync", () => {
  let t: Tenant;
  let product: { id: string };
  let orderId: string;

  beforeAll(async () => {
    t = await connected("MetaSync");
    product = await t.caller.products.create({ name: "Lamp", sku: "LMP", cost });
    await t.caller.workspace.updateSettings({ exchangeRates: { USD: 250 } });
    // An order whose content ID is an ad Meta hasn't reported yet, and a creative first seen through MDM orders (no name).
    orderId = (await t.caller.orders.create({ orderNumber: "#3001", placedAt: new Date(`${DAY}T10:00:00Z`), status: "CONFIRMED", codAmount: 390000, utmContent: "120000000000041", lines: [{ productId: product.id, quantity: 1, unitPrice: 390000 }] })).id;
    await db.creative.create({ data: { workspaceId: t.ws.id, platform: "META", externalCreativeId: "120000000000042", normalizedKey: "120000000000042" } });
  });

  it("stores spend per ad per day on the creative whose content ID is the ad ID", async () => {
    const rows = { act_111: [row("120000000000041", 150000), row("120000000000042", 50000)], act_222: [row("120000000000043", 1000, { currency: "USD" })] };
    const { result, adapter } = await sync(t, { accounts: [DZD_ACCOUNT, USD_ACCOUNT], rows });
    expect(result).toMatchObject({ ran: true, ok: true, accounts: 2, added: 3, updated: 0, error: null });

    // First sync: the last 180 days, 30 days per request, in each account's own time zone.
    const first = adapter.calls.filter((c) => c.accountId === "act_111");
    expect(first[0].since).toBe("2026-04-02");
    expect(first.at(-1)!.until).toBe("2026-09-28");
    expect(first).toHaveLength(6);

    const creative = await db.creative.findFirstOrThrow({ where: { workspaceId: t.ws.id, externalCreativeId: "120000000000041" } });
    // Its product comes only from a campaign or ad account link someone sets, even with one product.
    expect(creative).toMatchObject({ name: "Hook 41", campaignName: "Spring", productId: null });
    // The order that arrived first is now attributed to it.
    expect(await db.attribution.findUniqueOrThrow({ where: { orderId } })).toMatchObject({ creativeId: creative.id, method: "UTM_CONTENT" });
    // The creative first seen through orders gets the ad's name.
    expect(await db.creative.findFirstOrThrow({ where: { workspaceId: t.ws.id, externalCreativeId: "120000000000042" } })).toMatchObject({ name: "Hook 42", campaignName: "Spring" });

    // 10.00 USD at 250 = 2 500.00 DZD; the original is kept.
    expect(await db.adSpend.findFirstOrThrow({ where: { workspaceId: t.ws.id, adId: "120000000000043" } })).toMatchObject({ source: "META_API", spend: 250000, currency: "DZD", originalSpend: 1000, originalCurrency: "USD", fxRate: 250, adAccountId: "act_222", date: new Date(`${DAY}T00:00:00Z`) });
    expect(await spendTotal(t)).toBe(450000);

    const view = await t.caller.integrations.meta();
    expect(view).toMatchObject({ syncing: false, lastError: null, lastSyncSummary: { accounts: 2, added: 3, spend: 450000 } });
    expect(view.lastSuccessfulSyncAt).toEqual(NOW);
  });

  it("then re-reads only the recent days, and picks up Meta's corrections", async () => {
    const later = new Date(NOW.getTime() + 3_600_000);
    const rows = { act_111: [row("120000000000041", 160000), row("120000000000042", 50000)], act_222: [row("120000000000043", 1000, { currency: "USD" })] };
    const { result, adapter } = await sync(t, { accounts: [DZD_ACCOUNT, USD_ACCOUNT], rows }, { now: later });
    expect(result).toMatchObject({ ok: true, added: 0, updated: 1, unchanged: 2 });
    expect(adapter.calls.filter((c) => c.accountId === "act_111")).toEqual([{ accountId: "act_111", since: "2026-09-25", until: "2026-09-28" }]);
    expect(await spendTotal(t)).toBe(460000);
  });

  it("never counts an uploaded CSV row and Meta's row for the same ad and day twice", async () => {
    const header = "Day,Campaign name,Ad set name,Ad name,Ad ID,Amount spent (DZD),Impressions";
    const mapping = { date: "Day", campaignName: "Campaign name", adsetName: "Ad set name", adName: "Ad name", adId: "Ad ID", spend: "Amount spent (DZD)", impressions: "Impressions" };
    const csv = (csvText: string) => ({ kind: "AD_SPEND" as const, fileName: "meta.csv", csvText, fileSize: csvText.length, mapping, options: { dateFormat: "AUTO" as const } });
    // Same ad and day as Meta (superseded), and a day Meta didn't report (counted).
    const res = await t.caller.imports.commit(csv(`${header}\n${DAY},Spring,Broad,Hook 41,120000000000041,1400,3900\n2026-09-10,Spring,Broad,Hook 41,120000000000041,900,2000`));
    expect(res).toMatchObject({ importedRows: 2, summary: expect.objectContaining({ supersededByMeta: 1 }) });
    expect(await spendTotal(t)).toBe(460000 + 90000);

    // A CSV imported before the Meta connection is superseded by the next sync.
    const other = await connected("MetaCsvFirst");
    await other.caller.imports.commit(csv(`${header}\n${DAY},Spring,Broad,Hook 51,120000000000051,1400,3900`));
    expect(await spendTotal(other)).toBe(140000);
    await sync(other, { accounts: [DZD_ACCOUNT], rows: { act_111: [row("120000000000051", 150000)] } });
    expect(await spendTotal(other)).toBe(150000);
    expect(await db.adSpend.findFirstOrThrow({ where: { workspaceId: other.ws.id, source: "META_CSV" } })).toMatchObject({ supersededAt: NOW });
  });
});

describe("Meta sync problems", () => {
  it("keeps syncing the other accounts when one lacks an exchange rate", async () => {
    const t = await connected("MetaNoRate");
    const { result } = await sync(t, { accounts: [DZD_ACCOUNT, USD_ACCOUNT], rows: { act_111: [row("120000000000061", 100000)], act_222: [row("120000000000062", 500, { currency: "USD" })] } });
    expect(result).toMatchObject({ ran: true, ok: false, added: 1 });
    expect(result.ran && result.error).toContain("USD exchange rate");
    const accounts = await db.adAccount.findMany({ where: { workspaceId: t.ws.id }, orderBy: { externalId: "asc" } });
    expect(accounts.map((a) => [a.externalId, a.lastError === null])).toEqual([["act_111", true], ["act_222", false]]);
    expect((await db.integrationConnection.findFirstOrThrow({ where: { workspaceId: t.ws.id, provider: "META_ADS" } })).status).toBe("CONNECTED");
  });

  it("retries rate limits, and stops with a clear message when the token is rejected", async () => {
    const t = await connected("MetaErrors");
    const slept: number[] = [];
    const adapter = createMockMetaAdapter({ token: TOKEN, accounts: [DZD_ACCOUNT], rows: { act_111: [row("120000000000071", 100000)] }, failures: { act_111: [new MetaError("slow down", "RATE_LIMIT", 5000)] } });
    const ok = await runMetaSync(t.ws.id, {}, { adapterFactory: async () => adapter, sleep: async (ms) => { slept.push(ms); }, now: () => NOW });
    expect(ok).toMatchObject({ ok: true, added: 1 });
    expect(slept).toEqual([5000]);

    const { result } = await sync(t, { accounts: [DZD_ACCOUNT], failures: { list: [new MetaError("Meta rejected the access token.", "AUTH")] } }, { now: new Date(NOW.getTime() + 60_000) });
    expect(result).toMatchObject({ ran: true, ok: false });
    const conn = await db.integrationConnection.findFirstOrThrow({ where: { workspaceId: t.ws.id, provider: "META_ADS" } });
    expect(conn).toMatchObject({ status: "ERROR", syncLeaseUntil: null });
    expect(conn.lastError).toContain("access token");
    expect(await db.metaToken.findFirstOrThrow({ where: { workspaceId: t.ws.id } })).toMatchObject({ status: "ERROR", lastError: expect.stringContaining("access token") });
    // Nothing runs until a new test passes.
    expect(await runMetaSync(t.ws.id, {}, { adapterFactory: async () => adapter, sleep: noSleep, now: () => NOW })).toEqual({ ran: false, reason: "not_connected" });
  });

  it("never runs two syncs at once, skips switched-off accounts, and follows the interval", async () => {
    const t = await connected("MetaLease");
    await db.integrationConnection.updateMany({ where: { workspaceId: t.ws.id, provider: "META_ADS" }, data: { syncLeaseUntil: new Date(NOW.getTime() + 60_000) } });
    expect((await sync(t, { accounts: [DZD_ACCOUNT] })).result).toEqual({ ran: false, reason: "running" });
    await db.integrationConnection.updateMany({ where: { workspaceId: t.ws.id, provider: "META_ADS" }, data: { syncLeaseUntil: null } });

    await testMeta(t.ctx, { id: await tokenId(t) }, async () => createMockMetaAdapter({ token: TOKEN, accounts: [DZD_ACCOUNT, USD_ACCOUNT] }));
    const usd = await db.adAccount.findFirstOrThrow({ where: { workspaceId: t.ws.id, externalId: "act_222" } });
    await t.caller.integrations.setAdAccountEnabled({ id: usd.id, enabled: false });
    const adapter = createMockMetaAdapter({ token: TOKEN, accounts: [DZD_ACCOUNT, USD_ACCOUNT] });
    const deps = { adapterFactory: async () => adapter, sleep: noSleep, now: () => NOW };
    // Other workspaces' connections are due too; only this one's calls are counted.
    await runDueMetaSyncs(NOW, deps);
    expect(adapter.calls.every((c) => c.accountId === "act_111")).toBe(true);
    const n = adapter.calls.length;
    expect(n).toBeGreaterThan(0);
    await runDueMetaSyncs(new Date(NOW.getTime() + 10 * 60_000), deps);
    expect(adapter.calls.length).toBe(n);
  });
});

describe("Several Business Managers", () => {
  const SHARED: MetaAdAccount = { id: "act_333", name: "Shared account", currency: "DZD", timezone: "Africa/Algiers", accountStatus: 1 };
  const TOKEN_B = "EAAplaceholderTOKEN00000000000000BB";

  it("reads every ad account of every token once, and one rejected token doesn't stop the others", async () => {
    const t = await connected("MetaMultiBM");
    await t.caller.integrations.saveMetaToken({ label: "Second BM", token: TOKEN_B });
    const [a, b] = [await tokenId(t), await tokenId(t, "Second BM")];
    const rows = { act_111: [row("120000000000081", 100000)], act_222: [row("120000000000082", 20000)], act_333: [row("120000000000083", 30000)] };
    const adapters = {
      [a]: createMockMetaAdapter({ token: TOKEN, accounts: [DZD_ACCOUNT, SHARED], rows }),
      [b]: createMockMetaAdapter({ token: TOKEN_B, accounts: [{ ...USD_ACCOUNT, currency: "DZD" }, SHARED], rows }),
    };
    const factory = async (_ws: string, tok: { id: string }): Promise<MetaAdapter> => adapters[tok.id];

    // Each token's test lists its accounts; the shared one stays with the token that read it first.
    await testMeta(t.ctx, { id: a }, factory);
    const tested = await testMeta(t.ctx, { id: b }, factory);
    expect(tested.message).toContain("1 of them is already read through another saved token");
    const owners = (v: typeof tested.connection) => Object.fromEntries(v.accounts.map((x) => [x.externalId, x.tokenId]));
    expect(owners(tested.connection)).toEqual({ act_111: a, act_222: b, act_333: a });
    expect(tested.connection.tokens.map((x) => [x.label, x.accounts])).toEqual([["Main BM", 2], ["Second BM", 1]]);

    const first = await runMetaSync(t.ws.id, {}, { adapterFactory: factory, sleep: noSleep, now: () => NOW });
    expect(first).toMatchObject({ ran: true, ok: true, accounts: 3, added: 3 });
    // The shared account is read once, with the older token.
    expect(adapters[a].calls.some((c) => c.accountId === "act_333")).toBe(true);
    expect(adapters[b].calls.some((c) => c.accountId === "act_333")).toBe(false);
    expect(await spendTotal(t)).toBe(150000);

    // The second token is revoked: its own account waits, everything else keeps syncing.
    adapters[b] = createMockMetaAdapter({ token: "invalid-revoked-token-000000000" });
    const second = await runMetaSync(t.ws.id, { full: true }, { adapterFactory: factory, sleep: noSleep, now: () => new Date(NOW.getTime() + 60_000) });
    expect(second).toMatchObject({ ran: true, ok: false, accounts: 2 });
    expect(second.ran && second.error).toContain("Second BM");
    const view = await t.caller.integrations.meta();
    expect(view.status).toBe("CONNECTED");
    expect(view.tokens.map((x) => [x.label, x.status])).toEqual([["Main BM", "CONNECTED"], ["Second BM", "ERROR"]]);

    // Removing the first token releases its accounts; the second, once replaced and tested, picks up the shared one.
    await t.caller.integrations.removeMetaToken({ id: a });
    expect(owners(await t.caller.integrations.meta())).toEqual({ act_111: null, act_222: b, act_333: null });
    await t.caller.integrations.saveMetaToken({ id: b, token: TOKEN_B });
    adapters[b] = createMockMetaAdapter({ token: TOKEN_B, accounts: [{ ...USD_ACCOUNT, currency: "DZD" }, SHARED], rows });
    const retest = await testMeta(t.ctx, { id: b }, factory);
    expect(owners(retest.connection)).toEqual({ act_111: null, act_222: b, act_333: b });
    // Spend already synced is kept.
    expect(await spendTotal(t)).toBe(150000);
    // Renaming keeps the token.
    const renamed = await t.caller.integrations.saveMetaToken({ id: b, label: "Shop 2" });
    expect(renamed.tokens).toMatchObject([{ id: b, label: "Shop 2", status: "CONNECTED", maskedLabel: "••••00BB" }]);
  });

  it("key rotation re-encrypts every saved token", async () => {
    const t = await connected("MetaRotate");
    const id = await tokenId(t);
    const oldKey = process.env.APP_ENCRYPTION_KEY!;
    vi.stubEnv("APP_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    vi.stubEnv("APP_ENCRYPTION_KEY_PREVIOUS", oldKey);
    vi.stubEnv("APP_ENCRYPTION_KEY_VERSION", "2");
    try {
      expect(await reencryptCredentials(2, { workspaceId: t.ws.id })).toEqual({ reencrypted: 1, alreadyCurrent: 0, failed: [], customersFailed: 0 });
      const row = await db.metaToken.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({ keyVersion: 2, encryptedCredential: expect.stringMatching(/^v1:2:/) });
      vi.stubEnv("APP_ENCRYPTION_KEY_PREVIOUS", "");
      expect(decryptSecret(row.encryptedCredential, { workspaceId: t.ws.id, purpose: metaTokenPurpose(id) })).toBe(TOKEN);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
