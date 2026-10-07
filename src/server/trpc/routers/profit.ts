import { z } from "zod";
import { adFilterSchema } from "@/domain/adFilter";
import { profitPlanSchema } from "@/domain/profitTracker";
import { profitTracker, saveProfitPlan } from "@/server/reports/profit";
import { permitted, router } from "@/server/trpc/init";
import { id } from "@/server/trpc/schemas";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const profitRouter = router({
  tracker: permitted("money.read")
    .input(z.object({ from: day.optional(), to: day.optional(), ads: adFilterSchema.optional() }).refine((v) => !v.from || !v.to || v.from <= v.to, "The start day must be before the end day"))
    .query(({ ctx, input }) => profitTracker(ctx.ws, input)),
  savePlan: permitted("settings.economics")
    .input(z.object({ productId: id, plan: profitPlanSchema.nullable() }))
    .mutation(({ ctx, input }) => saveProfitPlan(ctx.ws, input)),
});
