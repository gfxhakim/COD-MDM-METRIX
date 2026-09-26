import { db } from "@/server/db";
import { z } from "zod";
import { NormalizedStatus } from "@prisma/client";
import * as conn from "@/server/mdm/connection";
import * as sync from "@/server/mdm/sync";
import { kickSync } from "@/server/mdm/runner";
import { permitted, router, workspaceProcedure } from "@/server/trpc/init";
import { id } from "@/server/trpc/schemas";

export const integrationsRouter = router({
  mdm: workspaceProcedure.query(({ ctx }) => conn.getConnection(ctx.ws)),
  /** The credential travels once, in a POST body, and is encrypted before it touches the database. Only a mask comes back. */
  saveMdmCredential: permitted("integrations.manage")
    .input(z.object({ credential: z.string().min(1).max(512), baseUrl: z.string().max(200).optional() }))
    .mutation(({ ctx, input }) => conn.saveCredential(ctx.ws, input)),
  removeMdmCredential: permitted("integrations.manage").mutation(({ ctx }) => conn.removeCredential(ctx.ws)),
  testMdm: permitted("integrations.manage").mutation(({ ctx }) => conn.testConnection(ctx.ws)),
  setSyncInterval: permitted("integrations.manage")
    .input(z.object({ minutes: z.number().int().min(15).max(24 * 60) }))
    .mutation(({ ctx, input }) => conn.setSyncInterval(ctx.ws, input.minutes)),
});

export const syncRouter = router({
  start: permitted("sync.run")
    .input(z.object({ mode: z.enum(["INCREMENTAL", "FULL"]).default("INCREMENTAL") }))
    .mutation(async ({ ctx, input }) => {
      const res = await sync.startSync(ctx.ws, input);
      if (!res.alreadyRunning) kickSync(res.job.id);
      return { jobId: res.job.id, alreadyRunning: res.alreadyRunning };
    }),
  cancel: permitted("sync.run").input(z.object({ id })).mutation(({ ctx, input }) => sync.cancelSync(ctx.ws, input.id)),
  retry: permitted("sync.run")
    .input(z.object({ id }))
    .mutation(async ({ ctx, input }) => {
      const res = await sync.retryFailed(ctx.ws, input.id);
      if (!res.alreadyRunning) kickSync(res.job.id);
      return { jobId: res.job.id, alreadyRunning: res.alreadyRunning };
    }),
  list: workspaceProcedure.input(z.object({ limit: z.number().int().min(1).max(100).default(30) })).query(({ ctx, input }) => sync.listJobs(ctx.ws, input.limit)),
  get: workspaceProcedure.input(z.object({ id })).query(({ ctx, input }) => sync.getJob(ctx.ws, input.id)),
  unmatched: workspaceProcedure
    .input(z.object({ status: z.enum(["OPEN", "RESOLVED", "IGNORED"]).default("OPEN"), limit: z.number().int().min(1).max(200).default(100) }))
    .query(({ ctx, input }) => sync.listUnmatched(ctx.ws, input)),
  ignoreUnmatched: permitted("orders.match").input(z.object({ id, ignore: z.boolean() })).mutation(({ ctx, input }) => sync.ignoreUnmatched(ctx.ws, input.id, input.ignore)),
  statusMappings: workspaceProcedure.query(({ ctx }) =>
    db.statusMapping.findMany({ where: { workspaceId: ctx.ws.workspaceId, provider: "MDM_EXPRESS" }, orderBy: { providerStatus: "asc" }, select: { id: true, providerStatus: true, normalizedStatus: true, updatedAt: true } }),
  ),
  unknownStatuses: workspaceProcedure.query(({ ctx }) => sync.unknownStatuses(ctx.ws)),
  mapStatus: permitted("settings.economics")
    .input(z.object({ providerStatus: z.string().trim().min(1).max(100), normalizedStatus: z.enum(NormalizedStatus) }))
    .mutation(({ ctx, input }) => sync.mapStatus(ctx.ws, input)),
});
