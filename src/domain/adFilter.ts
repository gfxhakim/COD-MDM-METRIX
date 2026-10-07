import { z } from "zod";

/**
 * Which Meta ads a page counts: Business Managers (saved tokens), ad accounts, or campaigns from any
 * ad accounts. The most precise level picked wins: campaigns, else ad accounts, else the ad accounts
 * of the Business Managers. Nothing picked means every ad, and orders without an ad too.
 */
export const adFilterSchema = z
  .object({
    tokenIds: z.array(z.string().uuid()).max(50).optional(),
    adAccountIds: z.array(z.string().regex(/^act_\d{1,30}$/)).max(500).optional(),
    campaignIds: z.array(z.string().trim().min(1).max(100)).max(2000).optional(),
  })
  .strict();

export type AdFilter = z.infer<typeof adFilterSchema>;

export const adFilterActive = (f: AdFilter | null | undefined): f is AdFilter => !!f && !!(f.tokenIds?.length || f.adAccountIds?.length || f.campaignIds?.length);

/** What the filter counts, in a few words: "3 campaigns", "2 ad accounts", "1 Business Manager". */
export function adFilterLabel(f: AdFilter | null | undefined): string {
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  if (!adFilterActive(f)) return "All ads";
  if (f.campaignIds?.length) return n(f.campaignIds.length, "campaign", "campaigns");
  if (f.adAccountIds?.length) return n(f.adAccountIds.length, "ad account", "ad accounts");
  return n(f.tokenIds!.length, "Business Manager", "Business Managers");
}
