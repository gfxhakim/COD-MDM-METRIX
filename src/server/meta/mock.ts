import { MetaError, type MetaAdAccount, type MetaAdapter, type MetaCampaign, type MetaSpendPage, type MetaSpendRow } from "./types";

/**
 * Mocked Meta adapter. Demo workspaces get one clearly labelled demo account with no
 * spend, so the setup can be tried without a real token. Tests script accounts, rows
 * and failures. It never makes a network call.
 */
export type MockMetaOptions = {
  token: string | null;
  accounts?: MetaAdAccount[];
  /** Rows per ad account ID; filtered to the requested days. */
  rows?: Record<string, MetaSpendRow[]>;
  pageSize?: number;
  /** Campaigns per ad account ID. Without it, the campaigns in `rows` are listed as ACTIVE. */
  campaigns?: Record<string, MetaCampaign[]>;
  /** Errors thrown per ad account (one per call, in order), or for the account listing under "list"
   * and a campaign listing under "campaigns:<account ID>". */
  failures?: Record<string, MetaError[]>;
};

export const DEMO_META_ACCOUNT: MetaAdAccount = { id: "act_1000000000000001", name: "Demo ad account (not a real Meta account)", currency: "DZD", timezone: "Africa/Algiers", accountStatus: 1 };

export function createMockMetaAdapter(opts: MockMetaOptions): MetaAdapter & { calls: { accountId: string; since: string; until: string }[] } {
  const failures = new Map(Object.entries(opts.failures ?? {}).map(([k, v]) => [k, [...v]]));
  const calls: { accountId: string; since: string; until: string }[] = [];
  const check = () => {
    if (!opts.token) throw new MetaError("No Meta access token saved for this workspace.", "CONFIG");
    if (opts.token.startsWith("invalid")) throw new MetaError("Meta rejected the access token (demo).", "AUTH");
  };
  const fail = (key: string) => {
    const queued = failures.get(key);
    if (queued?.length) throw queued.shift()!;
  };
  return {
    kind: "mock",
    calls,
    async listAdAccounts() {
      check();
      fail("list");
      return opts.accounts ?? [DEMO_META_ACCOUNT];
    },
    async dailyAdSpend({ accountId, since, until, cursor }): Promise<MetaSpendPage> {
      check();
      calls.push({ accountId, since, until });
      fail(accountId);
      const all = (opts.rows?.[accountId] ?? []).filter((r) => r.date >= since && r.date <= until);
      const size = opts.pageSize ?? 500;
      const page = cursor ? Number(cursor) : 0;
      return { rows: all.slice(page * size, (page + 1) * size), next: (page + 1) * size < all.length ? String(page + 1) : null };
    },
    async listCampaigns(accountId) {
      check();
      fail(`campaigns:${accountId}`);
      if (opts.campaigns) return opts.campaigns[accountId] ?? [];
      const seen = new Map<string, MetaCampaign>();
      for (const r of opts.rows?.[accountId] ?? []) if (r.campaignId && !seen.has(r.campaignId)) seen.set(r.campaignId, { id: r.campaignId, name: r.campaignName, status: "ACTIVE" });
      return [...seen.values()];
    },
  };
}
