import { z } from "zod";
import { ExpenseFrequency } from "@prisma/client";
import { exportExpenses } from "@/server/exports/expenses";
import * as repo from "@/server/repositories/expenses";
import { permitted, router, workspaceProcedure } from "@/server/trpc/init";
import { costTypeEnum, expenseAllocationEnum, expenseCategoryEnum, expenseInput, fxRate, id, minor } from "@/server/trpc/schemas";
import { currencyCodeSchema } from "@/domain/settings";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const filters = z
  .object({
    category: expenseCategoryEnum.optional(),
    customCategoryId: id.optional(),
    allocation: expenseAllocationEnum.optional(),
    productId: id.optional(),
    costType: costTypeEnum.optional(),
    search: z.string().trim().max(100).optional(),
    from: day.optional(),
    to: day.optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, "The start day must be before the end day");

const recurringInput = z
  .object({
    name: z.string().trim().min(1, "Give it a name").max(120),
    category: expenseCategoryEnum,
    customCategoryId: id.nullish(),
    amount: minor.refine((v) => v > 0, "Amount must be greater than zero"),
    currency: currencyCodeSchema.optional(),
    fxRate: fxRate.nullish(),
    frequency: z.enum(ExpenseFrequency),
    startDate: z.coerce.date(),
    endDate: z.coerce.date().nullish(),
    allocation: expenseAllocationEnum,
    productId: id.nullish(),
    costType: costTypeEnum,
  })
  .refine((v) => v.allocation === "GLOBAL" || !!v.productId, { message: "Choose a product", path: ["productId"] })
  .refine((v) => !v.endDate || v.endDate >= v.startDate, { message: "The last day must be after the first day", path: ["endDate"] });

export const expensesRouter = router({
  list: workspaceProcedure.input(filters).query(({ ctx, input }) => repo.listExpenses(ctx.ws, input)),
  summary: workspaceProcedure.input(filters).query(({ ctx, input }) => repo.expenseSummary(ctx.ws, input)),
  create: permitted("expenses.write")
    .input(expenseInput.and(z.object({ customCategoryId: id.nullish() })))
    .mutation(({ ctx, input }) => repo.createExpense(ctx.ws, input)),
  update: permitted("expenses.write")
    .input(z.object({ id, data: expenseInput.and(z.object({ customCategoryId: id.nullish() })) }))
    .mutation(({ ctx, input }) => repo.updateExpense(ctx.ws, input.id, input.data)),
  delete: permitted("expenses.write").input(z.object({ id })).mutation(({ ctx, input }) => repo.deleteExpense(ctx.ws, input.id)),
  export: workspaceProcedure
    .input(filters.and(z.object({ format: z.enum(["xlsx", "csv"]), csvDelimiter: z.enum([",", ";"]).default(",") })))
    .mutation(({ ctx, input }) => exportExpenses(ctx.ws, input)),

  categories: workspaceProcedure.query(({ ctx }) => repo.listCategories(ctx.ws)),
  createCategory: permitted("expenses.write")
    .input(z.object({ name: z.string().trim().min(1, "Give it a name").max(60) }))
    .mutation(({ ctx, input }) => repo.createCategory(ctx.ws, input.name)),
  deleteCategory: permitted("expenses.write").input(z.object({ id })).mutation(({ ctx, input }) => repo.deleteCategory(ctx.ws, input.id)),

  recurring: workspaceProcedure.input(filters).query(({ ctx, input }) => repo.listRecurring(ctx.ws, input)),
  createRecurring: permitted("expenses.write").input(recurringInput).mutation(({ ctx, input }) => repo.createRecurring(ctx.ws, input)),
  updateRecurring: permitted("expenses.write")
    .input(z.object({ id, data: recurringInput }))
    .mutation(({ ctx, input }) => repo.updateRecurring(ctx.ws, input.id, input.data)),
  stopRecurring: permitted("expenses.write")
    .input(z.object({ id, today: day }))
    .mutation(({ ctx, input }) => repo.stopRecurring(ctx.ws, input.id, new Date(`${input.today}T12:00:00Z`))),
  deleteRecurring: permitted("expenses.write").input(z.object({ id })).mutation(({ ctx, input }) => repo.deleteRecurring(ctx.ws, input.id)),
});
