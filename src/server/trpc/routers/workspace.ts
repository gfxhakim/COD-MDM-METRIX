import { z } from "zod";
import { economicsDefaultsSchema, verdictThresholdsSchema } from "@/domain/settings";
import * as repo from "@/server/repositories/workspaces";
import { getDataHealth, getOperationalCounts } from "@/server/repositories/overview";
import { authedProcedure, permitted, router, workspaceProcedure } from "@/server/trpc/init";
import { id, roleEnum } from "@/server/trpc/schemas";

export const workspaceRouter = router({
  listMine: authedProcedure.query(({ ctx }) => repo.listWorkspacesForUser(ctx.user.id)),
  create: authedProcedure
    .input(z.object({ name: z.string().trim().min(2).max(80), currency: z.string().length(3).default("DZD") }))
    .mutation(({ ctx, input }) => repo.createWorkspace(ctx.user.id, input)),
  getCurrent: workspaceProcedure.query(async ({ ctx }) => ({ ...(await repo.getWorkspace(ctx.ws)), role: ctx.ws.role })),
  updateSettings: workspaceProcedure
    .input(
      z.object({
        name: z.string().trim().min(2).max(80).optional(),
        timezone: z.string().max(60).optional(),
        economicsDefaults: economicsDefaultsSchema.optional(),
        verdictThresholds: verdictThresholdsSchema.optional(),
      }),
    )
    .mutation(({ ctx, input }) => repo.updateWorkspace(ctx.ws, input)),
  dataHealth: workspaceProcedure.query(({ ctx }) => getDataHealth(ctx.ws)),
  operationalCounts: workspaceProcedure
    .input(z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() }))
    .query(({ ctx, input }) => getOperationalCounts(ctx.ws, input)),
});

export const membersRouter = router({
  list: workspaceProcedure.query(({ ctx }) => repo.listMembers(ctx.ws)),
  add: permitted("members.manage")
    .input(z.object({ email: z.string().email(), role: roleEnum }))
    .mutation(({ ctx, input }) => repo.addMember(ctx.ws, input)),
  changeRole: permitted("members.manage")
    .input(z.object({ memberId: id, role: roleEnum }))
    .mutation(({ ctx, input }) => repo.changeMemberRole(ctx.ws, input)),
  remove: permitted("members.manage")
    .input(z.object({ memberId: id }))
    .mutation(({ ctx, input }) => repo.removeMember(ctx.ws, input.memberId)),
});

export const auditRouter = router({
  list: permitted("audit.read")
    .input(z.object({ cursor: id.optional(), limit: z.number().int().min(1).max(100).default(50) }))
    .query(({ ctx, input }) => repo.listAuditLog(ctx.ws, input)),
});
