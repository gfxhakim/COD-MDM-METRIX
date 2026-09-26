import { db } from "@/server/db";

export class RateLimitError extends Error {
  constructor(public retryAfterSeconds: number) {
    super(`Too many attempts. Try again in ${retryAfterSeconds}s.`);
    this.name = "RateLimitError";
  }
}

/** Fixed-window limiter stored in the database so it works across server instances. */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<void> {
  const now = new Date();
  const bucket = await db.rateLimitBucket.findUnique({ where: { key } });
  if (!bucket || now.getTime() - bucket.windowStart.getTime() > windowSeconds * 1000) {
    await db.rateLimitBucket.upsert({ where: { key }, create: { key, count: 1, windowStart: now }, update: { count: 1, windowStart: now } });
    return;
  }
  if (bucket.count >= limit) {
    const retry = Math.ceil((bucket.windowStart.getTime() + windowSeconds * 1000 - now.getTime()) / 1000);
    throw new RateLimitError(Math.max(retry, 1));
  }
  await db.rateLimitBucket.update({ where: { key }, data: { count: { increment: 1 } } });
}
