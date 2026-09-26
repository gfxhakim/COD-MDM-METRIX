import { createHash } from "node:crypto";

/** Normalize Algerian-style phone numbers to digits with country code where recognisable. */
export function normalizePhone(raw: string): string {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0") && d.length === 10) d = "213" + d.slice(1);
  return d;
}

/** Salted per workspace so hashes cannot be joined across tenants. */
export function hashPhone(raw: string, workspaceId: string): string | null {
  const n = normalizePhone(raw);
  if (n.length < 6) return null;
  const salt = process.env.PII_HASH_SALT ?? "dev-only-salt";
  return createHash("sha256").update(`${salt}:${workspaceId}:${n}`).digest("hex");
}

export function maskPhone(raw: string): string | null {
  const n = raw.replace(/\D/g, "");
  if (n.length < 4) return null;
  return `•••• ${n.slice(-3)}`;
}

/** Customer identifiers (emails, store customer IDs) are kept only as a short salted hash. */
export function hashCustomerRef(raw: string, workspaceId: string): string | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  const salt = process.env.PII_HASH_SALT ?? "dev-only-salt";
  return "c_" + createHash("sha256").update(`${salt}:${workspaceId}:customer:${v}`).digest("hex").slice(0, 24);
}
