import { FREQUENCY_LABEL } from "@/domain/recurring";
import { toDelimited } from "@/lib/csv";
import { categoryLabel } from "@/lib/labels";
import { currencyExponent } from "@/lib/money";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { buildXlsx, type XCell, type XColumn, type XSheet } from "@/server/exports/xlsx";
import { expenseSummary, listExpenses, listRecurring, type ExpenseListInput } from "@/server/repositories/expenses";
import type { WorkspaceContext } from "@/server/tenancy";

export type ExpenseExportInput = ExpenseListInput & { format: "xlsx" | "csv"; csvDelimiter: "," | ";" };

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

/**
 * The expenses the page shows, as Excel (three sheets) or CSV (three blocks): every one-off expense,
 * the repeating ones with their share of the days picked, and the totals by category.
 */
export async function exportExpenses(ctx: WorkspaceContext, input: ExpenseExportInput) {
  const [ws, items, recurring, summary] = await Promise.all([
    db.workspace.findUniqueOrThrow({ where: { id: ctx.workspaceId }, select: { currency: true } }),
    listExpenses(ctx, input),
    listRecurring(ctx, input),
    expenseSummary(ctx, input),
  ]);
  const cur = ws.currency;
  const major = (v: number | null) => (v === null ? null : v / 10 ** currencyExponent(cur));
  const majorIn = (v: number | null, c: string | null) => (v === null || !c ? null : v / 10 ** currencyExponent(c));
  const category = (r: { category: string; customCategory: { name: string } | null }) => r.customCategory?.name ?? categoryLabel(r.category);
  const scope = (r: { allocation: string; product: { name: string } | null }) => (r.allocation === "GLOBAL" ? "All products" : (r.product?.name ?? "Product"));
  const type = (t: string) => (t === "FIXED" ? "Fixed" : "Variable");

  const sheets: XSheet[] = [
    {
      name: "Expenses",
      columns: [
        { header: "Date", kind: "text" },
        { header: "Category", kind: "text" },
        { header: "Description", kind: "text" },
        { header: "For", kind: "text" },
        { header: "Type", kind: "text" },
        { header: `Amount (${cur})`, kind: "money" },
        { header: "Amount paid", kind: "money" },
        { header: "Paid in", kind: "text" },
      ] as XColumn[],
      rows: items.map((e) => [day(e.date), category(e), e.description ?? "", scope(e), type(e.costType), major(e.amount), majorIn(e.originalAmount, e.originalCurrency), e.originalCurrency ?? ""] as XCell[]),
    },
    {
      name: "Repeating",
      columns: [
        { header: "Name", kind: "text" },
        { header: "Category", kind: "text" },
        { header: "Repeats", kind: "text" },
        { header: `Amount each time (${cur})`, kind: "money" },
        { header: `Per month (${cur})`, kind: "money" },
        { header: `In these days (${cur})`, kind: "money" },
        { header: "First day", kind: "text" },
        { header: "Last day", kind: "text" },
        { header: "For", kind: "text" },
        { header: "Type", kind: "text" },
      ] as XColumn[],
      rows: recurring.map((r) => [r.name, category(r), FREQUENCY_LABEL[r.frequency], major(r.amount), major(r.perMonth), major(r.inPeriod), day(r.startDate), r.endDate ? day(r.endDate) : "Still running", scope(r), type(r.costType)] as XCell[]),
    },
    {
      name: "By category",
      columns: [
        { header: "Category", kind: "text" },
        { header: `Total (${cur})`, kind: "money" },
      ] as XColumn[],
      rows: [...summary.byCategory.map((c) => [c.name ?? categoryLabel(c.category), major(c.amount)] as XCell[]), ["Total", major(summary.total)]],
      totalsRow: true,
    },
  ];

  await audit(ctx, "report.exported", { type: "ExpensesExport" }, { format: input.format, expenses: items.length, repeating: recurring.length });

  const range = input.from && input.to ? (input.from === input.to ? input.from : `${input.from}_to_${input.to}`) : input.from ? `from_${input.from}` : input.to ? `until_${input.to}` : "all-dates";
  const filename = `expenses_${range}.${input.format}`;
  if (input.format === "xlsx") {
    return { filename, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", base64: buildXlsx(sheets).toString("base64"), rows: items.length + recurring.length };
  }
  const lines: (string | number | null | undefined)[][] = [];
  for (const [i, s] of sheets.entries()) {
    if (i > 0) lines.push([], [s.name]);
    lines.push(s.columns.map((c) => c.header), ...(s.rows as (string | number | null)[][]));
  }
  return { filename, mime: "text/csv;charset=utf-8", base64: Buffer.from(toDelimited(lines, input.csvDelimiter), "utf8").toString("base64"), rows: items.length + recurring.length };
}
