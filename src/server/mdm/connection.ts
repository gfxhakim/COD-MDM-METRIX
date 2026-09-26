import type { IntegrationConnection, Workspace } from "@prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { InputError } from "@/server/errors";
import { rateLimit } from "@/server/rateLimit";
import { assertCan, type WorkspaceContext } from "@/server/tenancy";
import { decryptSecret, encryptSecret, maskSecret } from "@/server/crypto/secrets";
import { demoFixtures } from "./demo-fixtures";
import { createLiveAdapter, LIVE_SCHEMA } from "./live";
import { createMockAdapter } from "./mock";
import { MdmError, type MdmAdapter } from "./types";
import { DEFAULT_MDM_BASE_URL, validateMdmBaseUrl } from "./url";

const PROVIDER = "MDM_EXPRESS" as const;
const PURPOSE = "integration:MDM_EXPRESS";

/** Demo workspaces always use the labelled mock. Other workspaces use it only when explicitly enabled outside production. */
export function adapterKind(ws: Pick<Workspace, "isDemo">): "mock" | "live" {
  if (ws.isDemo) return "mock";
  if (process.env.MDM_ADAPTER === "mock" && process.env.NODE_ENV !== "production") return "mock";
  return "live";
}

/** What the browser may see. Never includes the ciphertext or the plaintext. */
export function publicConnection(c: IntegrationConnection | null, ws: Pick<Workspace, "isDemo">) {
  const kind = adapterKind(ws);
  return {
    provider: PROVIDER,
    status: c?.status ?? "NOT_CONFIGURED",
    hasCredential: !!c?.encryptedCredential,
    maskedLabel: c?.maskedLabel ?? null,
    baseUrl: c?.baseUrl ?? DEFAULT_MDM_BASE_URL,
    lastTestedAt: c?.lastTestedAt ?? null,
    lastSuccessfulSyncAt: c?.lastSuccessfulSyncAt ?? null,
    lastError: c?.lastError ?? null,
    syncIntervalMinutes: c?.syncIntervalMinutes ?? 45,
    credentialUpdatedAt: c?.credentialUpdatedAt ?? null,
    adapter: kind,
    liveAdapterReady: LIVE_SCHEMA !== null,
  };
}

async function load(ctx: WorkspaceContext) {
  const [ws, conn] = await Promise.all([
    db.workspace.findUniqueOrThrow({ where: { id: ctx.workspaceId }, select: { isDemo: true } }),
    db.integrationConnection.findUnique({ where: { workspaceId_provider: { workspaceId: ctx.workspaceId, provider: PROVIDER } } }),
  ]);
  return { ws, conn };
}

export async function getConnection(ctx: WorkspaceContext) {
  const { ws, conn } = await load(ctx);
  return publicConnection(conn, ws);
}

export async function saveCredential(ctx: WorkspaceContext, input: { credential: string; baseUrl?: string }) {
  assertCan(ctx, "integrations.manage");
  await rateLimit(`mdm-save:${ctx.workspaceId}`, 10, 600);
  const credential = input.credential.trim();
  if (credential.length < 8 || credential.length > 512 || /\s/.test(credential)) throw new InputError("That does not look like an MDM API key");
  const baseUrl = validateMdmBaseUrl(input.baseUrl || DEFAULT_MDM_BASE_URL);
  const { envelope, keyVersion } = encryptSecret(credential, { workspaceId: ctx.workspaceId, purpose: PURPOSE });
  const maskedLabel = maskSecret(credential);
  const data = { encryptedCredential: envelope, keyVersion, maskedLabel, baseUrl, status: "UNTESTED" as const, lastError: null, lastTestedAt: null, credentialUpdatedAt: new Date(), credentialUpdatedById: ctx.userId };
  const conn = await db.integrationConnection.upsert({
    where: { workspaceId_provider: { workspaceId: ctx.workspaceId, provider: PROVIDER } },
    create: { workspaceId: ctx.workspaceId, provider: PROVIDER, ...data },
    update: data,
  });
  await audit(ctx, "integration.credential_saved", { type: "IntegrationConnection", id: conn.id }, { provider: PROVIDER, maskedLabel, baseUrl });
  const { ws } = await load(ctx);
  return publicConnection(conn, ws);
}

