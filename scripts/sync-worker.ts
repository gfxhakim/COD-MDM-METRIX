/**
 * Standalone sync worker: `npm run sync:worker`.
 * Every 30 seconds it queues scheduled syncs that are due, processes queued MDM sync
 * jobs (including backoff retries and jobs left behind by a restart) and cleans up
 * expired rows. The web server does the same in-process; running this as a separate
 * process is optional and safe, because jobs are claimed atomically and each
 * workspace holds one sync lock.
 */
import { assertProductionConfig } from "../src/server/config";
import { runSchedulerTick } from "../src/server/mdm/runner";

assertProductionConfig();
const INTERVAL_MS = Number(process.env.SYNC_WORKER_INTERVAL_MS ?? 30_000);
let stopping = false;

async function loop() {
  while (!stopping) {
    try {
      const r = await runSchedulerTick();
      if (r.scheduled || r.processed) console.log(`[sync-worker] scheduled ${r.scheduled}, processed ${r.processed} job(s)`);
    } catch (e) {
      console.error("[sync-worker] pass failed", e);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { stopping = true; });
void loop();
