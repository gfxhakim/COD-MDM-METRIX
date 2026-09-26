export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertProductionConfig } = await import("@/server/config");
  try {
    assertProductionConfig();
  } catch (e) {
    // Exit instead of leaving a half-started server behind: the process manager shows the reason.
    console.error((e as Error).message);
    process.exit(1);
  }
  const { startSyncPoller } = await import("@/server/mdm/runner");
  startSyncPoller();
}
