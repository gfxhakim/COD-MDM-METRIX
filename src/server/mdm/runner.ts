import { db } from "@/server/db";
import { processDueJobs, runSyncJob } from "./sync";

/**
 * In-process background execution. The HTTP request that queues a sync returns
 * immediately; the job runs on the server afterwards. A poller (started from
 * instrumentation.ts) picks up retries that are due and jobs left behind by a
 * restart. `SYNC_BACKGROUND=off` disables both (tests drive jobs directly).
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

let poller: NodeJS.Timeout | null = null;

export function startSyncPoller(intervalMs = 60_000) {
  if (!enabled() || poller) return;
  poller = setInterval(() => {
    processDueJobs().catch((e) => console.error("[mdm] poller failed", e));
  }, intervalMs);
  poller.unref?.();
}

export async function hasActiveJob(workspaceId: string) {
  return (await db.syncJob.count({ where: { workspaceId, status: { in: ["QUEUED", "RUNNING"] } } })) > 0;
}
