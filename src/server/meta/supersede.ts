import { db } from "@/server/db";

export const API_SOURCE = "META_API";

/**
 * CSV spend rows that the Meta API also has (same ad ID, same day) stop counting:
 * they get `supersededAt`, and reports read the API row instead. Matching is by ad ID,
 * so CSV exports should include the Ad ID column.
 */
export async function supersedeCsvSpend(workspaceId: string, range?: { from: Date; to: Date }, now = new Date()) {
  const date = range ? { gte: range.from, lte: range.to } : undefined;
  const api = await db.adSpend.findMany({ where: { workspaceId, source: API_SOURCE, date }, select: { adId: true, date: true } });
  if (!api.length) return 0;
  const have = new Set(api.map((r) => `${r.adId}|${r.date.toISOString().slice(0, 10)}`));
  const csv = await db.adSpend.findMany({ where: { workspaceId, source: { not: API_SOURCE }, supersededAt: null, adId: { not: null }, date }, select: { id: true, adId: true, date: true } });
  const ids = csv.filter((r) => have.has(`${r.adId}|${r.date.toISOString().slice(0, 10)}`)).map((r) => r.id);
  for (let i = 0; i < ids.length; i += 500) await db.adSpend.updateMany({ where: { id: { in: ids.slice(i, i + 500) } }, data: { supersededAt: now } });
  return ids.length;
}
