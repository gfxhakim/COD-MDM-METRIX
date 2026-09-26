import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async (host: string) => (host === "internal.mdm.test" ? [{ address: "10.0.0.5", family: 4 }] : [{ address: "93.184.216.34", family: 4 }])),
}));

import { decryptSecret, encryptSecret, maskSecret, SecretError } from "@/server/crypto/secrets";
import { isPrivateAddress, validateMdmBaseUrl } from "@/server/mdm/url";
import { redactPayload, stableStringify } from "@/server/mdm/redact";
import { createLiveAdapter, LIVE_ADAPTER_UNAVAILABLE, mdmRequest, type LiveSchema } from "@/server/mdm/live";
import { createMockAdapter } from "@/server/mdm/mock";
import { MdmError } from "@/server/mdm/types";
import { backoffMs } from "@/server/mdm/sync";

const ctx = { workspaceId: "ws-1", purpose: "integration:MDM_EXPRESS" };

describe("credential encryption", () => {
  it("round-trips and never stores plaintext", () => {
    const { envelope, keyVersion } = encryptSecret("mdm_live_abcdef123456", ctx);
    expect(keyVersion).toBe(1);
    expect(envelope).toMatch(/^v1:1:/);
    expect(envelope).not.toContain("abcdef123456");
    expect(decryptSecret(envelope, ctx)).toBe("mdm_live_abcdef123456");
    expect(encryptSecret("mdm_live_abcdef123456", ctx).envelope).not.toBe(envelope); // random IV
  });

  it("is bound to its workspace and detects tampering", () => {
    const { envelope } = encryptSecret("mdm_live_abcdef123456", ctx);
    expect(() => decryptSecret(envelope, { ...ctx, workspaceId: "ws-2" })).toThrow(SecretError);
    const parts = envelope.split(":");
    parts[4] = Buffer.from("x" + Buffer.from(parts[4], "base64").toString("latin1")).toString("base64");
    expect(() => decryptSecret(parts.join(":"), ctx)).toThrow(SecretError);
  });

  it("decrypts with the previous key during rotation", () => {
    const old = encryptSecret("rotate-me-123456", ctx).envelope;
    const prev = process.env.APP_ENCRYPTION_KEY!;
    vi.stubEnv("APP_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    vi.stubEnv("APP_ENCRYPTION_KEY_VERSION", "2");
    vi.stubEnv("APP_ENCRYPTION_KEY_PREVIOUS", prev);
    expect(decryptSecret(old, ctx)).toBe("rotate-me-123456");
    expect(encryptSecret("x".repeat(20), ctx).keyVersion).toBe(2);
    vi.unstubAllEnvs();
  });

  it("masks to the last four characters only", () => {
    expect(maskSecret("mdm_live_abcdef123456")).toBe("••••3456");
    expect(maskSecret("short")).toBe("••••");
  });
});

describe("SSRF guard", () => {
  it("accepts only https allowlisted hosts", () => {
    expect(validateMdmBaseUrl("https://api.mdm.express/")).toBe("https://api.mdm.express");
    for (const bad of ["http://api.mdm.express", "https://evil.example", "https://127.0.0.1", "https://user:pw@api.mdm.express", "https://api.mdm.express:8443", "https://api.mdm.express?x=1", "file:///etc/passwd", "https://api.mdm.express.evil.com"]) {
      expect(() => validateMdmBaseUrl(bad), bad).toThrow();
    }
  });
  it("recognizes private addresses", () => {
    for (const ip of ["10.1.2.3", "127.0.0.1", "169.254.169.254", "192.168.1.1", "172.20.0.1", "::1", "fd00::1", "::ffff:10.0.0.1"]) expect(isPrivateAddress(ip), ip).toBe(true);
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
  });
});

describe("raw payload redaction", () => {
  it("removes PII and secrets but keeps shipping fields", () => {
    const r = redactPayload({ tracking: "T1", recipient_phone: "0550", customer: { first_name: "A", wilaya: "Oran" }, address: "x", api_key: "k", events: [{ status: "delivered", phone: "1" }] }) as Record<string, unknown>;
    expect(r).toEqual({ tracking: "T1", recipient_phone: "[redacted]", customer: { first_name: "[redacted]", wilaya: "Oran" }, address: "[redacted]", api_key: "[redacted]", events: [{ status: "delivered", phone: "[redacted]" }] });
    expect(stableStringify({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(stableStringify({ a: [2, { c: 2, d: 1 }], b: 1 }));
  });
});

describe("adapters", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("live adapter without a schema refuses to run and sends nothing", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const a = createLiveAdapter({ baseUrl: "https://api.mdm.express", credential: "secret-credential-1", schema: null });
    await expect(a.testConnection()).rejects.toMatchObject({ kind: "NOT_AVAILABLE", message: LIVE_ADAPTER_UNAVAILABLE });
    await expect(a.listParcels({ cursor: null, updatedSince: null, pageSize: 10 })).rejects.toMatchObject({ kind: "NOT_AVAILABLE" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  const fakeSchema: LiveSchema = {
    applyAuth: (h, c) => h.set("x-test-auth", c),
    testRequest: () => ({ method: "GET", path: "/ping" }),
    accountLabel: () => "acct",
    parcelsRequest: (q) => ({ method: "GET", path: "/parcels", query: { page: q.cursor ?? "1" } }),
    parseParcelsPage: () => ({ items: [], nextCursor: null }),
  };

  it("hardened client puts the credential only in a header, maps errors and blocks private hosts", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: URL, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    }));
    await mdmRequest("https://api.mdm.express", "secret-credential-1", fakeSchema, { method: "GET", path: "/parcels", query: { page: "2" } });
    expect(calls[0].url).toBe("https://api.mdm.express/parcels?page=2");
    expect(calls[0].url).not.toContain("secret");
    expect((calls[0].init.headers as Headers).get("x-test-auth")).toBe("secret-credential-1");
    expect(calls[0].init.redirect).toBe("error");

    vi.stubGlobal("fetch", vi.fn(async () => new Response("slow down", { status: 429, headers: { "retry-after": "7" } })));
    await expect(mdmRequest("https://api.mdm.express", "c".repeat(10), fakeSchema, { method: "GET", path: "/x" })).rejects.toMatchObject({ kind: "RATE_LIMIT", retryAfterMs: 7000 });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
    await expect(mdmRequest("https://api.mdm.express", "c".repeat(10), fakeSchema, { method: "GET", path: "/x" })).rejects.toMatchObject({ kind: "AUTH" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 200 })));
    await expect(mdmRequest("https://api.mdm.express", "c".repeat(10), fakeSchema, { method: "GET", path: "/x" })).rejects.toMatchObject({ kind: "BAD_RESPONSE" });

    vi.stubEnv("MDM_ALLOWED_HOSTS", "internal.mdm.test");
    await expect(mdmRequest("https://internal.mdm.test", "c".repeat(10), fakeSchema, { method: "GET", path: "/x" })).rejects.toMatchObject({ kind: "CONFIG" });
    vi.unstubAllEnvs();
  });

  it("mock adapter pages, filters by date and scripts failures", async () => {
    const fx = Array.from({ length: 5 }, (_, i) => ({ trackingId: `T${i}`, reference: null, sourceOrderId: null, status: "delivered", statusAt: new Date(2026, 0, i + 1), codAmount: 1, currency: "DZD", shippingFee: null, returnFee: null, wilaya: null, dispatchedAt: null, deliveredAt: null, returnedAt: null, events: [], raw: null }));
    const m = createMockAdapter({ fixtures: fx, credential: "demo-key-123", failures: { 1: [new MdmError("busy", "RATE_LIMIT")] } });
    const p0 = await m.listParcels({ cursor: null, updatedSince: null, pageSize: 2 });
    expect([p0.items.length, p0.nextCursor, p0.total]).toEqual([2, "1", 5]);
    await expect(m.listParcels({ cursor: "1", updatedSince: null, pageSize: 2 })).rejects.toMatchObject({ kind: "RATE_LIMIT" });
    expect((await m.listParcels({ cursor: "1", updatedSince: null, pageSize: 2 })).items[0].trackingId).toBe("T2");
    expect((await m.listParcels({ cursor: null, updatedSince: new Date(2026, 0, 4), pageSize: 10 })).items).toHaveLength(2);
    await expect(createMockAdapter({ fixtures: [], credential: "invalid-key-1" }).testConnection()).rejects.toMatchObject({ kind: "AUTH" });
  });

  it("backs off exponentially and honors Retry-After", () => {
    expect(backoffMs(0)).toBeGreaterThanOrEqual(1000);
    expect(backoffMs(3)).toBeGreaterThanOrEqual(8000);
    expect(backoffMs(20)).toBeLessThanOrEqual(60_000);
    expect(backoffMs(0, 7000)).toBe(7000);
    expect(new MdmError("x", "AUTH").retryable).toBe(false);
  });
});
