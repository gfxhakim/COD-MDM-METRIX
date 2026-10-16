import { z } from "zod";
import { adFilterSchema } from "@/domain/adFilter";
import { EXPORT_COLUMN_KEYS, EXPORT_FORMATS } from "@/domain/orderExport";
import { exportOrders, orderExportPreview } from "@/server/exports/orders";
import { dayRange } from "@/lib/zonedDays";
import { db } from "@/server/db";
import * as repo from "@/server/repositories/orders";
import { permitted, router, workspaceProcedure } from "@/server/trpc/init";
import { id, minor, normalizedStatusEnum, optionalText, orderSourceEnum, orderStatusEnum } from "@/server/trpc/schemas";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date");

const exportFilters = z.object({
  from: day.optional(),
  to: day.optional(),
  dateField: z.enum(["placed", "status"]).default("placed"),
  scope: z.enum(["mdm", "all"]).default("mdm"),
  search: z.string().trim().max(80).optional(),
  wilaya: z.string().max(80).optional(),
  productId: id.optional(),
  creativeId: id.optional(),
  source: orderSourceEnum.optional(),
  upsell: z.boolean().optional(),
  ads: adFilterSchema.optional(),
});

export const ordersRouter = router({
  list: workspaceProcedure
    .input(
      z.object({
        search: z.string().trim().max(80).optional(),
        status: orderStatusEnum.optional(),
        parcelStatus: normalizedStatusEnum.optional(),
        wilaya: z.string().max(80).optional(),
        productId: id.optional(),
        creativeId: id.optional(),
        source: orderSourceEnum.optional(),
        upsell: z.boolean().optional(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        /** Days the orders were placed, in the workspace's time zone, as the Profit tracker counts them. */
        fromDay: day.optional(),
        toDay: day.optional(),
        /** Only the orders reports count: not archived by MDM. */
        counted: z.boolean().optional(),
        ads: adFilterSchema.optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(10).max(100).default(25),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { fromDay, toDay, ...rest } = input;
      if (!fromDay && !toDay) return repo.listOrders(ctx.ws, rest);
      const ws = await db.workspace.findUniqueOrThrow({ where: { id: ctx.ws.workspaceId }, select: { timezone: true } });
      const days = dayRange({ from: fromDay, to: toDay }, ws.timezone);
      return repo.listOrders(ctx.ws, { ...rest, from: days.from ?? rest.from, to: days.to ?? rest.to });
    }),
  facets: workspaceProcedure.query(({ ctx }) => repo.listOrderFacets(ctx.ws)),
  exportPreview: workspaceProcedure.input(exportFilters).query(({ ctx, input }) => orderExportPreview(ctx.ws, input)),
  export: workspaceProcedure
    .input(
      exportFilters.extend({
        statuses: z.array(z.string().trim().min(1).max(64)).max(200).optional(),
        format: z.enum(EXPORT_FORMATS),
        csvDelimiter: z.enum([",", ";"]).default(","),
        layout: z.enum(["orders", "lines"]).default("orders"),
        columns: z.array(z.enum(EXPORT_COLUMN_KEYS)).min(1).max(EXPORT_COLUMN_KEYS.length),
        currency: z.string().regex(/^[A-Z]{3}$/).optional(),
        totals: z.boolean().default(true),
      }),
    )
    .mutation(({ ctx, input }) => exportOrders(ctx.ws, input)),
  getDetails: workspaceProcedure.input(z.object({ id })).query(({ ctx, input }) => repo.getOrderDetails(ctx.ws, input.id)),
  create: permitted("orders.write")
    .input(
      z.object({
        orderNumber: z.string().trim().min(1).max(64),
        placedAt: z.coerce.date(),
        status: orderStatusEnum,
        wilaya: optionalText(80),
        city: optionalText(80),
        phone: z.string().trim().max(30).optional(),
        codAmount: minor,
        utmSource: optionalText(),
        utmMedium: optionalText(),
        utmCampaign: optionalText(),
        utmContent: optionalText(),
        notes: optionalText(1000),
        lines: z.array(z.object({ productId: id, quantity: z.number().int().min(1).max(1000), unitPrice: minor })).min(1).max(20),
      }),
    )
    .mutation(({ ctx, input }) => repo.createManualOrder(ctx.ws, input)),
  updateStatus: permitted("orders.write")
    .input(z.object({ id, status: orderStatusEnum }))
    .mutation(({ ctx, input }) => repo.updateOrderStatus(ctx.ws, input)),
  delete: permitted("orders.write").input(z.object({ id })).mutation(({ ctx, input }) => repo.deleteOrder(ctx.ws, input.id)),
  manualMatchParcel: permitted("orders.match")
    .input(z.object({ orderId: id, trackingId: z.string().trim().min(3).max(64) }))
    .mutation(({ ctx, input }) => repo.manualMatchParcel(ctx.ws, input)),
  unlinkParcel: permitted("orders.match")
    .input(z.object({ parcelId: id }))
    .mutation(({ ctx, input }) => repo.unlinkParcel(ctx.ws, input.parcelId)),
});
