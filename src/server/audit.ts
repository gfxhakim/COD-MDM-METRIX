import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import type { WorkspaceContext } from "@/server/tenancy";

const SECRET_KEYS = /(key|token|secret|password|credential|authorization)/i;

/** Remove anything that looks like a secret before it reaches the audit log. */
export function sanitizeMetadata(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value.map((v) => sanitizeMetadata(v) ?? null) as Prisma.InputJsonValue;
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.test(k) ? "[redacted]" : sanitizeMetadata(v) ?? null;
    }
    return out as Prisma.InputJsonValue;
  }
  if (value instanceof Date) return value.toISOString();
  return value as Prisma.InputJsonValue;
}

export async function audit(
  ctx: WorkspaceContext,
  action: string,
  entity?: { type: string; id?: string | null },
  metadata?: unknown,
  tx: Prisma.TransactionClient = db,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.userId,
      action,
      entityType: entity?.type,
      entityId: entity?.id ?? undefined,
      metadata: sanitizeMetadata(metadata),
    },
  });
}
