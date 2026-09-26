export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startSyncPoller } = await import("@/server/mdm/runner");
  startSyncPoller();
}