export async function removeCredential(ctx: WorkspaceContext) {
  assertCan(ctx, "integrations.manage");
  const { ws, conn } = await load(ctx);
  if (!conn) return publicConnection(null, ws);
  const updated = await db.integrationConnection.update({ where: { id: conn.id }, data: { encryptedCredential: null, keyVersion: null, maskedLabel: null, status: "NOT_CONFIGURED", lastError: null, lastTestedAt: null, credentialUpdatedAt: new Date(), credentialUpdatedById: ctx.userId } });
  await audit(ctx, "integration.credential_removed", { type: "IntegrationConnection", id: conn.id }, { provider: PROVIDER });
  return publicConnection(updated, ws);
}

export async function setSyncInterval(ctx: WorkspaceContext, minutes: number) {
  assertCan(ctx, "integrations.manage");
  const { ws } = await load(ctx);
  const conn = await db.integrationConnection.upsert({
    where: { workspaceId_provider: { workspaceId: ctx.workspaceId, provider: PROVIDER } },
    create: { workspaceId: ctx.workspaceId, provider: PROVIDER, syncIntervalMinutes: minutes },
    update: { syncIntervalMinutes: minutes },
  });
  await audit(ctx, "integration.interval_changed", { type: "IntegrationConnection", id: conn.id }, { minutes });
  return publicConnection(conn, ws);
}

/** Server-only: builds the adapter with the decrypted credential. The credential never leaves this closure. */
export async function adapterForWorkspace(workspaceId: string): Promise<{ adapter: MdmAdapter; connection: IntegrationConnection | null }> {
  const [ws, conn] = await Promise.all([
    db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { isDemo: true } }),
    db.integrationConnection.findUnique({ where: { workspaceId_provider: { workspaceId, provider: PROVIDER } } }),
  ]);
  const credential = conn?.encryptedCredential ? decryptSecret(conn.encryptedCredential, { workspaceId, purpose: PURPOSE }) : null;
  if (adapterKind(ws) === "mock") return { adapter: createMockAdapter({ credential, fixtures: await demoFixtures(workspaceId) }), connection: conn };
  return { adapter: createLiveAdapter({ baseUrl: conn?.baseUrl ?? DEFAULT_MDM_BASE_URL, credential }), connection: conn };
}

/** Messages shown to users and stored in lastError: fixed per error kind, never provider bodies. */
export function safeMdmMessage(e: unknown): string {
  if (e instanceof MdmError) return e.message.slice(0, 300);
  return "Unexpected error while talking to MDM. It was logged on the server.";
}

export type AdapterFactory = (workspaceId: string) => Promise<{ adapter: MdmAdapter; connection: IntegrationConnection | null }>;

export async function testConnection(ctx: WorkspaceContext, factory: AdapterFactory = adapterForWorkspace) {
  assertCan(ctx, "integrations.manage");
  await rateLimit(`mdm-test:${ctx.workspaceId}`, 10, 600);
  const { ws, conn } = await load(ctx);
  if (!conn?.encryptedCredential) throw new InputError("Save an MDM API key first");
  const { adapter } = await factory(ctx.workspaceId);
  let ok = false;
  let message: string;
  let accountLabel: string | null = null;
  try {
    ({ accountLabel } = await adapter.testConnection());
    ok = true;
    message = adapter.kind === "mock" ? "Demo adapter responded. This workspace uses labelled demo fixtures, not a real MDM account." : "Connected. MDM accepted the credential (read-only check).";
  } catch (e) {
    if (!(e instanceof MdmError)) console.error("[mdm] connection test failed", e);
    message = safeMdmMessage(e);
  }
  const notAvailable = !ok && adapter.kind === "live" && LIVE_SCHEMA === null;
  const updated = await db.integrationConnection.update({
    where: { id: conn.id },
    data: { status: ok ? "CONNECTED" : notAvailable ? "UNTESTED" : "ERROR", lastTestedAt: new Date(), lastError: ok ? null : message },
  });
  await audit(ctx, "integration.tested", { type: "IntegrationConnection", id: conn.id }, { ok, adapter: adapter.kind });
  return { ok, message, accountLabel, connection: publicConnection(updated, ws) };
}
