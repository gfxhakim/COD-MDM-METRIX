import { z } from "zod";
import * as repo from "@/server/repositories/expenses";
import { permitted, router, workspaceProcedure } from "@/server/trpc/init";
import { expenseAllocationEnum, expenseCategoryEnum, expenseInput, id } from "@/server/trpc/schemas";

const filters = z.object({
  category: expenseCategoryEnum.optional(),
  allocation: expenseAllocationEnum.optional(),
  productId: id.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const expensesRouter = router({
  list: workspaceProcedure.input(filters).query(({ ctx, input }) => repo.listExpenses(ctx.ws, input)),
  summary: workspaceProcedure.input(filters).query(({ ctx, input }) => repo.expenseSummary(ctx.ws, input)),
  create: permitted("expenses.write").input(expenseInput).mutation(({ ctx, input }) => repo.createExpense(ctx.ws, input)),
  update: permitted("expenses.write")
    .input(z.object({ id, data: expenseInput }))
    .mutation(({ ctx, input }) => repo.updateExpense(ctx.ws, input.id, input.data)),
  delete: permitted("expenses.write").input(z.object({ id })).mutation(({ ctx, input }) => repo.deleteExpense(ctx.ws, input.id)),
});
