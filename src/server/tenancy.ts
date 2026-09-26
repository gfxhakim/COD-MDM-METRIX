import type { Role } from "@prisma/client";
import { db } from "@/server/db";

/**
 * Every repository method takes a WorkspaceContext. It is only ever built by
 * resolveWorkspaceContext, which checks membership server-side, so a workspace
 * id supplied by the browser is never trusted on its own.
 */
export type WorkspaceContext = {
  readonly workspaceId: string;
  readonly userId: string;
  readonly role: Role;
  readonly currency: string;
  readonly isDemo: boolean;
};

export class ForbiddenError extends Error {
  constructor(message = "You do not have access to this resource") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends Error {
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

export async function resolveWorkspaceContext(
  userId: string,
  requestedWorkspaceId: string | null | undefined,
): Promise<WorkspaceContext | null> {
  const membership = requestedWorkspaceId
    ? await db.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: requestedWorkspaceId, userId } },
        include: { workspace: true },
      })
    : null;
  const fallback =
    membership ??
    (await db.workspaceMember.findFirst({
      where: { userId },
      include: { workspace: true },
      orderBy: { createdAt: "asc" },
    }));
  if (!fallback) return null;
  return {
    workspaceId: fallback.workspaceId,
    userId,
    role: fallback.role,
    currency: fallback.workspace.currency,
    isDemo: fallback.workspace.isDemo,
  };
}

export { PERMISSIONS, can, type Permission } from "@/lib/permissions";
import { can, type Permission } from "@/lib/permissions";

export function assertCan(ctx: WorkspaceContext, permission: Permission): void {
  if (!can(ctx.role, permission)) throw new ForbiddenError(`Your role (${ctx.role}) cannot perform this action`);
}
