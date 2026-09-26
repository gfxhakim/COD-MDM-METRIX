import { describe, expect, it } from "vitest";
import { can } from "@/lib/permissions";
import { sanitizeMetadata } from "@/server/audit";

describe("role permissions", () => {
  it("matches the role definitions", () => {
    expect(can("OWNER", "members.manage")).toBe(true);
    expect(can("ADMIN", "members.manage")).toBe(false);
    expect(can("ADMIN", "integrations.manage")).toBe(true);
    expect(can("ANALYST", "integrations.manage")).toBe(false);
    expect(can("ANALYST", "catalog.write")).toBe(false);
    expect(can("ANALYST", "data.read")).toBe(true);
    expect(can("OPERATOR", "orders.match")).toBe(true);
    expect(can("OPERATOR", "sync.run")).toBe(true);
    expect(can("OPERATOR", "integrations.manage")).toBe(false);
    expect(can("OPERATOR", "catalog.write")).toBe(false);
  });
});

describe("audit metadata sanitization", () => {
  it("redacts anything that looks like a secret, recursively", () => {
    expect(sanitizeMetadata({ apiKey: "sk_live_123", nested: { token: "t", ok: 1 }, list: [{ password: "p" }], note: "fine" })).toEqual({
      apiKey: "[redacted]",
      nested: { token: "[redacted]", ok: 1 },
      list: [{ password: "[redacted]" }],
      note: "fine",
    });
  });
});
