import { createHash } from "node:crypto";

/** Keys that hold customer PII or secrets. Raw payloads are stored for debugging, not for customer data. */
const PII_KEY = /(phone|mobile|tel(ephone)?$|e-?mail|first_?name|last_?name|full_?name|customer_?name|recipient|client_?name|^name$|address|street|adresse|nom|prenom|prénom|token|secret|password|api_?key|authorization)/i;

export function redactPayload(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[depth]";
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => redactPayload(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = PII_KEY.test(k) ? (v == null || v === "" ? v : "[redacted]") : redactPayload(v, depth + 1);
    return out;
  }
  if (typeof value === "string" && value.length > 2000) return value.slice(0, 2000) + "…";
  return value;
}

/** Key-order-independent JSON for hashing. */
export function stableStringify(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
