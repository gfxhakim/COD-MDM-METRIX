import { cronAuthorized } from "@/server/cron";
import { kickSync } from "@/server/mdm/runner";
import { cleanupExpired, scheduleDueSyncs } from "@/server/mdm/schedule";
import { processDueJobs } from "@/server/mdm/sync";

export const dynamic = "force-dynamic";

/**
 * External scheduler hook for hosts without a long-running process scheduler.
 * Call every 5–15 minutes with `Authorization: Bearer $CRON_SECRET`. It queues the
 * syncs that are due (per workspace interval) and returns at once; the jobs run in
 * the background. With SYNC_BACKGROUND=off they run inside this request instead.
 */
async function handler(req: Request) {
  const auth = cronAuthorized(req.headers.get("authorization"));
  if (auth === "disabled") return new Response("Not found", { status: 404 });
  if (auth === "denied") return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const queued = await scheduleDueSyncs();
    let processed = 0;
    if (process.env.SYNC_BACKGROUND === "off") processed = (await processDueJobs()).length;
    else for (const id of queued) kickSync(id);
    await cleanupExpired();
    return Response.json({ scheduled: queued.length, processed }, { status: 202, headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("[cron] sync tick failed", e);
    return Response.json({ error: "internal error" }, { status: 500 });
  }
}

export { handler as GET, handler as POST };
