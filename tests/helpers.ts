import type { Role } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { createWorkspace } from "@/server/repositories/workspaces";
import { createCaller } from "@/server/trpc/root";
import { resolveWorkspaceContext } from "@/server/tenancy";

export async function makeUser(name = "User") {
  return db.user.create({ data: { email: `${name.toLowerCase()}-${randomUUID()}@test.local`, name, passwordHash: "x" } });
}

export async function makeTenant(name: string) {
  const user = await makeUser(name);
  const ws = await createWorkspace(user.id, { name });
  const ctx = (await resolveWorkspaceContext(user.id, ws.id))!;
  return { user, ws, ctx, caller: callerFor(user, ws.id) };
}

export function callerFor(user: { id: string; email: string; name: string }, workspaceId: string | null) {
  return createCaller({ user: { id: user.id, email: user.email, name: user.name }, requestedWorkspaceId: workspaceId });
}

export async function addMember(workspaceId: string, role: Role, name = role) {
  const user = await makeUser(name);
  await db.workspaceMember.create({ data: { workspaceId, userId: user.id, role } });
  return { user, caller: callerFor(user, workspaceId) };
}

export const cost = { salePrice: 390000, sourcingCost: 90000, forwardShippingFee: 60000, rtoFee: 25000, callCenterFee: 12000, packagingFee: 5000 };
