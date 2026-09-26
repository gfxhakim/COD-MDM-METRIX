import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Checks `Authorization: Bearer <CRON_SECRET>` in constant time. When CRON_SECRET is
 * unset the cron endpoint is disabled, so it can never be called unauthenticated.
 */
export function cronAuthorized(header: string | null, secret = process.env.CRON_SECRET): "ok" | "disabled" | "denied" {
  if (!secret) return "disabled";
  const m = /^Bearer (.+)$/.exec(header ?? "");
  if (!m) return "denied";
  const a = createHash("sha256").update(m[1]).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b) ? "ok" : "denied";
}
