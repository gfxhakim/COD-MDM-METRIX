import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]) }));

import { db } from "@/server/db";
import { cronAuthorized } from "@/server/cron";
import { productionConfigProblems } from "@/server/config";
import { rateLimit, RateLimitError } from "@/server/rateLimit";
import { cleanupExpired, scheduleDueSyncs } from "@/server/mdm/schedule";
import { GET as health } from "@/app/api/health/route";
import { POST as cronSync } from "@/app/api/cron/sync/route";
import { makeTenant } from "../helpers";

const SECRET = "placeholder-mdm-key-for-tests-0001";

async function connectedTenant(name: string, minutes = 45) {
  const t = await makeTenant(name);
  await t.caller.integrations.saveMdmCredential({ credential: SECRET });
  await db.integrationConnection.updateMany({ where: { workspaceId: t.ws.id }, data: { status: "CONNECTED", syncIntervalMinutes: minutes } });
  return t;
}
const jobsOf = (workspaceId: string) => db.syncJob.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("scheduled sync", () => {
  it("queues one incremental job per connected workspace once its interval has passed", async () => {
    const a = await connectedTenant("SchedA", 30);
    const notConnected = await makeTenant("SchedB");
    await notConnected.caller.integrations.saveMdmCredential({ credential: SECRET }); // saved but never tested

    const now = new Date();
    await scheduleDueSyncs(now);
    const first = await jobsOf(a.ws.id);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ trigger: "SCHEDULED", requestedById: null, status: "QUEUED" });
    expect(await jobsOf(notConnected.ws.id)).toHaveLength(0);
    expect(await db.auditLog.count({ where: { workspaceId: a.ws.id, action: "sync.scheduled", actorUserId: null } })).toBe(1);

    // The lock holds while the job is queued, and nothing new is due within the interval.
    await scheduleDueSyncs(new Date(now.getTime() + 60_000));
    await db.syncJob.update({ where: { id: first[0].id }, data: { status: "SUCCEEDED", activeLock: null, finishedAt: now } });
    await scheduleDueSyncs(new Date(now.getTime() + 29 * 60_000));
    expect(await jobsOf(a.ws.id)).toHaveLength(1);

    await scheduleDueSyncs(new Date(now.getTime() + 31 * 60_000));
    expect(await jobsOf(a.ws.id)).toHaveLength(2);
  });

  it("a recent manual sync pushes the next scheduled one back", async () => {
    const t = await connectedTenant("SchedManual", 60);
    const { jobId } = await t.caller.sync.start({ mode: "FULL" });
    await db.syncJob.update({ where: { id: jobId }, data: { status: "SUCCEEDED", activeLock: null } });
    await scheduleDueSyncs(new Date(Date.now() + 30 * 60_000));
    expect(await jobsOf(t.ws.id)).toHaveLength(1);
  });

  it("stops scheduling once the connection is in error or the key is removed", async () => {
    const t = await connectedTenant("SchedStop", 15);
    await db.integrationConnection.updateMany({ where: { workspaceId: t.ws.id }, data: { status: "ERROR" } });
    await scheduleDueSyncs();
    expect(await jobsOf(t.ws.id)).toHaveLength(0);
    await db.integrationConnection.updateMany({ where: { workspaceId: t.ws.id }, data: { status: "CONNECTED" } });
    await t.caller.integrations.removeMdmCredential();
    await scheduleDueSyncs();
    expect(await jobsOf(t.ws.id)).toHaveLength(0);
  });
});

describe("cron endpoint", () => {
  const call = (auth?: string) => cronSync(new Request("http://localhost/api/cron/sync", { method: "POST", headers: auth ? { authorization: auth } : {} }));

  it("is disabled without CRON_SECRET and rejects wrong secrets", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("Bearer anything")).status).toBe(404);
    vi.stubEnv("CRON_SECRET", "c".repeat(40));
    expect((await call()).status).toBe(401);
    expect((await call("Bearer " + "d".repeat(40))).status).toBe(401);
    expect(cronAuthorized("Bearer " + "c".repeat(40), "c".repeat(40))).toBe("ok");
    expect(cronAuthorized("c".repeat(40), "c".repeat(40))).toBe("denied");
  });

  it("queues due syncs and, with background execution off, runs them in the request", async () => {
    vi.stubEnv("CRON_SECRET", "c".repeat(40));
    const t = await connectedTenant("CronRun", 15);
    const sent: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: URL, init: RequestInit) => {
      sent.push((init.headers as Headers).get("x-api-key") ?? "");
      return new Response(JSON.stringify({ pagination: { page: 1, hasMore: false, nextPage: null, total: 0 }, list: [] }), { status: 200 });
    }));
    const res = await call("Bearer " + "c".repeat(40));
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.scheduled).toBeGreaterThanOrEqual(1);
    let [job] = await jobsOf(t.ws.id);
    // Other test files' connected workspaces share this database, so their scheduled syncs queue in
    // the same tick. Each request runs at most 10 jobs: ours may only run on the next tick.
    for (let tick = 0; tick < 5 && job?.status === "QUEUED"; tick++) {
      expect((await call("Bearer " + "c".repeat(40))).status).toBe(202);
      [job] = await jobsOf(t.ws.id);
    }
    expect(job).toMatchObject({ trigger: "SCHEDULED", status: "SUCCEEDED", adapter: "live" });
    expect(sent).toContain(SECRET);
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });
});

