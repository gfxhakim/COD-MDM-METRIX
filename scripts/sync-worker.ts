/**
 * Standalone sync worker: `npm run sync:worker`.
 * Processes queued MDM sync jobs (including backoff retries and jobs left behind by a
 * restart) every 30 seconds. The web server also runs jobs in-process; running this
 * as a separate process is optional and safe, because jobs are claimed atomically.
 */
import { processDueJobs } from "../src/server/mdm/sync";

const INTERVAL_MS = Number(process.env.SYNC_WORKER_INTERVAL_MS ?? 30_000);
let stopping = false;

async function loop() {
  while (!stopping) {
    try {
      const done = await processDueJobs();
      if (done.length) console.log(`[sync-worker] processed ${done.length} job(s)`);
    } catch (e) {
      console.error("[sync-worker] pass failed", e);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { stopping = true; });
void loop();
