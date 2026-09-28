import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM envelope encryption for per-workspace integration credentials.
 *
 * Format: "v1:<keyVersion>:<iv b64>:<tag b64>:<ciphertext b64>".
 * The associated data binds a ciphertext to its workspace and provider, so a
 * ciphertext copied into another workspace's row fails to decrypt.
 *
 * Keys come from APP_ENCRYPTION_KEY (current) and, during rotation,
 * APP_ENCRYPTION_KEY_PREVIOUS. Both are 32-byte base64 values.
 */
export class SecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretError";
  }
}

type Key = { version: number; key: Buffer };

function parseKey(raw: string | undefined, name: string): Buffer | null {
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new SecretError(`${name} must be 32 bytes encoded as base64`);
  return key;
}

function keys(): { current: Key; all: Key[] } {
  const current = parseKey(process.env.APP_ENCRYPTION_KEY, "APP_ENCRYPTION_KEY");
  if (!current) throw new SecretError("APP_ENCRYPTION_KEY is not set; integration credentials cannot be stored");
  const version = Number(process.env.APP_ENCRYPTION_KEY_VERSION ?? 1);
  const previous = parseKey(process.env.APP_ENCRYPTION_KEY_PREVIOUS, "APP_ENCRYPTION_KEY_PREVIOUS");
  const all: Key[] = [{ version, key: current }];
  if (previous) all.push({ version: version - 1, key: previous });
  return { current: all[0], all };
}

const aad = (workspaceId: string, purpose: string) => Buffer.from(`cod-flow-tracker:${purpose}:${workspaceId}`);

export function encryptSecret(plaintext: string, ctx: { workspaceId: string; purpose: string }): { envelope: string; keyVersion: number } {
  if (!plaintext) throw new SecretError("Nothing to encrypt");
  const { current } = keys();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", current.key, iv);
  cipher.setAAD(aad(ctx.workspaceId, ctx.purpose));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { envelope: ["v1", current.version, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":"), keyVersion: current.version };
}

/** Server-only. Never return the result to a client or write it to logs. */
export function decryptSecret(envelope: string, ctx: { workspaceId: string; purpose: string }): string {
  const parts = envelope.split(":");
  if (parts.length !== 5 || parts[0] !== "v1") throw new SecretError("Unrecognized credential format");
  const version = Number(parts[1]);
  const key = keys().all.find((k) => k.version === version);
  if (!key) throw new SecretError("The key that encrypted this credential is not configured. Re-enter the credential.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key.key, Buffer.from(parts[2], "base64"));
    decipher.setAAD(aad(ctx.workspaceId, ctx.purpose));
    decipher.setAuthTag(Buffer.from(parts[3], "base64"));
    return Buffer.concat([decipher.update(Buffer.from(parts[4], "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new SecretError("Stored credential could not be decrypted. Re-enter the credential.");
  }
}

/** Safe to show: a fixed prefix plus the last 4 characters, never more than a quarter of the secret. */
export function maskSecret(secret: string): string {
  const s = secret.trim();
  if (s.length < 12) return "••••";
  return `••••${s.slice(-4)}`;
}
