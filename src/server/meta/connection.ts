import { randomUUID } from "node:crypto";
import type { AdAccount, IntegrationConnection, MetaToken, Workspace } from "@prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { InputError } from "@/server/errors";
import { rateLimit } from "@/server/rateLimit";
import { assertCan, NotFoundError, type WorkspaceContext } from "@/server/tenancy";
import { decryptSecret, encryptSecret, maskSecret } from "@/server/crypto/secrets";
import { createLiveMetaAdapter, META_HOST } from "./client";
import { createMockMetaAdapter } from "./mock";
import { MetaError, metaTokenPurpose, type MetaAdAccount, type MetaAdapter } from "./types";

/**
 * Meta ads connection. A workspace saves one or more read-only tokens, usually one per
 * Business Manager; every ad account any of them can read is listed, and each account is
 * read with the first saved token that can see it. The META_ADS IntegrationConnection
 * holds what they share: overall status, schedule, sync lease and the last sync summary.
 */
export const META = "META_ADS" as const;
export const DEFAULT_META_INTERVAL = 45;
export const MAX_META_TOKENS = 20;

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

/** What the browser may see. Never a token or its ciphertext. */
export function publicMeta(c: IntegrationConnection | null, ws: Pick<Workspace, "isDemo">, tokens: MetaToken[], accounts: AdAccount[]) {
  const now = Date.now();
  return {
    provider: META,
    status: c?.status ?? "NOT_CONFIGURED",
    hasToken: tokens.length > 0,
    lastSuccessfulSyncAt: c?.lastSuccessfulSyncAt ?? null,
    lastSyncAttemptAt: c?.lastSyncAttemptAt ?? null,
    syncing: !!c?.syncLeaseUntil && c.syncLeaseUntil.getTime() > now,
    lastError: c?.lastError ?? null,
    lastSyncSummary: (c?.lastSyncSummary ?? null) as Summary,
    syncIntervalMinutes: c?.syncIntervalMinutes ?? DEFAULT_META_INTERVAL,
    adapter: metaAdapterKind(ws),
    tokens: tokens.map((t) => ({
      id: t.id,
      label: t.label,
      maskedLabel: t.maskedLabel,
      status: t.status,
      lastTestedAt: t.lastTestedAt,
      lastError: t.lastError,
      credentialUpdatedAt: t.credentialUpdatedAt,
      accounts: accounts.filter((a) => a.tokenId === t.id).length,
    })),
    accounts: accounts.map((a) => ({
      id: a.id,
      externalId: a.externalId,
      name: a.name,
      currency: a.currency,
      timezone: a.timezone,
      accountStatus: a.accountStatus,
      enabled: a.enabled,
      tokenId: a.tokenId,
      lastSeenAt: a.lastSeenAt,
      lastSyncedAt: a.lastSyncedAt,
      lastError: a.lastError,
    })),
  };
}

/** Saved tokens, oldest first: when two can read the same ad account, the older one reads it. */
export const savedMetaTokens = (workspaceId: string) => db.metaToken.findMany({ where: { workspaceId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });

async function load(workspaceId: string) {
  const [ws, conn, tokens, accounts] = await Promise.all([
    db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { isDemo: true } }),
    db.integrationConnection.findUnique({ where: key(workspaceId) }),
    savedMetaTokens(workspaceId),
    db.adAccount.findMany({ where: { workspaceId, platform: "META" }, orderBy: [{ name: "asc" }, { externalId: "asc" }] }),
  ]);
  return { ws, conn, tokens, accounts };
}

export async function getMeta(ctx: WorkspaceContext) {
  const { ws, conn, tokens, accounts } = await load(ctx.workspaceId);
  return publicMeta(conn, ws, tokens, accounts);
}


