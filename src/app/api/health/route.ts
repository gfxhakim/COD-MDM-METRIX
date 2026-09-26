import { db } from "@/server/db";

export const dynamic = "force-dynamic";

/** Liveness + database check for load balancers and uptime monitors. Reveals nothing else. */
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok" }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("[health] database check failed", e);
    return Response.json({ status: "error", database: "unreachable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