describe("hardening", () => {
  it("health check reports ok without revealing configuration", async () => {
    const res = await health();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("production config refuses placeholder or missing secrets", () => {
    const good = { APP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"), PII_HASH_SALT: "a-long-random-salt-value", DATABASE_URL: "postgresql://x" };
    expect(productionConfigProblems(good)).toEqual([]);
    expect(productionConfigProblems({ ...good, APP_ENCRYPTION_KEY: "replace-with-32-byte-base64-key" })[0]).toContain("APP_ENCRYPTION_KEY");
    expect(productionConfigProblems({ ...good, APP_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") })[0]).toContain("32 bytes");
    expect(productionConfigProblems({ ...good, PII_HASH_SALT: "short" })[0]).toContain("PII_HASH_SALT");
    expect(productionConfigProblems({ ...good, CRON_SECRET: "tooshort" })[0]).toContain("CRON_SECRET");
    expect(productionConfigProblems({ ...good, MDM_API_KEY: "a-real-looking-key-123" })[0]).toContain("MDM_API_KEY");
    expect(productionConfigProblems({ ...good, MDM_API_KEY: "replace-with-local-development-secret" })).toEqual([]);
    const problems = productionConfigProblems({ APP_ENCRYPTION_KEY: "secret-value-xyz" }).join(" ");
    expect(problems).not.toContain("secret-value-xyz");
  });

  it("rate limiter admits exactly the limit under concurrency and resets after the window", async () => {
    const key = `test-rl-${Math.random()}`;
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => rateLimit(key, 5, 60)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    expect(results.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason instanceof RateLimitError)).toBe(true);
    await db.rateLimitBucket.update({ where: { key }, data: { windowStart: new Date(Date.now() - 61_000) } });
    await expect(rateLimit(key, 5, 60)).resolves.toBeUndefined();
  });

  it("cleanup removes expired sessions and old rate-limit windows only", async () => {
    const t = await makeTenant("Cleanup");
    await db.session.create({ data: { tokenHash: `old-${Math.random()}`, userId: t.user.id, expiresAt: new Date(Date.now() - 1000) } });
    const live = await db.session.create({ data: { tokenHash: `live-${Math.random()}`, userId: t.user.id, expiresAt: new Date(Date.now() + 86_400_000) } });
    await db.rateLimitBucket.create({ data: { key: `old-${Math.random()}`, count: 1, windowStart: new Date(Date.now() - 3 * 86_400_000) } });
    const r = await cleanupExpired();
    expect(r.sessions).toBeGreaterThanOrEqual(1);
    expect(r.rateLimitBuckets).toBeGreaterThanOrEqual(1);
    expect(await db.session.findUnique({ where: { id: live.id } })).not.toBeNull();
  });
});

describe("encryption key rotation", () => {
  it("re-encrypts stored credentials with the new key so the old one can be retired", async () => {
    const { reencryptCredentials } = await import("@/server/crypto/rotate");
    const { decryptSecret } = await import("@/server/crypto/secrets");
    const t = await makeTenant("Rotate");
    await t.caller.integrations.saveMdmCredential({ credential: SECRET });
    const { openCustomer, sealCustomer } = await import("@/server/customers");
    const customer = { name: "Test Customer", phone: "0550000001", phone2: null, address: null };
    const order = await db.order.create({ data: { workspaceId: t.ws.id, source: "MDM_EXPRESS", externalOrderId: "ROT-1", orderNumber: "ROT-1", normalizedOrderNumber: "ROT1", placedAt: new Date(), codAmount: 0, ...sealCustomer(customer, t.ws.id) } });
    const oldKey = process.env.APP_ENCRYPTION_KEY!;
    const newKey = Buffer.alloc(32, 9).toString("base64");
    vi.stubEnv("APP_ENCRYPTION_KEY", newKey);
    vi.stubEnv("APP_ENCRYPTION_KEY_PREVIOUS", oldKey);
    vi.stubEnv("APP_ENCRYPTION_KEY_VERSION", "2");
    const r = await reencryptCredentials(2, { workspaceId: t.ws.id });
    expect(r).toEqual({ reencrypted: 2, alreadyCurrent: 0, failed: [], customersFailed: 0 });
    const row = await db.integrationConnection.findFirstOrThrow({ where: { workspaceId: t.ws.id } });
    expect(row.keyVersion).toBe(2);
    expect(row.encryptedCredential).toMatch(/^v1:2:/);
    // The old key is no longer needed.
    vi.stubEnv("APP_ENCRYPTION_KEY_PREVIOUS", "");
    expect(decryptSecret(row.encryptedCredential!, { workspaceId: t.ws.id, purpose: "integration:MDM_EXPRESS" })).toBe(SECRET);
    const rotated = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(rotated).toMatchObject({ customerKeyVersion: 2, customerEncrypted: expect.stringMatching(/^v1:2:/) });
    expect(openCustomer(rotated.customerEncrypted, t.ws.id)).toEqual(customer);
    // Running it again changes nothing.
    expect(await reencryptCredentials(2, { workspaceId: t.ws.id })).toEqual({ reencrypted: 0, alreadyCurrent: 2, failed: [], customersFailed: 0 });
  });
});
