import { Prisma, type AdPlatform } from "@prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { assertCan, NotFoundError, type WorkspaceContext } from "@/server/tenancy";
import type { MetaCampaign } from "@/server/meta/types";

/** Meta statuses that mean the campaign is on. */
export const RUNNING_STATUSES = new Set(["ACTIVE", "IN_PROCESS", "WITH_ISSUES"]);
/** Set once Meta stops listing a campaign: it was archived or deleted. */
export const NOT_LISTED = "NOT_LISTED";

const campaignKey = (workspaceId: string, platform: AdPlatform, externalId: string) => ({ workspaceId_platform_externalId: { workspaceId, platform, externalId } });

/** An upsert that tolerates a concurrent insert of the same campaign. */
async function upsertCampaign(args: Prisma.CampaignUpsertArgs) {
  try {
    await db.campaign.upsert(args);
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    await db.campaign.update({ where: args.where, data: args.update });
  }
}

/**
 * Campaigns Meta lists for one ad account, with their status. Campaigns of that account it no
 * longer lists were archived or deleted, so they are marked NOT_LISTED.
 */
export async function recordMetaCampaigns(workspaceId: string, adAccountId: string, campaigns: MetaCampaign[], at: Date) {
  for (const c of campaigns) {
    const fields = { adAccountId, status: c.status, statusCheckedAt: at };
    await upsertCampaign({
      where: campaignKey(workspaceId, "META", c.id),
      create: { workspaceId, platform: "META", externalId: c.id, name: c.name, ...fields },
      update: { ...(c.name ? { name: c.name } : {}), ...fields },
    });
  }
  await db.campaign.updateMany({
    where: { workspaceId, platform: "META", adAccountId, externalId: { notIn: campaigns.map((c) => c.id) }, OR: [{ status: null }, { status: { not: NOT_LISTED } }] },
    data: { status: NOT_LISTED, statusCheckedAt: at },
  });
}

/**
 * Makes sure every campaign ID seen in ad spend or on an ad has a campaign row, and that every
 * ad knows its campaign. Spend imported from a CSV and ads first seen through orders are covered
 * too, so campaigns work without the Meta connection.
 */
export async function ensureCampaigns(workspaceId: string) {
  const loose = await db.adSpend.findMany({
    where: { workspaceId, campaignId: { not: null }, creative: { is: { campaignId: null } } },
    distinct: ["creativeId"],
    select: { creativeId: true, campaignId: true, campaignName: true },
  });
  for (const r of loose) if (r.creativeId) await db.creative.update({ where: { id: r.creativeId }, data: { campaignId: r.campaignId, ...(r.campaignName ? { campaignName: r.campaignName } : {}) } });

  const [spend, ads, known] = await Promise.all([
    db.adSpend.groupBy({ by: ["platform", "campaignId", "adAccountId"], where: { workspaceId, campaignId: { not: null } }, _max: { campaignName: true } }),
    db.creative.groupBy({ by: ["platform", "campaignId"], where: { workspaceId, campaignId: { not: null } }, _max: { campaignName: true } }),
    db.campaign.findMany({ where: { workspaceId }, select: { platform: true, externalId: true, name: true, adAccountId: true } }),
  ]);
  const seen = new Map<string, { platform: AdPlatform; externalId: string; name: string | null; adAccountId: string | null }>();
  for (const r of [...spend, ...ads.map((a) => ({ ...a, adAccountId: null }))]) {
    const k = `${r.platform}|${r.campaignId}`;
    const had = seen.get(k);
    seen.set(k, { platform: r.platform, externalId: r.campaignId!, name: had?.name ?? r._max.campaignName ?? null, adAccountId: had?.adAccountId ?? r.adAccountId });
  }
  const current = new Map(known.map((c) => [`${c.platform}|${c.externalId}`, c]));
  for (const [k, c] of seen) {
    const had = current.get(k);
    if (!had) {
      await upsertCampaign({ where: campaignKey(workspaceId, c.platform, c.externalId), create: { workspaceId, ...c }, update: {} });
    } else if ((!had.name && c.name) || (!had.adAccountId && c.adAccountId)) {
      await db.campaign.update({ where: campaignKey(workspaceId, c.platform, c.externalId), data: { ...(!had.name && c.name ? { name: c.name } : {}), ...(!had.adAccountId && c.adAccountId ? { adAccountId: c.adAccountId } : {}) } });
    }
  }
}

