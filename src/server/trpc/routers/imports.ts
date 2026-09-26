import { z } from "zod";
import { BankReviewStatus, ImportKind } from "@prisma/client";
import { MAX_IMPORT_BYTES } from "@/domain/imports/csv";
import { rateLimit } from "@/server/rateLimit";
import * as svc from "@/server/imports/service";
import * as review from "@/server/imports/review";
import { permitted, router, workspaceProcedure } from "@/server/trpc/init";
import { costTypeEnum, expenseAllocationEnum, expenseCategoryEnum, id } from "@/server/trpc/schemas";

const kind = z.enum(ImportKind);
const request = z.object({
  kind,
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((n) => /\.(csv|txt|tsv)$/i.test(n), "Upload a .csv file"),
  // Characters, not bytes; the byte limit is re-checked by the parser.
  csvText: z.string().min(1).max(MAX_IMPORT_BYTES),
  mapping: z.record(z.string(), z.string().max(200).nullable()),
  options: z.object({
    dateFormat: z.enum(["AUTO", "ISO", "DMY", "MDY"]).default("AUTO"),
    source: z.enum(["SHOPIFY", "EASYSELL", "OTHER"]).optional(),
    fxRate: z.number().positive().max(1_000_000).nullish(),
    createCreatives: z.boolean().optional(),
    productId: id.nullish(),
  }),
});

export const importsRouter = router({
  preview: permitted("imports.write")
    .input(request)
    .mutation(async ({ ctx, input }) => {
      await rateLimit(`import-preview:${ctx.ws.userId}`, 60, 60);
      return svc.previewImport(ctx.ws, input);
    }),
  commit: permitted("imports.write")
    .input(request.extend({ fileSize: z.number().int().min(1).max(MAX_IMPORT_BYTES) }))
    .mutation(async ({ ctx, input }) => {
      await rateLimit(`import-commit:${ctx.ws.workspaceId}`, 30, 600);
      return svc.commitImport(ctx.ws, input);
    }),
  list: workspaceProcedure.input(z.object({ kind: kind.optional(), limit: z.number().int().min(1).max(100).default(50) })).query(({ ctx, input }) => svc.listBatches(ctx.ws, input)),
  get: workspaceProcedure.input(z.object({ id })).query(({ ctx, input }) => svc.getBatch(ctx.ws, input.id)),
  errorCsv: workspaceProcedure.input(z.object({ id })).mutation(({ ctx, input }) => svc.errorCsv(ctx.ws, input.id)),
  delete: permitted("imports.write").input(z.object({ id })).mutation(({ ctx, input }) => svc.deleteBatch(ctx.ws, input.id)),
  lastMapping: workspaceProcedure.input(z.object({ kind })).query(({ ctx, input }) => svc.lastMapping(ctx.ws, input.kind)),
});

export const bankRouter = router({
  list: workspaceProcedure
    .input(z.object({ status: z.enum(BankReviewStatus).optional(), limit: z.number().int().min(1).max(200).default(50), cursor: id.nullish() }))
    .query(({ ctx, input }) => review.listBank(ctx.ws, input)),
  categorize: permitted("expenses.write")
    .input(z.object({ id, category: expenseCategoryEnum, allocation: expenseAllocationEnum, productId: id.nullish(), costType: costTypeEnum, description: z.string().trim().max(500).optional() }))
    .mutation(({ ctx, input }) => review.categorizeBank(ctx.ws, input)),
  exclude: permitted("expenses.write").input(z.object({ ids: z.array(id).min(1).max(500) })).mutation(({ ctx, input }) => review.excludeBank(ctx.ws, input.ids)),
  reopen: permitted("expenses.write").input(z.object({ id })).mutation(({ ctx, input }) => review.reopenBank(ctx.ws, input.id)),
});

export const spendReviewRouter = router({
  unmatched: workspaceProcedure.query(({ ctx }) => review.unmatchedSpend(ctx.ws)),
  resolve: permitted("catalog.write")
    .input(
      z
        .object({
          externalCreativeId: z.string().trim().min(1).max(200),
          creativeId: id.nullish(),
          create: z.object({ name: z.string().trim().max(200).optional(), productId: id.nullish() }).nullish(),
        })
        .refine((v) => !!v.creativeId !== !!v.create, "Pick a creative or create one"),
    )
    .mutation(({ ctx, input }) => review.resolveUnmatchedSpend(ctx.ws, input)),
  setCreativeProduct: permitted("catalog.write")
    .input(z.object({ id, productId: id.nullable(), name: z.string().trim().max(200).optional() }))
    .mutation(({ ctx, input }) => review.setCreativeProduct(ctx.ws, input)),
});
