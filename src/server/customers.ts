import type { Role } from "@prisma/client";
import { can } from "@/lib/permissions";
import { maskPhone } from "@/lib/pii";
import { decryptSecret, encryptSecret, SecretError } from "@/server/crypto/secrets";

/**
 * Customer details read from MDM (name, phones, street address). They are stored only
 * encrypted (Order.customerEncrypted, AES-256-GCM with APP_ENCRYPTION_KEY, bound to the
 * workspace), decrypted server-side, and shown in full only to roles with "customers.read".
 * Other roles get a masked copy, and exports leave the columns out for them.
 * Never log these values or put them in fixtures.
 */
export type Customer = { name: string | null; phone: string | null; phone2: string | null; address: string | null };

const PURPOSE = "order-customer";
const MAX = 300;

const clean = (v: string | null | undefined) => {
  const s = v?.replace(/\s+/g, " ").trim();
  return s ? s.slice(0, MAX) : null;
};

/** A customer with every field trimmed, or null when there is nothing to keep. */
export function normalizeCustomer(c: Partial<Customer> | null | undefined): Customer | null {
  if (!c) return null;
  const out: Customer = { name: clean(c.name), phone: clean(c.phone), phone2: clean(c.phone2), address: clean(c.address) };
  return out.name || out.phone || out.phone2 || out.address ? out : null;
}

/** Stable text for a customer, so a re-sync can tell whether anything changed. */
export function customerKey(c: Customer | null): string | null {
  return c ? JSON.stringify([c.name, c.phone, c.phone2, c.address]) : null;
}

export function sealCustomer(c: Customer | null, workspaceId: string): { customerEncrypted: string | null; customerKeyVersion: number | null } {
  if (!c) return { customerEncrypted: null, customerKeyVersion: null };
  const { envelope, keyVersion } = encryptSecret(customerKey(c)!, { workspaceId, purpose: PURPOSE });
  return { customerEncrypted: envelope, customerKeyVersion: keyVersion };
}

/** Server-only. Null when there is nothing stored or it can't be decrypted (e.g. a retired key). */
export function openCustomer(envelope: string | null | undefined, workspaceId: string): Customer | null {
  if (!envelope) return null;
  try {
    const [name, phone, phone2, address] = JSON.parse(decryptSecret(envelope, { workspaceId, purpose: PURPOSE })) as (string | null)[];
    return { name: name ?? null, phone: phone ?? null, phone2: phone2 ?? null, address: address ?? null };
  } catch (e) {
    if (e instanceof SecretError || e instanceof SyntaxError) return null;
    throw e;
  }
}

/** Re-encrypts with the current key (key rotation). */
export function resealCustomer(envelope: string, workspaceId: string) {
  const ctx = { workspaceId, purpose: PURPOSE };
  return encryptSecret(decryptSecret(envelope, ctx), ctx);
}

/** "Amina Benali" → "A•••• B••••"; phones keep their last 3 digits; the address is hidden. */
export function maskCustomer(c: Customer | null): Customer | null {
  if (!c) return null;
  const name = c.name ? c.name.split(" ").map((w) => (w ? `${w[0]}••••` : w)).join(" ") : null;
  return { name, phone: c.phone ? maskPhone(c.phone) : null, phone2: c.phone2 ? maskPhone(c.phone2) : null, address: c.address ? "••••" : null };
}

export const canSeeCustomers = (role: Role) => can(role, "customers.read");

/** The customer as this role may see it. */
export function customerFor(role: Role, envelope: string | null | undefined, workspaceId: string): Customer | null {
  const c = openCustomer(envelope, workspaceId);
  return canSeeCustomers(role) ? c : maskCustomer(c);
}
