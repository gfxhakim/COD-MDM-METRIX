/**
 * Production configuration checks, run once at server start (instrumentation.ts).
 * A misconfigured production server refuses to start instead of running with
 * placeholder secrets. Messages name the variable, never its value.
 */
const PLACEHOLDER = /replace|changeme|example|dev-only/i;

export function productionConfigProblems(env: Record<string, string | undefined> = process.env): string[] {
  const problems: string[] = [];
  const key = env.APP_ENCRYPTION_KEY;
  if (!key || PLACEHOLDER.test(key)) problems.push("APP_ENCRYPTION_KEY must be set to a random 32-byte base64 value");
  else if (Buffer.from(key, "base64").length !== 32) problems.push("APP_ENCRYPTION_KEY must decode to exactly 32 bytes");
  const prev = env.APP_ENCRYPTION_KEY_PREVIOUS;
  if (prev && Buffer.from(prev, "base64").length !== 32) problems.push("APP_ENCRYPTION_KEY_PREVIOUS must decode to exactly 32 bytes");
  const salt = env.PII_HASH_SALT;
  if (!salt || PLACEHOLDER.test(salt) || salt.length < 16) problems.push("PII_HASH_SALT must be a random string of at least 16 characters");
  if (!env.DATABASE_URL) problems.push("DATABASE_URL must be set");
  const cron = env.CRON_SECRET;
  if (cron && (cron.length < 32 || PLACEHOLDER.test(cron))) problems.push("CRON_SECRET must be at least 32 random characters (or unset to disable the cron endpoint)");
  if (env.MDM_API_KEY && !PLACEHOLDER.test(env.MDM_API_KEY)) problems.push("MDM_API_KEY must not be set in production: each workspace saves its own MDM key in Settings");
  return problems;
}

export function assertProductionConfig() {
  if (process.env.NODE_ENV !== "production") return;
  const problems = productionConfigProblems();
  if (problems.length) throw new Error(`Refusing to start with an unsafe configuration:\n- ${problems.join("\n- ")}`);
}
