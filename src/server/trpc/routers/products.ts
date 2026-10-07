import { z } from "zod";
import * as repo from "@/server/repositories/products";
import { setProductLinks } from "@/server/repositories/campaigns";
import { permitted, router, workspaceProcedure } from "@/server/trpc/init";
import { costInput, id } from "@/server/trpc/schemas";

/** Ad accounts and campaigns whose spend counts for the product; replaces the product's current links. */
const links = z.object({ campaignIds: z.array(id).max(5000), adAccountIds: z.array(id).max(500) }).optional();
const sku = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._\-]+$/, "Use letters, digits, dot, dash or underscore");

export const productsRouter = router({
  list: workspaceProcedure
    .input(z.object({ includeInactive: z.boolean().default(true) }).default({ includeInactive: true }))
    .query(({ ctx, input }) => repo.listProducts(ctx.ws, input)),
  get: workspaceProcedure.input(z.object({ id })).query(({ ctx, input }) => repo.getProduct(ctx.ws, input.id)),
  create: permitted("catalog.write")
    .input(z.object({ name: z.string().trim().min(1).max(120), sku, active: z.boolean().default(true), cost: costInput, links }))
    .mutation(async ({ ctx, input }) => {
      const p = await repo.createProduct(ctx.ws, input);
      if (input.links) await setProductLinks(ctx.ws, { productId: p.id, ...input.links });
      return p;
    }),
  update: permitted("catalog.write")
    .input(z.object({ id, name: z.string().trim().min(1).max(120).optional(), sku: sku.optional(), active: z.boolean().optional(), links }))
    .mutation(async ({ ctx, input }) => {
      const p = await repo.updateProduct(ctx.ws, input);
      if (input.links) await setProductLinks(ctx.ws, { productId: input.id, ...input.links });
      return p;
    }),
  createCostVersion: permitted("catalog.write")
    .input(z.object({ productId: id, effectiveFrom: z.coerce.date(), note: z.string().trim().max(200).optional(), cost: costInput }))
    .mutation(({ ctx, input }) => repo.createCostVersion(ctx.ws, input)),
  delete: permitted("catalog.write").input(z.object({ id })).mutation(({ ctx, input }) => repo.deleteProduct(ctx.ws, input.id)),
  mdmProducts: workspaceProcedure.query(({ ctx }) => repo.listMdmProducts(ctx.ws)),
  moveMdmProduct: permitted("catalog.write")
    .input(z.object({ mdmProductId: z.string().trim().min(1).max(100), productId: id }))
    .mutation(({ ctx, input }) => repo.moveMdmProduct(ctx.ws, input)),
});