/** Overall status: connected while at least one saved token passed its test. */
export async function refreshMetaStatus(workspaceId: string) {
  const tokens = await db.metaToken.findMany({ where: { workspaceId }, select: { status: true } });
  const status = !tokens.length ? "NOT_CONFIGURED" : tokens.some((t) => t.status === "CONNECTED") ? "CONNECTED" : tokens.some((t) => t.status === "ERROR") ? "ERROR" : "UNTESTED";
  await db.integrationConnection.upsert({
    where: key(workspaceId),
    create: { workspaceId, provider: META, baseUrl: META_HOST, syncIntervalMinutes: DEFAULT_META_INTERVAL, status },
    update: { status, ...(status === "NOT_CONFIGURED" ? { lastError: null } : {}) },
  });
}

function checkToken(raw: string) {
  const token = raw.trim();
  if (token.length < 20 || token.length > 1024 || /\s/.test(token)) throw new InputError("That does not look like a Meta access token");
  return token;
}

/**
 * Add a token (no `id`), or rename a saved one and optionally replace its token. A new or
 * replaced token must pass the connection test before it is used.
 */
export async function saveMetaToken(ctx: WorkspaceContext, input: { id?: string; label?: string; token?: string }) {
  assertCan(ctx, "integrations.manage");
  await rateLimit(`meta-save:${ctx.workspaceId}`, 10, 600);
  const label = input.label?.trim().slice(0, 80);
  const token = input.token ? checkToken(input.token) : null;
  const secret = (id: string, t: string) => {
    const { envelope, keyVersion } = encryptSecret(t, { workspaceId: ctx.workspaceId, purpose: metaTokenPurpose(id) });
    return { encryptedCredential: envelope, keyVersion, maskedLabel: maskSecret(t), status: "UNTESTED" as const, lastError: null, lastTestedAt: null, credentialUpdatedAt: new Date(), credentialUpdatedById: ctx.userId };
  };
  let saved: MetaToken;
  if (!input.id) {
    if (!token) throw new InputError("Paste a Meta access token");
    const count = await db.metaToken.count({ where: { workspaceId: ctx.workspaceId } });
    if (count >= MAX_META_TOKENS) throw new InputError(`A workspace can save up to ${MAX_META_TOKENS} Meta tokens`);
    const id = randomUUID();
    saved = await db.metaToken.create({ data: { id, workspaceId: ctx.workspaceId, label: label || `Business Manager ${count + 1}`, ...secret(id, token) } });
  } else {
    const existing = await db.metaToken.findFirst({ where: { id: input.id, workspaceId: ctx.workspaceId } });
    if (!existing) throw new NotFoundError("Meta token not found");
    saved = await db.metaToken.update({ where: { id: existing.id }, data: { ...(label ? { label } : {}), ...(token ? secret(existing.id, token) : {}) } });
  }
  await refreshMetaStatus(ctx.workspaceId);
  if (token) await audit(ctx, "integration.credential_saved", { type: "MetaToken", id: saved.id }, { provider: META, label: saved.label, maskedLabel: saved.maskedLabel });
  else await audit(ctx, "meta.token_renamed", { type: "MetaToken", id: saved.id }, { label: saved.label });
  return getMeta(ctx);
}

export async function removeMetaToken(ctx: WorkspaceContext, input: { id: string }) {
  assertCan(ctx, "integrations.manage");
  const existing = await db.metaToken.findFirst({ where: { id: input.id, workspaceId: ctx.workspaceId } });
  if (!existing) throw new NotFoundError("Meta token not found");
  // Its ad accounts stay listed (and their spend kept) until another token can read them.
  await db.metaToken.delete({ where: { id: existing.id } });
  await refreshMetaStatus(ctx.workspaceId);
  await audit(ctx, "integration.credential_removed", { type: "MetaToken", id: existing.id }, { provider: META, label: existing.label });
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

export type MetaAdapterFactory = (workspaceId: string, token: Pick<MetaToken, "id" | "label" | "encryptedCredential">) => Promise<MetaAdapter>;

/** Server-only: the adapter with one decrypted token. The token never leaves this closure. */
export const metaAdapterForToken: MetaAdapterFactory = async (workspaceId, token) => {
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { isDemo: true } });
  const plain = decryptSecret(token.encryptedCredential, { workspaceId, purpose: metaTokenPurpose(token.id) });
  return metaAdapterKind(ws) === "mock" ? createMockMetaAdapter({ token: plain }) : createLiveMetaAdapter(plain);
};

