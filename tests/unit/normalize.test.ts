import { describe, expect, it } from "vitest";
import { normalizeCreativeKey, normalizeReference } from "@/lib/normalize";
import { hashPhone, maskPhone, normalizePhone } from "@/lib/pii";
import { normalizeProviderStatus } from "@/domain/statusMapping";

describe("reference normalization", () => {
  it("strips #, spaces, prefixes, casing and punctuation", () => {
    expect(normalizeReference("#1042")).toBe("1042");
    expect(normalizeReference(" es-10042 ")).toBe("10042");
    expect(normalizeReference("ORDER #A-17.b")).toBe("A17B");
    expect(normalizeReference("Shopify: 1042")).toBe("1042");
    expect(normalizeReference(null)).toBe("");
  });

  it("normalizes creative keys", () => {
    expect(normalizeCreativeKey(" CR_PC_UGC_01 ")).toBe("cr_pc_ugc_01");
    expect(normalizeCreativeKey("Summer Promo #2")).toBe("summer-promo-2");
  });
});

describe("status normalization", () => {
  it("maps documented MDM statuses", () => {
    expect(normalizeProviderStatus("in delivery")).toBe("SHIPPED");
    expect(normalizeProviderStatus("Return-Received")).toBe("RETURNED");
    expect(normalizeProviderStatus("delivered")).toBe("DELIVERED");
    expect(normalizeProviderStatus("exchanged")).toBe("EXCHANGED");
    expect(normalizeProviderStatus("canceled")).toBe("CANCELED");
  });

  it("maps unknown statuses to UNKNOWN, never delivered or returned", () => {
    expect(normalizeProviderStatus("held_at_hub")).toBe("UNKNOWN");
    expect(normalizeProviderStatus("delivered-ish")).toBe("UNKNOWN");
    expect(normalizeProviderStatus("")).toBe("UNKNOWN");
    expect(normalizeProviderStatus(undefined)).toBe("UNKNOWN");
  });

  it("applies workspace overrides", () => {
    expect(normalizeProviderStatus("held_at_hub", { held_at_hub: "SHIPPED" })).toBe("SHIPPED");
    expect(normalizeProviderStatus("received", { received: "CONFIRMED" })).toBe("CONFIRMED");
  });

  it("maps MDM Express's kebab-case statuses", () => {
    expect(normalizeProviderStatus("return-ready")).toBe("RETURNED");
    expect(normalizeProviderStatus("delivery-failed")).toBe("RETURNED");
    expect(normalizeProviderStatus("delivery-attempt-failed")).toBe("SHIPPED");
    expect(normalizeProviderStatus("deliveryAttemptFailed")).toBe("SHIPPED");
    expect(normalizeProviderStatus("postponed")).toBe("SHIPPED");
    expect(normalizeProviderStatus("received")).toBe("SHIPPED");
    expect(normalizeProviderStatus("out-of-stock")).toBe("CONFIRMED");
    expect(normalizeProviderStatus("out-for-delivery")).toBe("SHIPPED");
    // Partial deliveries stay for review.
    expect(normalizeProviderStatus("delivered-partially")).toBe("UNKNOWN");
  });
});

describe("PII", () => {
  it("hashes phones per workspace and masks them", () => {
    expect(normalizePhone("0555 12 34 56")).toBe("213555123456");
    const a = hashPhone("0555123456", "ws-a");
    expect(a).toHaveLength(64);
    expect(hashPhone("+213 555 12 34 56", "ws-a")).toBe(a);
    expect(hashPhone("0555123456", "ws-b")).not.toBe(a);
    expect(maskPhone("0555123456")).toBe("•••• 456");
  });
});
