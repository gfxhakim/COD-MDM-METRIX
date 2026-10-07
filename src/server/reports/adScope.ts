import { adFilterActive, type AdFilter } from "@/domain/adFilter";
import { db } from "@/server/db";

/** The ads a report counts, resolved from an `AdFilter`: a set of campaigns, or a set of ad accounts. */
export type AdScope = { kind: "campaigns"; ids: ReadonlySet<string> } | { kind: "accounts"; ids: ReadonlySet<string> };

export async function resolveAdScope(workspaceId: string, f: AdFilter | null | undefined): Promise<AdScope | null> {
  if (!adFilterActive(f)) return null;
  if (f.campaignIds?.length) return { kind: "campaigns", ids: new Set(f.campaignIds) };
  if (f.adAccountIds?.length) return { kind: "accounts", ids: new Set(f.adAccountIds) };
  // A Business Manager counts the ad accounts its saved token reads.
  const rows = await db.adAccount.findMany({ where: { workspaceId, tokenId: { in: f.tokenIds ?? [] } }, select: { externalId: true } });
  return { kind: "accounts", ids: new Set(rows.map((r) => r.externalId)) };
}

/**
 * Whether a campaign (the platform's ID) or ad account is in scope. An ad account comes from the row
 * itself when it has one (spend read from Meta), else from its campaign.
 */
export function scopeMatcher(scope: AdScope, campaignAccount: ReadonlyMap<string, string | null>) {
  return (campaignId: string | null, adAccountId: string | null = null) => {
    if (scope.kind === "campaigns") return !!campaignId && scope.ids.has(campaignId);
    const account = adAccountId ?? (campaignId ? (campaignAccount.get(campaignId) ?? null) : null);
    return !!account && scope.ids.has(account);
  };
}

/** The campaigns (platform IDs) an order's ad must belong to, for database queries. */
export async function scopeCampaignIds(workspaceId: string, scope: AdScope): Promise<string[]> {
  if (scope.kind === "campaigns") return [...scope.ids];
  const rows = await db.campaign.findMany({ where: { workspaceId, adAccountId: { in: [...scope.ids] } }, select: { externalId: true } });
  return rows.map((r) => r.externalId);
}
