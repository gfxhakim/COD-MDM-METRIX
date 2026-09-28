import { z } from "zod";
import { MATRIX_COLUMNS, MATRIX_COLUMN_KEYS } from "@/domain/matrixColumns";
import { simulate, simulatorInputSchema } from "@/domain/simulator";
import { toCsv } from "@/lib/csv";
import { convertWithRates, minorToMajor } from "@/lib/money";
import { currencyCodeSchema, parseExchangeRates } from "@/domain/settings";
import { InputError } from "@/server/errors";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { creativeMatrix, dashboardReport, observedForSimulator, type CreativeRow } from "@/server/reports/economics";
import { NotFoundError } from "@/server/tenancy";
import { permitted, router, workspaceProcedure } from "@/server/trpc/init";
import { id } from "@/server/trpc/schemas";

const range = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() });
const revenueView = z.enum(["DELIVERED", "REMITTED"]).optional();

export const reportsRouter = router({
  dashboard: workspaceProcedure
    .input(range.extend({ productId: id.optional(), creativeId: id.optional(), revenueView }))
    .query(({ ctx, input }) => dashboardReport(ctx.ws, input)),
});

/** Money in the export follows the currency the page is shown in, with the workspace's rates. */
type ExportCurrency = { book: string; to: string; rates: Partial<Record<string, number>> };

function cellValue(row: CreativeRow, key: (typeof MATRIX_COLUMN_KEYS)[number], cur: ExportCurrency): unknown {
  const m = row.metrics;
  switch (key) {
    case "creative": return row.externalCreativeId ?? row.name;
    case "campaign": return row.campaignName;
    case "verdict": return row.verdict ?? "";
    default: {
      const col = MATRIX_COLUMNS.find((c) => c.key === key)!;
      const v = m[key as keyof typeof m] as number | null;
      if (v === null) return "";
      if (col.kind === "money") return minorToMajor(convertWithRates(v, cur.book, cur.to, cur.book, cur.rates) ?? v, cur.to);
      if (col.kind === "rate") return Math.round(v * 10000) / 10000;
      if (col.kind === "ratio") return Math.round(v * 100) / 100;
      return v;
    }
  }
}

export const creativesRouter = router({
  list: workspaceProcedure.query(({ ctx }) =>
    db.creative.findMany({ where: { workspaceId: ctx.ws.workspaceId }, orderBy: [{ name: "asc" }, { externalCreativeId: "asc" }], select: { id: true, externalCreativeId: true, name: true, productId: true, campaignName: true } }),
  ),
  matrix: workspaceProcedure.input(range.extend({ revenueView })).query(({ ctx, input }) => creativeMatrix(ctx.ws, input)),
  exportCsv: workspaceProcedure
    .input(range.extend({ revenueView, columns: z.array(z.enum(MATRIX_COLUMN_KEYS)).min(1), minSample: z.number().int().min(0).default(0), currency: currencyCodeSchema.optional() }))
    .mutation(async ({ ctx, input }) => {
      const report = await creativeMatrix(ctx.ws, input);
      const ws = await db.workspace.findUniqueOrThrow({ where: { id: ctx.ws.workspaceId }, select: { exchangeRates: true } });
      const cur: ExportCurrency = { book: report.currency, to: input.currency ?? report.currency, rates: parseExchangeRates(ws.exchangeRates) };
      if (convertWithRates(0, cur.book, cur.to, cur.book, cur.rates) === null) throw new InputError(`Add a ${cur.to} rate in Economics & currencies to export in ${cur.to}.`);
      const rows = report.rows.filter((r) => r.kind !== "CREATIVE" || r.metrics.placed >= input.minSample);
      const columns = input.columns.map((key) => {
        const col = MATRIX_COLUMNS.find((c) => c.key === key)!;
        return { header: col.kind === "money" ? `${col.label} (${cur.to})` : col.label, value: (r: CreativeRow) => cellValue(r, key, cur) };
      });
      await audit(ctx.ws, "report.exported", { type: "CreativeMatrix" }, { rows: rows.length, columns: input.columns.length });
      return { filename: `creative-matrix-${new Date().toISOString().slice(0, 10)}.csv`, content: toCsv(rows, columns) };
    }),
});

export const simulatorRouter = router({
  calculate: workspaceProcedure.input(simulatorInputSchema).query(({ input }) => simulate(input)),
  observed: workspaceProcedure.input(range.extend({ productId: id.optional() })).query(({ ctx, input }) => observedForSimulator(ctx.ws, input)),
  listScenarios: workspaceProcedure.input(z.object({ productId: id.optional() }).optional()).query(({ ctx, input }) =>
    db.simulatorScenario.findMany({
      where: { workspaceId: ctx.ws.workspaceId, ...(input?.productId ? { productId: input.productId } : {}) },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { product: { select: { name: true } } },
    }),
  ),
  saveScenario: permitted("settings.economics")
    .input(z.object({ name: z.string().trim().min(1).max(80), productId: id.nullish(), inputs: simulatorInputSchema }))
    .mutation(async ({ ctx, input }) => {
      if (input.productId) {
        const p = await db.product.findFirst({ where: { id: input.productId, workspaceId: ctx.ws.workspaceId }, select: { id: true } });
        if (!p) throw new NotFoundError("Product not found");
      }
      const s = await db.simulatorScenario.create({
        data: { workspaceId: ctx.ws.workspaceId, productId: input.productId ?? null, name: input.name, inputs: input.inputs, createdById: ctx.ws.userId },
      });
      await audit(ctx.ws, "simulator.scenario_saved", { type: "SimulatorScenario", id: s.id }, { name: s.name });
      return s;
    }),
  deleteScenario: permitted("settings.economics")
    .input(z.object({ id }))
    .mutation(async ({ ctx, input }) => {
      const s = await db.simulatorScenario.findFirst({ where: { id: input.id, workspaceId: ctx.ws.workspaceId } });
      if (!s) throw new NotFoundError("Scenario not found");
      await db.simulatorScenario.delete({ where: { id: s.id } });
      await audit(ctx.ws, "simulator.scenario_deleted", { type: "SimulatorScenario", id: s.id }, { name: s.name });
    }),
});
