import type { AdAccount, IntegrationConnection, Workspace } from "@prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { InputError } from "@/server/errors";
import { rateLimit } from "@/server/rateLimit";
import { assertCan, NotFoundError, type WorkspaceContext } from "@/server/tenancy";
import { decryptSecret, encryptSecret, maskSecret } from "@/server/crypto/secrets";
import { createLiveMetaAdapter, META_HOST } from "./client";
import { createMockMetaAdapter } from "./mock";
import { MetaError, type MetaAdAccount, type MetaAdapter } from "./types";

export const META = "META_ADS" as const;
const PURPOSE = "integration:META_ADS";
export const DEFAULT_META_INTERVAL = 45;

const key = (workspaceId: string) => ({ workspaceId_provider: { workspaceId, provider: META } });

/** Demo workspaces use the labelled mock; others only outside production when explicitly asked. */
export function metaAdapterKind(ws: Pick<Workspace, "isDemo">): "mock" | "live" {
  if (ws.isDemo) return "mock";
  if (process.env.META_ADAPTER === "mock" && process.env.NODE_ENV !== "production") return "mock";
  return "live";
}

/** Messages shown to users and stored: fixed per error kind, never Meta's own text. */
export function safeMetaMessage(e: unknown): string {
  if (e instanceof MetaError) return e.message.slice(0, 300);
  return "Unexpected error while talking to Meta. It was logged on the server.";
}

type Summary = { from?: string; until?: string; accounts?: number; added?: number; updated?: number; unchanged?: number; superseded?: number; spend?: number; failed?: { account: string; message: string }[] } | null;

/** What the browser may see. Never the token or its ciphertext. */
export function publicMeta(c: IntegrationConnection | null, ws: Pick<Workspace, "isDemo">, accounts: AdAccount[]) {
  const now = Date.now();
  return {
    provider: META,
    status: c?.status ?? "NOT_CONFIGURED",
    hasToken: !!c?.encryptedCredential,
    maskedLabel: c?.maskedLabel ?? null,
    lastTestedAt: c?.lastTestedAt ?? null,
    lastSuccessfulSyncAt: c?.lastSuccessfulSyncAt ?? null,
    lastSyncAttemptAt: c?.lastSyncAttemptAt ?? null,
    syncing: !!c?.syncLeaseUntil && c.syncLeaseUntil.getTime() > now,
    lastError: c?.lastError ?? null,
    lastSyncSummary: (c?.lastSyncSummary ?? null) as Summary,
    syncIntervalMinutes: c?.syncIntervalMinutes ?? DEFAULT_META_INTERVAL,
    credentialUpdatedAt: c?.credentialUpdatedAt ?? null,
    adapter: metaAdapterKind(ws),
    accounts: accounts.map((a) => ({
      id: a.id,
      externalId: a.externalId,
      name: a.name,
      currency: a.currency,
      timezone: a.timezone,
      accountStatus: a.accountStatus,
      enabled: a.enabled,
      lastSeenAt: a.lastSeenAt,
      lastSyncedAt: a.lastSyncedAt,
      lastError: a.lastError,
    })),
  };
}

async function load(workspaceId: string) {
  const [ws, conn, accounts] = await Promise.all([
    db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { isDemo: true } }),
    db.integrationConnection.findUnique({ where: key(workspaceId) }),
    db.adAccount.findMany({ where: { workspaceId, platform: "META" }, orderBy: [{ lastSeenAt: { sort: "desc", nulls: "last" } }, { name: "asc" }] }),
  ]);
  return { ws, conn, accounts };
}

export async function getMeta(ctx: WorkspaceContext) {
  const { ws, conn, accounts } = await load(ctx.workspaceId);
  return publicMeta(conn, ws, accounts);
}

export async function saveMetaToken(ctx: WorkspaceContext, input: { token: string }) {
  assertCan(ctx, "integrations.manage");
  await rateLimit(`meta-save:${ctx.workspaceId}`, 10, 600);
  const token = input.token.trim();
  if (token.length < 20 || token.length > 1024 || /\s/.test(token)) throw new InputError("That does not look like a Meta access token");
  const { envelope, keyVersion } = encryptSecret(token, { workspaceId: ctx.workspaceId, purpose: PURPOSE });
  const maskedLabel = maskSecret(token);
  const data = { encryptedCredential: envelope, keyVersion, maskedLabel, baseUrl: META_HOST, status: "UNTESTED" as const, lastError: null, lastTestedAt: null, credentialUpdatedAt: new Date(), credentialUpdatedById: ctx.userId };
  const conn = await db.integrationConnection.upsert({
    where: key(ctx.workspaceId),
    create: { workspaceId: ctx.workspaceId, provider: META, syncIntervalMinutes: DEFAULT_META_INTERVAL, ...data },
    update: data,
  });
  await audit(ctx, "integration.credential_saved", { type: "IntegrationConnection", id: conn.id }, { provider: META, maskedLabel });
  return getMeta(ctx);
}

