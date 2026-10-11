import { z } from "zod";
import { DATA_GROUPS, dataSummary, deleteData } from "@/server/dataControl";
import { permitted, router } from "@/server/trpc/init";

export const dataRouter = router({
  summary: permitted("data.delete").query(({ ctx }) => dataSummary(ctx.ws)),
  delete: permitted("data.delete")
    .input(z.object({ target: z.enum([...DATA_GROUPS, "everything"]), stopSyncs: z.boolean().default(false), confirm: z.literal("DELETE") }))
    .mutation(({ ctx, input }) => deleteData(ctx.ws, input)),
});