/**
 * Save what the tokens can see. `owner` maps each listed account to the token that reads it.
 * New accounts start enabled: every account is synced unless switched off. Accounts that one
 * of `listedBy` used to read but no longer lists are released, so another token can take them.
 */
export async function recordAdAccounts(workspaceId: string, accounts: MetaAdAccount[], owner: Map<string, string>, seenAt: Date, listedBy: string[]) {
  for (const a of accounts) {
    const fields = { name: a.name, currency: a.currency, timezone: a.timezone, accountStatus: a.accountStatus, lastSeenAt: seenAt, tokenId: owner.get(a.id) ?? null };
    await db.adAccount.upsert({
      where: { workspaceId_platform_externalId: { workspaceId, platform: "META", externalId: a.id } },
      create: { workspaceId, platform: "META", externalId: a.id, ...fields },
      update: fields,
    });
  }
  if (listedBy.length) await db.adAccount.updateMany({ where: { workspaceId, tokenId: { in: listedBy }, externalId: { notIn: accounts.map((a) => a.id) } }, data: { tokenId: null } });
}

/**
 * Lists the ad accounts one token can read. It takes over accounts no working token reads
 * yet; accounts another working token already reads stay with that token.
 */
export async function testMeta(ctx: WorkspaceContext, input: { id: string }, factory: MetaAdapterFactory = metaAdapterForToken) {
  assertCan(ctx, "integrations.manage");
  await rateLimit(`meta-test:${ctx.workspaceId}`, 10, 600);
  const token = await db.metaToken.findFirst({ where: { id: input.id, workspaceId: ctx.workspaceId } });
  if (!token) throw new NotFoundError("Meta token not found");
  const adapter = await factory(ctx.workspaceId, token);
  let ok = false;
  let message: string;
  try {
    const listed = await adapter.listAdAccounts();
    const current = await db.adAccount.findMany({ where: { workspaceId: ctx.workspaceId, platform: "META", externalId: { in: listed.map((a) => a.id) } }, select: { externalId: true, tokenId: true, token: { select: { status: true } } } });
    const keptByOther = new Set(current.filter((a) => a.tokenId && a.tokenId !== token.id && a.token?.status === "CONNECTED").map((a) => a.externalId));
    const mine = listed.filter((a) => !keptByOther.has(a.id));
    await recordAdAccounts(ctx.workspaceId, mine, new Map(mine.map((a) => [a.id, token.id])), new Date(), [token.id]);
    ok = true;
    const prefix = adapter.kind === "mock" ? "Demo adapter responded (not a real Meta account). " : "Connected. Meta accepted the token (read-only check). ";
    const shared = keptByOther.size ? ` ${keptByOther.size} of them ${keptByOther.size === 1 ? "is" : "are"} already read through another saved token.` : "";
    message = listed.length
      ? `${prefix}It can read ${listed.length} ad account${listed.length === 1 ? "" : "s"}; all of them are synced unless you switch one off below.${shared}`
      : `${prefix}It can't see any ad account yet: in Meta Business Settings, assign your ad accounts to the system user, then test again.`;
  } catch (e) {
    if (!(e instanceof MetaError)) console.error("[meta] connection test failed", e);
    message = safeMetaMessage(e);
  }
  await db.metaToken.update({ where: { id: token.id }, data: { status: ok ? "CONNECTED" : "ERROR", lastTestedAt: new Date(), lastError: ok ? null : message } });
  await refreshMetaStatus(ctx.workspaceId);
  await audit(ctx, "integration.tested", { type: "MetaToken", id: token.id }, { provider: META, ok, adapter: adapter.kind });
  return { ok, message, connection: await getMeta(ctx) };
}
