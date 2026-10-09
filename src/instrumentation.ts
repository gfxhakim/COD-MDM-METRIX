export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { enforceProductionConfig } = await import("@/server/config");
  enforceProductionConfig();
  const { startSyncPoller } = await import("@/server/mdm/runner");
  startSyncPoller();
  // Wilayas saved under older names take their one Arabic name once the new version starts.
  const { tidyWilayas } = await import("@/server/wilayas");
  tidyWilayas().catch((e) => console.error("[wilayas] could not rename stored wilayas", e instanceof Error ? e.message : e));
}