/** Ad accounts and campaigns with their product links, for the pickers. */
export async function listAdLinks(ctx: WorkspaceContext) {
  await ensureCampaigns(ctx.workspaceId);
  const [accounts, campaigns] = await Promise.all([
    db.adAccount.findMany({ where: { workspaceId: ctx.workspaceId }, orderBy: [{ name: "asc" }, { externalId: "asc" }], select: { id: true, externalId: true, name: true, enabled: true, defaultProductId: true } }),
    db.campaign.findMany({ where: { workspaceId: ctx.workspaceId }, orderBy: [{ name: "asc" }, { externalId: "asc" }], select: { id: true, externalId: true, name: true, adAccountId: true, status: true, productId: true } }),
  ]);
  return { accounts, campaigns: campaigns.map((c) => ({ ...c, running: c.status !== null && RUNNING_STATUSES.has(c.status) })) };
}

async function assertProduct(ctx: WorkspaceContext, productId: string | null) {
  if (!productId) return;
  const p = await db.product.findFirst({ where: { id: productId, workspaceId: ctx.workspaceId }, select: { id: true } });
  if (!p) throw new NotFoundError("Product not found");
}

export async function setCampaignProduct(ctx: WorkspaceContext, input: { id: string; productId: string | null }) {
  assertCan(ctx, "catalog.write");
  const c = await db.campaign.findFirst({ where: { id: input.id, workspaceId: ctx.workspaceId } });
  if (!c) throw new NotFoundError("Campaign not found");
  await assertProduct(ctx, input.productId);
  await db.campaign.update({ where: { id: c.id }, data: { productId: input.productId } });
  await audit(ctx, "campaign.product_linked", { type: "Campaign", id: c.id }, { campaign: c.externalId, productId: input.productId, previousProductId: c.productId });
  return { ok: true };
}

export async function setAdAccountProduct(ctx: WorkspaceContext, input: { id: string; productId: string | null }) {
  assertCan(ctx, "catalog.write");
  const a = await db.adAccount.findFirst({ where: { id: input.id, workspaceId: ctx.workspaceId } });
  if (!a) throw new NotFoundError("Ad account not found");
  await assertProduct(ctx, input.productId);
  await db.adAccount.update({ where: { id: a.id }, data: { defaultProductId: input.productId } });
  await audit(ctx, "ad_account.product_linked", { type: "AdAccount", id: a.id }, { account: a.externalId, productId: input.productId, previousProductId: a.defaultProductId });
  return { ok: true };
}

/**
 * Sets which ad accounts and campaigns count for one product: the listed ones are linked to it
 * (moving them from another product if needed), and ones linked to it that are not listed are unlinked.
 */
export async function setProductLinks(ctx: WorkspaceContext, input: { productId: string; campaignIds: string[]; adAccountIds: string[] }) {
  assertCan(ctx, "catalog.write");
  const w = ctx.workspaceId;
  await assertProduct(ctx, input.productId);
  const [campaigns, accounts] = await Promise.all([
    db.campaign.count({ where: { workspaceId: w, id: { in: input.campaignIds } } }),
    db.adAccount.count({ where: { workspaceId: w, id: { in: input.adAccountIds } } }),
  ]);
  if (campaigns !== new Set(input.campaignIds).size) throw new NotFoundError("Campaign not found");
  if (accounts !== new Set(input.adAccountIds).size) throw new NotFoundError("Ad account not found");
  const changed = await db.$transaction(async (tx) => {
    const linkC = await tx.campaign.updateMany({ where: { workspaceId: w, id: { in: input.campaignIds }, OR: [{ productId: null }, { productId: { not: input.productId } }] }, data: { productId: input.productId } });
    const unlinkC = await tx.campaign.updateMany({ where: { workspaceId: w, productId: input.productId, id: { notIn: input.campaignIds } }, data: { productId: null } });
    const linkA = await tx.adAccount.updateMany({ where: { workspaceId: w, id: { in: input.adAccountIds }, OR: [{ defaultProductId: null }, { defaultProductId: { not: input.productId } }] }, data: { defaultProductId: input.productId } });
    const unlinkA = await tx.adAccount.updateMany({ where: { workspaceId: w, defaultProductId: input.productId, id: { notIn: input.adAccountIds } }, data: { defaultProductId: null } });
    return { campaignsLinked: linkC.count, campaignsUnlinked: unlinkC.count, accountsLinked: linkA.count, accountsUnlinked: unlinkA.count };
  });
  await audit(ctx, "product.ads_linked", { type: "Product", id: input.productId }, { campaigns: input.campaignIds.length, adAccounts: input.adAccountIds.length, ...changed });
  return changed;
}
