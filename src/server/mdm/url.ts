import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { InputError } from "@/server/errors";

/**
 * SSRF guard for the MDM base URL. Only https, only allowlisted hosts, no
 * credentials/ports/paths tricks, and the host must not resolve to a private address.
 */
export const DEFAULT_MDM_BASE_URL = "https://api.mdm.express";

export function allowedMdmHosts(): string[] {
  const extra = (process.env.MDM_ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  return ["api.mdm.express", ...extra];
}

export function validateMdmBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new InputError("Enter a valid URL, for example https://api.mdm.express");
  }
  if (url.protocol !== "https:") throw new InputError("The MDM URL must use https");
  if (url.username || url.password) throw new InputError("The MDM URL must not contain credentials");
  if (url.port && url.port !== "443") throw new InputError("Custom ports are not allowed for the MDM URL");
  if (url.search || url.hash) throw new InputError("The MDM URL must not contain a query or fragment");
  const host = url.hostname.toLowerCase();
  if (isIP(host)) throw new InputError("Use the MDM host name, not an IP address");
  if (!allowedMdmHosts().includes(host)) throw new InputError(`Only these MDM hosts are allowed: ${allowedMdmHosts().join(", ")}`);
  return `https://${host}${url.pathname.replace(/\/+$/, "")}`;
}

const PRIVATE_V4 = [/^10\./, /^127\./, /^0\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./];

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) return PRIVATE_V4.some((re) => re.test(ip));
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
}

/** Called right before each outbound request (DNS can change after the URL was saved). */
export async function assertPublicHost(host: string): Promise<void> {
  const addrs = await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new InputError("The MDM host resolves to a private address and was blocked");
}
