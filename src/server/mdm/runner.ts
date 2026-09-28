import { db } from "@/server/db";
import { cleanupExpired, scheduleDueSyncs, schedulerEnabled } from "./schedule";
import { processDueJobs, runSyncJob } from "./sync";
import { applyStatusDefaultsOnce } from "./statuses";

/**
 * In-process background execution. The HTTP request that queues a sync returns
 * immediately; the job runs on the server afterwards. A poller (started from
 * instrumentation.ts) queues scheduled syncs, picks up retries that are due and
 * jobs left behind by a restart. `SYNC_BACKGROUND=off` disables all of it (tests
 * drive jobs directly); `SYNC_SCHEDULER=off` keeps job processing but leaves
 * scheduling to an external cron.
 */
const enabled = () => process.env.SYNC_BACKGROUND !== "off";

export function kickSync(jobId: string) {
  if (!enabled()) return;
  setImmediate(() => void runAndReschedule(jobId));
}

async function runAndReschedule(jobId: string) {
  try {
    const job = await runSyncJob(jobId);
    if (job?.status === "QUEUED" && job.nextRunAt) {
      const t = setTimeout(() => void runAndReschedule(jobId), Math.max(0, job.nextRunAt.getTime() - Date.now()));
      t.unref?.();
    }
  } catch (e) {
    console.error("[mdm] background sync crashed", e);
  }
}

let lastCleanup = 0;

/**
 * One scheduler pass: queue due syncs, run due jobs, and clean up expired rows about once an hour.
 * The first pass after a start also applies new built-in status defaults to every workspace.
 */
export async function runSchedulerTick(opts: { schedule?: boolean } = {}) {
  const now = new Date();
  await applyStatusDefaultsOnce();
  const scheduled = (opts.schedule ?? schedulerEnabled()) ? await scheduleDueSyncs(now) : [];
  const processed = await processDueJobs();
  if (now.getTime() - lastCleanup > 3_600_000) {
    lastCleanup = now.getTime();
    await cleanupExpired(now);
  }
  return { scheduled: scheduled.length, processed: processed.length };
}

let poller: NodeJS.Timeout | null = null;
let ticking = false;

export function startSyncPoller(intervalMs = 60_000) {
  if (!enabled() || poller) return;
  poller = setInterval(() => {
    // A long sync must not start a second overlapping pass.
    if (ticking) return;
    ticking = true;
    runSchedulerTick()
      .catch((e) => console.error("[mdm] scheduler tick failed", e))
      .finally(() => { ticking = false; });
  }, intervalMs);
  poller.unref?.();
}

export async function hasActiveJob(workspaceId: string) {
  return (await db.syncJob.count({ where: { workspaceId, status: { in: ["QUEUED", "RUNNING"] } } })) > 0;
}
