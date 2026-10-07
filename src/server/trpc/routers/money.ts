import { z } from "zod";
import { moneyFees, moneyOverview } from "@/server/reports/money";
import { permitted, router } from "@/server/trpc/init";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const moneyRouter = router({
  overview: permitted("money.read").query(({ ctx }) => moneyOverview(ctx.ws)),
  fees: permitted("money.read")
    .input(z.object({ from: day.optional(), to: day.optional() }).refine((v) => !v.from || !v.to || v.from <= v.to, "The start day must be before the end day"))
    .query(({ ctx, input }) => moneyFees(ctx.ws, input)),
});
