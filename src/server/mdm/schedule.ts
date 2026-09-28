import { db } from "@/server/db";
import { enqueueSync } from "./sync";

/**
 * Scheduled MDM syncs. Hosting-neutral: the same `runSchedulerTick` is called by
 * - the in-process poller in the web server (every minute, see runner.ts),
 * - the standalone worker (`npm run sync:worker`),
 * - an external cron hitting `POST /api/cron/sync` with `Authorization: Bearer $CRON_SECRET`.
 * Running more than one of them is safe: the per-workspace lock allows one active job,
 * and a workspace is only due once its interval has passed since its last job.
 */
const PROVIDER = "MDM_EXPRESS" as const;
const MAX_PER_TICK = 200;

/** Queue an incremental sync for every connected workspace whose interval has elapsed. */
export async function scheduleDueSyncs(now = new Date()) {
  const conns = await db.integrationConnection.findMany({
    where: { provider: PROVIDER, status: "CONNECTED", encryptedCredential: { not: null }, syncIntervalMinutes: { gt: 0 } },
    select: { workspaceId: true, syncIntervalMinutes: true },
    orderBy: { lastSuccessfulSyncAt: { sort: "asc", nulls: "first" } },
    take: MAX_PER_TICK,
  });
  const queued: string[] = [];
  for (const c of conns) {
    const last = await db.syncJob.findFirst({ where: { workspaceId: c.workspaceId, provider: PROVIDER }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    if (last && now.getTime() - last.createdAt.getTime() < c.syncIntervalMinutes * 60_000) continue;
    try {
      const res = await enqueueSync(c.workspaceId, { mode: "INCREMENTAL", trigger: "SCHEDULED", requestedById: null });
      if (res.alreadyRunning) continue;
      queued.push(res.job.id);
      await db.auditLog.create({ data: { workspaceId: c.workspaceId, actorUserId: null, action: "sync.scheduled", entityType: "SyncJob", entityId: res.job.id, metadata: { mode: res.job.mode } } });
    } catch (e) {
      // One workspace's problem must not stop the others.
      console.error(`[mdm] could not schedule a sync for workspace ${c.workspaceId}`, e instanceof Error ? e.message : e);
    }
  }
  return queued;
}

/** Delete rows that only exist for a while: expired sessions and old rate-limit windows. */
export async function cleanupExpired(now = new Date()) {
  const [sessions, buckets] = await Promise.all([
    db.session.deleteMany({ where: { expiresAt: { lt: now } } }),
    db.rateLimitBucket.deleteMany({ where: { windowStart: { lt: new Date(now.getTime() - 2 * 86_400_000) } } }),
  ]);
  return { sessions: sessions.count, rateLimitBuckets: buckets.count };
}

export const schedulerEnabled = () => process.env.SYNC_SCHEDULER !== "off";
