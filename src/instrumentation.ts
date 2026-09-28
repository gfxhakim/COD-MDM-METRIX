export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { enforceProductionConfig } = await import("@/server/config");
  enforceProductionConfig();
  const { startSyncPoller } = await import("@/server/mdm/runner");
  startSyncPoller();
}