export async function removeMetaToken(ctx: WorkspaceContext) {
  assertCan(ctx, "integrations.manage");
  const conn = await db.integrationConnection.findUnique({ where: key(ctx.workspaceId) });
  if (conn) {
    await db.integrationConnection.update({ where: { id: conn.id }, data: { encryptedCredential: null, keyVersion: null, maskedLabel: null, status: "NOT_CONFIGURED", lastError: null, lastTestedAt: null, credentialUpdatedAt: new Date(), credentialUpdatedById: ctx.userId } });
    await audit(ctx, "integration.credential_removed", { type: "IntegrationConnection", id: conn.id }, { provider: META });
  }
  return getMeta(ctx);
}

export async function setMetaInterval(ctx: WorkspaceContext, minutes: number) {
  assertCan(ctx, "integrations.manage");
  const conn = await db.integrationConnection.upsert({
    where: key(ctx.workspaceId),
    create: { workspaceId: ctx.workspaceId, provider: META, baseUrl: META_HOST, syncIntervalMinutes: minutes },
    update: { syncIntervalMinutes: minutes },
  });
  await audit(ctx, "integration.interval_changed", { type: "IntegrationConnection", id: conn.id }, { provider: META, minutes });
  return getMeta(ctx);
}

export async function setAdAccountEnabled(ctx: WorkspaceContext, input: { id: string; enabled: boolean }) {
  assertCan(ctx, "integrations.manage");
  const acc = await db.adAccount.findFirst({ where: { id: input.id, workspaceId: ctx.workspaceId } });
  if (!acc) throw new NotFoundError("Ad account not found");
  await db.adAccount.update({ where: { id: acc.id }, data: { enabled: input.enabled } });
  await audit(ctx, input.enabled ? "meta.account_enabled" : "meta.account_disabled", { type: "AdAccount", id: acc.id }, { account: acc.externalId });
  return getMeta(ctx);
}

/** Server-only: the adapter with the decrypted token. The token never leaves this closure. */
export async function metaAdapterForWorkspace(workspaceId: string): Promise<MetaAdapter> {
  const { ws, conn } = await load(workspaceId);
  const token = conn?.encryptedCredential ? decryptSecret(conn.encryptedCredential, { workspaceId, purpose: PURPOSE }) : null;
  return metaAdapterKind(ws) === "mock" ? createMockMetaAdapter({ token }) : createLiveMetaAdapter(token);
}

export type MetaAdapterFactory = (workspaceId: string) => Promise<MetaAdapter>;

/** Save what the token can see. New accounts start enabled: every account is synced unless switched off. */
export async function recordAdAccounts(workspaceId: string, accounts: MetaAdAccount[], seenAt: Date) {
  for (const a of accounts) {
    const fields = { name: a.name, currency: a.currency, timezone: a.timezone, accountStatus: a.accountStatus, lastSeenAt: seenAt };
    await db.adAccount.upsert({
      where: { workspaceId_platform_externalId: { workspaceId, platform: "META", externalId: a.id } },
      create: { workspaceId, platform: "META", externalId: a.id, ...fields },
      update: fields,
    });
  }
}

export async function testMeta(ctx: WorkspaceContext, factory: MetaAdapterFactory = metaAdapterForWorkspace) {
  assertCan(ctx, "integrations.manage");
  await rateLimit(`meta-test:${ctx.workspaceId}`, 10, 600);
  const conn = await db.integrationConnection.findUnique({ where: key(ctx.workspaceId) });
  if (!conn?.encryptedCredential) throw new InputError("Save a Meta access token first");
  const adapter = await factory(ctx.workspaceId);
  let ok = false;
  let message: string;
  try {
    const accounts = await adapter.listAdAccounts();
    await recordAdAccounts(ctx.workspaceId, accounts, new Date());
    ok = true;
    const prefix = adapter.kind === "mock" ? "Demo adapter responded (not a real Meta account). " : "Connected. Meta accepted the token (read-only check). ";
    message = accounts.length
      ? `${prefix}It can read ${accounts.length} ad account${accounts.length === 1 ? "" : "s"}; all of them are synced unless you switch one off below.`
      : `${prefix}It can't see any ad account yet: in Meta Business Settings, assign your ad accounts to the system user, then test again.`;
  } catch (e) {
    if (!(e instanceof MetaError)) console.error("[meta] connection test failed", e);
    message = safeMetaMessage(e);
  }
  await db.integrationConnection.update({ where: { id: conn.id }, data: { status: ok ? "CONNECTED" : "ERROR", lastTestedAt: new Date(), lastError: ok ? null : message } });
  await audit(ctx, "integration.tested", { type: "IntegrationConnection", id: conn.id }, { provider: META, ok, adapter: adapter.kind });
  return { ok, message, connection: await getMeta(ctx) };
}
