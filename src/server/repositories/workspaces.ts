import type { Prisma, Role } from "@prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { DEFAULT_MDM_STATUS_MAP } from "@/domain/statusMapping";
import { economicsDefaultsSchema, parseExchangeRates, verdictThresholdsSchema, type EconomicsDefaults, type ExchangeRates, type VerdictThresholds } from "@/domain/settings";
import { assertCan, ForbiddenError, NotFoundError, type WorkspaceContext } from "@/server/tenancy";

function slugify(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "workspace";
  return `${base}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Creating a workspace is the one operation without a WorkspaceContext: the creator becomes OWNER. */
export async function createWorkspace(
  userId: string,
  input: { name: string; currency?: string; isDemo?: boolean },
  tx: Prisma.TransactionClient = db,
) {
  const ws = await tx.workspace.create({
    data: {
      name: input.name,
      slug: slugify(input.name),
      currency: input.currency ?? "DZD",
      isDemo: input.isDemo ?? false,
      economicsDefaults: economicsDefaultsSchema.parse({}),
      verdictThresholds: verdictThresholdsSchema.parse({}),
      members: { create: { userId, role: "OWNER" } },
      connections: { create: { provider: "MDM_EXPRESS" } },
      statusMappings: {
        create: Object.entries(DEFAULT_MDM_STATUS_MAP).map(([providerStatus, normalizedStatus]) => ({
          provider: "MDM_EXPRESS" as const,
          providerStatus,
          normalizedStatus,
        })),
      },
    },
  });
  await tx.auditLog.create({ data: { workspaceId: ws.id, actorUserId: userId, action: "workspace.created", entityType: "Workspace", entityId: ws.id } });
  return ws;
}

export async function listWorkspacesForUser(userId: string) {
  const memberships = await db.workspaceMember.findMany({
    where: { userId },
    include: { workspace: { select: { id: true, name: true, isDemo: true, currency: true } } },
    orderBy: { createdAt: "asc" },
  });
  return memberships.map((m) => ({ ...m.workspace, role: m.role }));
}

export async function getWorkspace(ctx: WorkspaceContext) {
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: ctx.workspaceId } });
  return {
    id: ws.id,
    name: ws.name,
    currency: ws.currency,
    timezone: ws.timezone,
    isDemo: ws.isDemo,
    economicsDefaults: economicsDefaultsSchema.parse(ws.economicsDefaults ?? {}),
    verdictThresholds: verdictThresholdsSchema.parse(ws.verdictThresholds ?? {}),
    exchangeRates: parseExchangeRates(ws.exchangeRates),
  };
}

export async function updateWorkspace(
  ctx: WorkspaceContext,
  input: { name?: string; timezone?: string; economicsDefaults?: EconomicsDefaults; verdictThresholds?: VerdictThresholds; exchangeRates?: ExchangeRates },
) {
  if (input.name !== undefined || input.timezone !== undefined) assertCan(ctx, "workspace.manage");
  if (input.economicsDefaults || input.verdictThresholds || input.exchangeRates) assertCan(ctx, "settings.economics");
  // A rate for the workspace's own currency would be meaningless (always 1).
  const exchangeRates = input.exchangeRates ? Object.fromEntries(Object.entries(input.exchangeRates).filter(([c]) => c !== ctx.currency)) : undefined;
  const ws = await db.workspace.update({
    where: { id: ctx.workspaceId },
    data: {
      name: input.name,
      timezone: input.timezone,
      economicsDefaults: input.economicsDefaults,
      verdictThresholds: input.verdictThresholds,
      exchangeRates,
    },
  });
  await audit(ctx, "workspace.settings_updated", { type: "Workspace", id: ws.id }, { fields: Object.keys(input), ...(exchangeRates ? { exchangeRates } : {}) });
  return ws;
}

// ───────────── Members ─────────────

export async function listMembers(ctx: WorkspaceContext) {
  const members = await db.workspaceMember.findMany({
    where: { workspaceId: ctx.workspaceId },
    include: { user: { select: { id: true, email: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return members.map((m) => ({ id: m.id, role: m.role, userId: m.userId, email: m.user.email, name: m.user.name, createdAt: m.createdAt }));
}

export async function addMember(ctx: WorkspaceContext, input: { email: string; role: Role }) {
  assertCan(ctx, "members.manage");
  const user = await db.user.findUnique({ where: { email: input.email.toLowerCase() } });
  if (!user) throw new NotFoundError("No account with that email. Ask them to sign up first, then add them here.");
  const member = await db.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: ctx.workspaceId, userId: user.id } },
    create: { workspaceId: ctx.workspaceId, userId: user.id, role: input.role },
    update: {},
  });
  await audit(ctx, "member.added", { type: "WorkspaceMember", id: member.id }, { email: user.email, role: input.role });
  return member;
}

async function assertNotLastOwner(workspaceId: string, memberId: string) {
  const owners = await db.workspaceMember.count({ where: { workspaceId, role: "OWNER", NOT: { id: memberId } } });
  if (owners === 0) throw new ForbiddenError("A workspace must keep at least one owner");
}

export async function changeMemberRole(ctx: WorkspaceContext, input: { memberId: string; role: Role }) {
  assertCan(ctx, "members.manage");
  const member = await db.workspaceMember.findFirst({ where: { id: input.memberId, workspaceId: ctx.workspaceId } });
  if (!member) throw new NotFoundError("Member not found");
  if (member.role === "OWNER" && input.role !== "OWNER") await assertNotLastOwner(ctx.workspaceId, member.id);
  const updated = await db.workspaceMember.update({ where: { id: member.id }, data: { role: input.role } });
  await audit(ctx, "member.role_changed", { type: "WorkspaceMember", id: member.id }, { from: member.role, to: input.role });
  return updated;
}

export async function removeMember(ctx: WorkspaceContext, memberId: string) {
  assertCan(ctx, "members.manage");
  const member = await db.workspaceMember.findFirst({ where: { id: memberId, workspaceId: ctx.workspaceId } });
  if (!member) throw new NotFoundError("Member not found");
  if (member.role === "OWNER") await assertNotLastOwner(ctx.workspaceId, member.id);
  await db.workspaceMember.delete({ where: { id: member.id } });
  await audit(ctx, "member.removed", { type: "WorkspaceMember", id: member.id }, { role: member.role });
}

// ───────────── Audit ─────────────

export async function listAuditLog(ctx: WorkspaceContext, input: { cursor?: string; limit: number }) {
  assertCan(ctx, "audit.read");
  const rows = await db.auditLog.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });
  const actorIds = [...new Set(rows.map((r) => r.actorUserId).filter(Boolean))] as string[];
  const actors = await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true } });
  const byId = new Map(actors.map((a) => [a.id, a]));
  const items = rows.slice(0, input.limit).map((r) => ({ ...r, actor: r.actorUserId ? byId.get(r.actorUserId) ?? null : null }));
  return { items, nextCursor: rows.length > input.limit ? rows[input.limit].id : null };
}
