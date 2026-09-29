import { z } from "zod";
import * as repo from "@/server/repositories/campaigns";
import { campaignReport, NO_ACCOUNT } from "@/server/reports/campaigns";
import { permitted, router, workspaceProcedure } from "@/server/trpc/init";
import { id } from "@/server/trpc/schemas";

const range = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() });
const adAccountFilter = z.union([z.string().regex(/^act_\d{1,30}$/), z.literal(NO_ACCOUNT)]);

export const campaignsRouter = router({
  report: workspaceProcedure
    .input(range.extend({ adAccountId: adAccountFilter.optional(), revenueView: z.enum(["DELIVERED", "REMITTED"]).optional() }))
    .query(({ ctx, input }) => campaignReport(ctx.ws, input)),
  links: workspaceProcedure.query(({ ctx }) => repo.listAdLinks(ctx.ws)),
  setProduct: permitted("catalog.write")
    .input(z.object({ id, productId: id.nullable() }))
    .mutation(({ ctx, input }) => repo.setCampaignProduct(ctx.ws, input)),
  setAccountProduct: permitted("catalog.write")
    .input(z.object({ id, productId: id.nullable() }))
    .mutation(({ ctx, input }) => repo.setAdAccountProduct(ctx.ws, input)),
  setProductLinks: permitted("catalog.write")
    .input(z.object({ productId: id, campaignIds: z.array(id).max(5000), adAccountIds: z.array(id).max(500) }))
    .mutation(({ ctx, input }) => repo.setProductLinks(ctx.ws, input)),
});
