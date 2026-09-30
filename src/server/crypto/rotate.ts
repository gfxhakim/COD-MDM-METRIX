import { db } from "@/server/db";
import { resealCustomer } from "@/server/customers";
import { metaTokenPurpose } from "@/server/meta/types";
import { decryptSecret, encryptSecret, SecretError } from "./secrets";

/**
 * Re-encrypts every stored integration credential with the current APP_ENCRYPTION_KEY.
 * Run after rotating the key (new key in APP_ENCRYPTION_KEY, old one in
 * APP_ENCRYPTION_KEY_PREVIOUS, version bumped). Plaintext only exists in memory here.
 * Covers MDM credentials, every saved Meta token and the customer details kept on orders.
 * Credentials that can't be decrypted are left untouched and reported by connection or token
 * ID; customer details that can't be decrypted are counted in `customersFailed`.
 */
export async function reencryptCredentials(currentVersion: number, only?: { workspaceId: string }) {
  const rows = await db.integrationConnection.findMany({ where: { encryptedCredential: { not: null }, ...(only ? { workspaceId: only.workspaceId } : {}) }, select: { id: true, workspaceId: true, provider: true, encryptedCredential: true, keyVersion: true } });
  const result = { reencrypted: 0, alreadyCurrent: 0, failed: [] as string[] };
  for (const r of rows) {
    if (r.keyVersion === currentVersion) {
      result.alreadyCurrent++;
      continue;
    }
    const ctx = { workspaceId: r.workspaceId, purpose: `integration:${r.provider}` };
    try {
      const { envelope, keyVersion } = encryptSecret(decryptSecret(r.encryptedCredential!, ctx), ctx);
      await db.integrationConnection.update({ where: { id: r.id }, data: { encryptedCredential: envelope, keyVersion } });
      result.reencrypted++;
    } catch (e) {
      if (!(e instanceof SecretError)) throw e;
      result.failed.push(r.id);
    }
  }
  // Meta tokens: one row per saved token, each bound to its own ID.
  const tokens = await db.metaToken.findMany({ where: only ? { workspaceId: only.workspaceId } : {}, select: { id: true, workspaceId: true, encryptedCredential: true, keyVersion: true } });
  for (const t of tokens) {
    if (t.keyVersion === currentVersion) {
      result.alreadyCurrent++;
      continue;
    }
    const ctx = { workspaceId: t.workspaceId, purpose: metaTokenPurpose(t.id) };
    try {
      const { envelope, keyVersion } = encryptSecret(decryptSecret(t.encryptedCredential, ctx), ctx);
      await db.metaToken.update({ where: { id: t.id }, data: { encryptedCredential: envelope, keyVersion } });
      result.reencrypted++;
    } catch (e) {
      if (!(e instanceof SecretError)) throw e;
      result.failed.push(t.id);
    }
  }
  // Customer details on orders, in batches so a large workspace never loads every order at once.
  let customersFailed = 0;
  let after: string | undefined;
  for (;;) {
    const batch = await db.order.findMany({
      where: { customerEncrypted: { not: null }, ...(only ? { workspaceId: only.workspaceId } : {}), ...(after ? { id: { gt: after } } : {}) },
      select: { id: true, workspaceId: true, customerEncrypted: true, customerKeyVersion: true },
      orderBy: { id: "asc" },
      take: 500,
    });
    if (!batch.length) break;
    after = batch[batch.length - 1].id;
    for (const o of batch) {
      if (o.customerKeyVersion === currentVersion) {
        result.alreadyCurrent++;
        continue;
      }
      try {
        const { envelope, keyVersion } = resealCustomer(o.customerEncrypted!, o.workspaceId);
        await db.order.update({ where: { id: o.id }, data: { customerEncrypted: envelope, customerKeyVersion: keyVersion } });
        result.reencrypted++;
      } catch (e) {
        if (!(e instanceof SecretError)) throw e;
        customersFailed++;
      }
    }
  }
  return { ...result, customersFailed };
}
