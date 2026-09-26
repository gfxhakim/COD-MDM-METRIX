import { z } from "zod";
import * as repo from "@/server/repositories/products";
import { permitted, router, workspaceProcedure } from "@/server/trpc/init";
import { costInput, id } from "@/server/trpc/schemas";

const sku = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._\-]+$/, "Use letters, digits, dot, dash or underscore");

export const productsRouter = router({
  list: workspaceProcedure
    .input(z.object({ includeInactive: z.boolean().default(true) }).default({ includeInactive: true }))
    .query(({ ctx, input }) => repo.listProducts(ctx.ws, input)),
  get: workspaceProcedure.input(z.object({ id })).query(({ ctx, input }) => repo.getProduct(ctx.ws, input.id)),
  create: permitted("catalog.write")
    .input(z.object({ name: z.string().trim().min(1).max(120), sku, active: z.boolean().default(true), cost: costInput }))
    .mutation(({ ctx, input }) => repo.createProduct(ctx.ws, input)),
  update: permitted("catalog.write")
    .input(z.object({ id, name: z.string().trim().min(1).max(120).optional(), sku: sku.optional(), active: z.boolean().optional() }))
    .mutation(({ ctx, input }) => repo.updateProduct(ctx.ws, input)),
  createCostVersion: permitted("catalog.write")
    .input(z.object({ productId: id, effectiveFrom: z.coerce.date(), note: z.string().trim().max(200).optional(), cost: costInput }))
    .mutation(({ ctx, input }) => repo.createCostVersion(ctx.ws, input)),
  delete: permitted("catalog.write").input(z.object({ id })).mutation(({ ctx, input }) => repo.deleteProduct(ctx.ws, input.id)),
});
