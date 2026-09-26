export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertProductionConfig } = await import("@/server/config");
  assertProductionConfig();
  const { startSyncPoller } = await import("@/server/mdm/runner");
  startSyncPoller();
}
