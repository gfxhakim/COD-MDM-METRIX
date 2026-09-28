import { db } from "@/server/db";

export class RateLimitError extends Error {
  constructor(public retryAfterSeconds: number) {
    super(`Too many attempts. Try again in ${retryAfterSeconds}s.`);
    this.name = "RateLimitError";
  }
}

/** Fixed-window limiter stored in the database so it works across server instances. Each step is a single atomic statement. */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<void> {
  const now = new Date();
  const expired = new Date(now.getTime() - windowSeconds * 1000);
  try {
    await db.rateLimitBucket.upsert({ where: { key }, create: { key, count: 0, windowStart: now }, update: {} });
  } catch (e) {
    if ((e as { code?: string }).code !== "P2002") throw e; // created concurrently
  }
  await db.rateLimitBucket.updateMany({ where: { key, windowStart: { lt: expired } }, data: { count: 0, windowStart: now } });
  const taken = await db.rateLimitBucket.updateMany({ where: { key, count: { lt: limit } }, data: { count: { increment: 1 } } });
  if (taken.count === 1) return;
  const bucket = await db.rateLimitBucket.findUnique({ where: { key } });
  const retry = bucket ? Math.ceil((bucket.windowStart.getTime() + windowSeconds * 1000 - now.getTime()) / 1000) : windowSeconds;
  throw new RateLimitError(Math.max(retry, 1));
}
