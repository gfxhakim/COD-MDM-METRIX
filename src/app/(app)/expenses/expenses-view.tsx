"use client";

import type { CostType, ExpenseAllocation } from "@prisma/client";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleStop, Download, Pencil, Plus, Receipt, Repeat, Search, Tags, Trash2 } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { useMoney } from "@/components/app/currency";
import { CurrencyAmountInput, OriginalAmount, parseCurrencyAmount, type CurrencyAmount, type Rates } from "@/components/app/currency-amount";
import { FitMoney } from "@/components/app/fit-money";
import { minorToInput } from "@/components/app/money-input";
import { PageHeader } from "@/components/app/page-header";
import { useCan } from "@/components/app/use-can";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Chip } from "@/components/ui/choice";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { EmptyState, ErrorState, Loading, Skeleton } from "@/components/ui/states";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { Term } from "@/components/ui/tooltip";
import { FREQUENCIES, FREQUENCY_LABEL, FREQUENCY_UNIT, monthlyEquivalent, type Frequency } from "@/domain/recurring";
import { RANGES, rangeDays, shortDay, todayIn, type RangeKey } from "@/lib/dateRanges";
import { download } from "@/lib/download";
import { categoryLabel, EXPENSE_CATEGORIES, type ExpenseCategoryKey } from "@/lib/labels";
import { parseToMinor } from "@/lib/money";
import { errorMessage, useTRPC } from "@/lib/trpc/client";
import { cn, formatDate, toDateInput } from "@/lib/utils";
import type { AppRouter } from "@/server/trpc/root";

type Out = inferRouterOutputs<AppRouter>["expenses"];
type ExpenseRow = Out["list"][number];
type RecurringRow = Out["recurring"][number];
type Category = Out["categories"][number];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1] ?? ""} ${m.slice(0, 4)}`;

/** A category picker value: a built-in key, or "custom:<id>" for one the business made. */
const categoryValue = (r: { category: string; customCategoryId: string | null }) => (r.customCategoryId ? `custom:${r.customCategoryId}` : r.category);
const categoryName = (r: { category: string; customCategory: { name: string } | null }) => r.customCategory?.name ?? categoryLabel(r.category);

function CategoryOptions({ categories }: { categories: Category[] }) {
  return (
    <>
      {EXPENSE_CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      {categories.length ? (
        <optgroup label="Your categories">
          {categories.map((c) => <option key={c.id} value={`custom:${c.id}`}>{c.name}</option>)}
        </optgroup>
      ) : null}
    </>
  );
}

// ─────────────────────────── New or edited expense ───────────────────────────

type Repeats = "ONCE" | Frequency;

function ExpenseDialog({ expense, recurring, initialRepeats, onClose, currency, rates, today }: { expense?: ExpenseRow; recurring?: RecurringRow; initialRepeats?: Repeats; onClose: () => void; currency: string; rates: Rates; today: string }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const money = useMoney();
  const products = useQuery(trpc.products.list.queryOptions({ includeInactive: true }));
  const categories = useQuery(trpc.expenses.categories.queryOptions());
  const row = expense ?? recurring;
  const [f, setF] = React.useState({
    repeats: (recurring?.frequency ?? initialRepeats ?? "ONCE") as Repeats,
    date: expense ? toDateInput(expense.date) : recurring ? toDateInput(recurring.startDate) : today,
    endDate: recurring?.endDate ? toDateInput(recurring.endDate) : "",
    name: recurring?.name ?? "",
    category: row ? categoryValue(row) : "SOFTWARE",
    amount: (row?.originalCurrency
      ? { amount: minorToInput(row.originalAmount, row.originalCurrency), currency: row.originalCurrency, rate: String(row.fxRate ?? "") }
      : { amount: minorToInput(row?.amount, currency), currency, rate: "" }) as CurrencyAmount,
    description: expense?.description ?? "",
    allocation: (row?.allocation ?? "GLOBAL") as ExpenseAllocation,
    productId: row?.productId ?? "",
    costType: (row?.costType ?? "FIXED") as CostType,
  });
  const [newCategory, setNewCategory] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const done = (msg: string) => { qc.invalidateQueries({ queryKey: trpc.expenses.pathKey() }); toast("success", msg); onClose(); };
  const onError = (e: unknown) => setError(errorMessage(e));
  const create = useMutation(trpc.expenses.create.mutationOptions({ onSuccess: () => done("Expense added"), onError }));
  const update = useMutation(trpc.expenses.update.mutationOptions({ onSuccess: () => done("Expense updated"), onError }));
  const createRec = useMutation(trpc.expenses.createRecurring.mutationOptions({ onSuccess: () => done("Repeating expense added"), onError }));
  const updateRec = useMutation(trpc.expenses.updateRecurring.mutationOptions({ onSuccess: () => done("Repeating expense updated"), onError }));
  const addCategory = useMutation(
    trpc.expenses.createCategory.mutationOptions({
      onSuccess: (c) => {
        qc.invalidateQueries({ queryKey: trpc.expenses.categories.queryKey() });
        setF((v) => ({ ...v, category: `custom:${c.id}` }));
        setNewCategory("");
      },
      onError,
    }),
  );
  const busy = create.isPending || update.isPending || createRec.isPending || updateRec.isPending;
  const repeating = f.repeats !== "ONCE";

  let perMonth: string | null = null;
  if (repeating && f.amount.amount) {
    try {
      perMonth = money.fmt(monthlyEquivalent({ amount: parseToMinor(f.amount.amount, f.amount.currency), frequency: f.repeats as Frequency }), f.amount.currency, { decimals: false });
    } catch {
      perMonth = null;
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (f.category === "__new") return setError("Add the new category first, or pick one.");
    try {
      const amount = parseCurrencyAmount(f.amount, currency);
      const custom = f.category.startsWith("custom:") ? f.category.slice(7) : null;
      const common = {
        category: (custom ? "OTHER" : f.category) as ExpenseCategoryKey,
        customCategoryId: custom,
        amount: amount.amount,
        currency: amount.currency,
        fxRate: amount.rate,
        allocation: f.allocation,
        productId: f.allocation === "PRODUCT" ? f.productId || null : null,
        costType: f.costType,
      };
      if (repeating) {
        const data = { ...common, name: f.name, frequency: f.repeats as Frequency, startDate: new Date(`${f.date}T12:00:00Z`), endDate: f.endDate ? new Date(`${f.endDate}T12:00:00Z`) : null };
        if (recurring) updateRec.mutate({ id: recurring.id, data });
        else createRec.mutate(data);
      } else {
        const data = { ...common, date: new Date(`${f.date}T12:00:00Z`), description: f.description || undefined };
        if (expense) update.mutate({ id: expense.id, data });
        else create.mutate(data);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const title = recurring ? "Edit repeating expense" : expense ? "Edit expense" : "New expense";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={title} description={!row ? "Once, or every day, week, month or year: rent, salaries and subscriptions count by themselves each day." : undefined}>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {!expense ? (
              <Field label="Repeats" htmlFor="erep" className="sm:col-span-2">
                <Select id="erep" value={f.repeats} onChange={(e) => setF({ ...f, repeats: e.target.value as Repeats })}>
                  {!recurring ? <option value="ONCE">Once</option> : null}
                  {FREQUENCIES.map((k) => <option key={k} value={k}>{FREQUENCY_LABEL[k]}</option>)}
                </Select>
              </Field>
            ) : null}
            {repeating ? (
              <Field label="Name" htmlFor="ename" className="sm:col-span-2">
                <Input id="ename" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Rent, confirmation agent, Shopify…" maxLength={120} required />
              </Field>
            ) : null}
            <Field label={repeating ? "First day" : "Date"} htmlFor="ed"><Input id="ed" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required /></Field>
            {repeating ? (
              <Field label="Last day" htmlFor="eend" hint="Leave empty while it goes on.">
                <Input id="eend" type="date" value={f.endDate} min={f.date} onChange={(e) => setF({ ...f, endDate: e.target.value })} />
              </Field>
            ) : null}
            <Field label={repeating ? `Amount each ${FREQUENCY_UNIT[f.repeats as Frequency]}` : "Amount"} htmlFor="ea" hint={perMonth ? `About ${perMonth} a month, spread over every day.` : undefined} className={repeating ? "sm:col-span-2" : undefined}>
              <CurrencyAmountInput id="ea" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} workspaceCurrency={currency} rates={rates} required />
            </Field>
            <Field label="Category" htmlFor="ec">
              <Select id="ec" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
                <CategoryOptions categories={categories.data ?? []} />
                <option value="__new">＋ New category…</option>
              </Select>
            </Field>
            <Field label="Type" htmlFor="et" hint="Fixed: the same each month. Variable: grows with orders.">
              <Select id="et" value={f.costType} onChange={(e) => setF({ ...f, costType: e.target.value as CostType })}><option value="FIXED">Fixed</option><option value="VARIABLE">Variable</option></Select>
            </Field>
            {f.category === "__new" ? (
              <div className="flex items-end gap-2 sm:col-span-2">
                <Field label="New category" htmlFor="ecat-new" className="flex-1">
                  <Input id="ecat-new" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="Influencers, Fuel, Photographer…" maxLength={60} autoFocus />
                </Field>
                <Button type="button" variant="secondary" disabled={!newCategory.trim() || addCategory.isPending} onClick={() => addCategory.mutate({ name: newCategory })}>Add</Button>
              </div>
            ) : null}
            <Field label="Counts for" htmlFor="eal">
              <Select id="eal" value={f.allocation} onChange={(e) => setF({ ...f, allocation: e.target.value as ExpenseAllocation })}><option value="GLOBAL">The whole business</option><option value="PRODUCT">One product</option></Select>
            </Field>
            {f.allocation === "PRODUCT" ? (
              <Field label="Product" htmlFor="ep">
                <Select id="ep" value={f.productId} onChange={(e) => setF({ ...f, productId: e.target.value })} required>
                  <option value="">Choose product…</option>
                  {products.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </Field>
            ) : null}
          </div>
          {!repeating ? <Field label="Description" htmlFor="edesc"><Textarea id="edesc" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field> : null}
          {error ? <p className="text-sm text-negative" role="alert">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={busy}>{row ? "Save" : repeating ? "Add repeating expense" : "Add expense"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────── The business's own categories ───────────────────────────

function CategoriesDialog({ onClose }: { onClose: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const categories = useQuery(trpc.expenses.categories.queryOptions());
  const [name, setName] = React.useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: trpc.expenses.pathKey() });
  const add = useMutation(trpc.expenses.createCategory.mutationOptions({ onSuccess: () => { refresh(); setName(""); }, onError: (e) => toast("error", errorMessage(e)) }));
  const del = useMutation(trpc.expenses.deleteCategory.mutationOptions({ onSuccess: () => { refresh(); toast("success", "Category deleted"); }, onError: (e) => toast("error", errorMessage(e)) }));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Your categories" description="Add the categories your business needs. Deleting one moves its expenses to Other.">
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) add.mutate({ name }); }}>
          <Field label="New category" htmlFor="cat-name" className="flex-1">
            <Input id="cat-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Influencers, Fuel, Photographer…" maxLength={60} />
          </Field>
          <Button type="submit" variant="primary" disabled={!name.trim() || add.isPending}><Plus /> Add</Button>
        </form>
        <ul className="mt-4 flex flex-col divide-y divide-border">
          {!categories.data ? <Skeleton className="h-16" /> : categories.data.length === 0 ? <li className="py-3 text-sm text-muted">None yet. The built-in ones are always there.</li> : categories.data.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 py-2.5">
              <span className="min-w-0 truncate text-sm font-semibold">{c.name}</span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="text-xs text-muted">{c.used === 1 ? "1 expense" : `${c.used} expenses`}</span>
                <Button size="icon" variant="ghost" aria-label={`Delete ${c.name}`} onClick={() => confirm(`Delete "${c.name}"? Its expenses move to Other.`) && del.mutate({ id: c.id })}><Trash2 /></Button>
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────── Export ───────────────────────────

type Filters = inferRouterInputs<AppRouter>["expenses"]["list"];
const FORMATS = [
  { key: "xlsx", label: "Excel", hint: "Three sheets: expenses, repeating, by category." },
  { key: "csv", label: "CSV", hint: "For English Excel and Google Sheets." },
  { key: "csv;", label: "CSV for French Excel", hint: "Uses ; between columns, as Excel in French expects." },
] as const;

function ExportDialog({ filters, onClose }: { filters: Filters; onClose: () => void }) {
  const trpc = useTRPC();
  const toast = useToast();
  const [format, setFormat] = React.useState<(typeof FORMATS)[number]["key"]>("xlsx");
  const run = useMutation(
    trpc.expenses.export.mutationOptions({
      onSuccess: (r) => { download(r.filename, r.mime, r.base64); toast("success", `Exported ${r.rows} expenses`); onClose(); },
      onError: (e) => toast("error", errorMessage(e)),
    }),
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Export expenses" description="Everything the page shows with your days and filters: each expense, the repeating ones with their share of those days, and the totals by category.">
        <div className="flex flex-wrap gap-2" role="group" aria-label="File type">
          {FORMATS.map((k) => <Chip key={k.key} active={format === k.key} onClick={() => setFormat(k.key)}>{k.label}</Chip>)}
        </div>
        <p className="mt-2 text-xs text-muted">{FORMATS.find((k) => k.key === format)?.hint}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={run.isPending}
            onClick={() => run.mutate({ ...filters, format: format === "xlsx" ? "xlsx" : "csv", csvDelimiter: format === "csv;" ? ";" : "," })}
          >
            <Download /> {run.isPending ? "Preparing…" : "Download"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────── Pieces of the page ───────────────────────────

/**
 * One bar per row, its length against the biggest. The amount and its share are written beside it,
 * so the bar is never the only way to read the number.
 */
function Bars({ rows, total, currency, empty }: { rows: { key: string; label: string; amount: number }[]; total: number; currency: string; empty: string }) {
  const money = useMoney();
  if (rows.length === 0) return <p className="px-5 pb-5 text-sm text-muted">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.amount), 1);
  return (
    <ul className="flex flex-col gap-3.5 px-5 pb-5">
      {rows.map((r, i) => (
        <li key={r.key} className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-semibold">{r.label}</span>
            <span className="num shrink-0 font-semibold">
              {money.fmt(r.amount, currency, { decimals: false })}
              <span className="ml-1.5 text-xs font-normal text-muted">{total > 0 ? `${Math.round((r.amount / total) * 100)}%` : ""}</span>
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-[#f1eeee]">
            <div className="bg-brand-bar animate-grow-x h-1.5 rounded-full shadow-[0_0_8px_rgb(255_45_66/0.45)] transition-[width] duration-700 ease-[var(--ease-out)]" style={{ width: `${(r.amount / max) * 100}%`, animationDelay: `${150 + i * 50}ms` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function RepeatingCard({ rows, currency, canWrite, today, onAdd, onEdit, periodLabel }: { rows: RecurringRow[] | undefined; currency: string; canWrite: boolean; today: string; onAdd: () => void; onEdit: (r: RecurringRow) => void; periodLabel: string }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const money = useMoney();
  const refresh = () => qc.invalidateQueries({ queryKey: trpc.expenses.pathKey() });
  const stop = useMutation(trpc.expenses.stopRecurring.mutationOptions({ onSuccess: () => { refresh(); toast("success", "Stopped. It no longer counts after today."); }, onError: (e) => toast("error", errorMessage(e)) }));
  const del = useMutation(trpc.expenses.deleteRecurring.mutationOptions({ onSuccess: () => { refresh(); toast("success", "Repeating expense deleted"); }, onError: (e) => toast("error", errorMessage(e)) }));
  return (
    <Card>
      <CardHeader
        title={<span className="inline-flex items-center gap-2"><Repeat className="size-4 text-brand-strong" /> Repeating expenses</span>}
        description="Rent, salaries, subscriptions: added once, they count a share every day."
        actions={canWrite ? <Button size="sm" variant="secondary" onClick={onAdd}><Plus /> Add repeating</Button> : null}
      />
      {!rows ? <Skeleton className="mx-5 mb-5 h-20" /> : rows.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-muted">None yet{canWrite ? ". Add rent or a salary once and it counts by itself every month." : "."}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border border-t border-border">
          {rows.map((r) => (
            <li key={r.id} className={cn("flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center", !r.running && "opacity-70")}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate font-bold">{r.name}</span>
                  <Badge tone={r.running ? "positive" : "neutral"}>{r.running ? (r.endDate ? `Until ${shortDay(toDateInput(r.endDate))}` : "Running") : r.endDate && toDateInput(r.endDate) < today ? "Stopped" : "Not started"}</Badge>
                  <Badge>{categoryName(r)}</Badge>
                  {r.allocation === "PRODUCT" ? <Badge tone="info">{r.product?.name ?? "Product"}</Badge> : null}
                </div>
                <p className="mt-1 text-xs text-muted">
                  {FREQUENCY_LABEL[r.frequency]} · <span className="num">{money.fmt(r.amount, r.currency)}</span>
                  <OriginalAmount amount={r.originalAmount} currency={r.originalCurrency} rate={r.fxRate} />
                  {" · "}from {shortDay(toDateInput(r.startDate))}{r.endDate ? ` to ${shortDay(toDateInput(r.endDate))}` : ""}
                </p>
              </div>
              <div className="flex items-center justify-between gap-3 sm:justify-end">
                <div className="text-left sm:text-right">
                  <p className="num text-[15px] font-extrabold">{money.fmt(r.inPeriod, currency, { decimals: false })}</p>
                  <p className="text-[11px] text-subtle">{periodLabel} · ≈ <span className="num">{money.fmt(r.perMonth, currency, { decimals: false })}</span>/month</p>
                </div>
                {canWrite ? (
                  <div className="flex gap-0.5">
                    <Button size="icon" variant="ghost" aria-label={`Edit ${r.name}`} onClick={() => onEdit(r)}><Pencil /></Button>
                    {r.running && (!r.endDate || toDateInput(r.endDate) > today) ? <Button size="icon" variant="ghost" aria-label={`Stop ${r.name}`} title="Stop after today" onClick={() => confirm(`Stop "${r.name}"? It counts until today and stops after. What it cost before stays.`) && stop.mutate({ id: r.id, today })}><CircleStop /></Button> : null}
                    <Button size="icon" variant="ghost" aria-label={`Delete ${r.name}`} onClick={() => confirm(`Delete "${r.name}" and everything it cost so far? To keep the past, stop it instead.`) && del.mutate({ id: r.id })}><Trash2 /></Button>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ─────────────────────────── Page ───────────────────────────

export function ExpensesView() {
  const money = useMoney();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const canWrite = useCan("expenses.write");
  const ws = useQuery(trpc.workspace.getCurrent.queryOptions());
  const products = useQuery(trpc.products.list.queryOptions({ includeInactive: true }));
  const categories = useQuery(trpc.expenses.categories.queryOptions());
  const currency = ws.data?.currency ?? "DZD";
  const rates: Rates = ws.data?.exchangeRates ?? {};
  const today = todayIn(ws.data?.timezone ?? "Africa/Algiers");

  const [range, setRange] = React.useState<RangeKey>("all");
  const [custom, setCustom] = React.useState({ from: "", to: "" });
  const [category, setCategory] = React.useState("");
  const [scope, setScope] = React.useState("");
  const [type, setType] = React.useState("");
  const [search, setSearch] = React.useState("");
  const words = React.useDeferredValue(search.trim());
  const days = rangeDays(range, today, custom);
  const bad = !!days.from && !!days.to && days.from > days.to;
  const filters: Filters = {
    ...days,
    category: category && !category.startsWith("custom:") ? (category as ExpenseCategoryKey) : undefined,
    customCategoryId: category.startsWith("custom:") ? category.slice(7) : undefined,
    allocation: scope === "GLOBAL" ? "GLOBAL" : scope ? "PRODUCT" : undefined,
    productId: scope.startsWith("p:") ? scope.slice(2) : undefined,
    costType: (type || undefined) as CostType | undefined,
    search: words || undefined,
  };
  const filtered = !!(category || scope || type || words);
  const list = useQuery({ ...trpc.expenses.list.queryOptions(filters), enabled: !bad, placeholderData: keepPreviousData });
  const summary = useQuery({ ...trpc.expenses.summary.queryOptions(filters), enabled: !bad, placeholderData: keepPreviousData });
  const recurring = useQuery({ ...trpc.expenses.recurring.queryOptions(filters), enabled: !bad, placeholderData: keepPreviousData });
  const [dialog, setDialog] = React.useState<null | { kind: "new"; repeats?: boolean } | { kind: "expense"; row: ExpenseRow } | { kind: "recurring"; row: RecurringRow } | { kind: "categories" } | { kind: "export" }>(null);
  const del = useMutation(trpc.expenses.delete.mutationOptions({ onSuccess: () => { qc.invalidateQueries({ queryKey: trpc.expenses.pathKey() }); toast("success", "Expense deleted"); }, onError: (e) => toast("error", errorMessage(e)) }));
  const s = summary.data;
  const periodLabel = range === "all" ? "So far" : range === "custom" ? "These days" : (RANGES.find((r) => r.key === range)?.label ?? "");
  const running = recurring.data?.filter((r) => r.running).length ?? 0;
  const clear = () => { setCategory(""); setScope(""); setType(""); setSearch(""); };

  return (
    <>
      <PageHeader
        title="Expenses"
        description="Every cost of the business, once or repeating. Expenses for the whole business are shared across products in profit, by the rule in Settings → Economics."
        actions={
          <>
            <Button variant="secondary" onClick={() => setDialog({ kind: "export" })} className="flex-1 sm:flex-none"><Download /> Export</Button>
            {canWrite ? <Button variant="secondary" onClick={() => setDialog({ kind: "categories" })} className="flex-1 sm:flex-none"><Tags /> Categories</Button> : null}
            {canWrite ? <Button variant="primary" onClick={() => setDialog({ kind: "new" })} className="w-full sm:w-auto"><Plus /> New expense</Button> : null}
          </>
        }
      />

      <div className="mb-4 flex flex-col gap-2">
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="group" aria-label="Days">
          {RANGES.map((r) => <Chip key={r.key} active={range === r.key} onClick={() => setRange(r.key)} className="shrink-0">{r.label}</Chip>)}
        </div>
        {range === "custom" ? (
          <div className="grid grid-cols-2 gap-2 sm:max-w-sm">
            <Input type="date" aria-label="From" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
            <Input type="date" aria-label="To" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
          </div>
        ) : null}
        {bad ? <p className="text-sm text-negative">The start day must be before the end day.</p> : null}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <div className="relative col-span-2 sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
          <Input aria-label="Search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search a description or name" className="pl-9" />
        </div>
        <Select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} className="col-span-2 w-full sm:w-48">
          <option value="">All categories</option>
          <CategoryOptions categories={categories.data ?? []} />
        </Select>
        <Select aria-label="Counts for" value={scope} onChange={(e) => setScope(e.target.value)} className="w-full sm:w-48">
          <option value="">Business and products</option>
          <option value="GLOBAL">The whole business</option>
          <option value="PRODUCT">Any product</option>
          {products.data?.length ? <optgroup label="One product">{products.data.map((p) => <option key={p.id} value={`p:${p.id}`}>{p.name}</option>)}</optgroup> : null}
        </Select>
        <Select aria-label="Type" value={type} onChange={(e) => setType(e.target.value)} className="w-full sm:w-36">
          <option value="">Fixed and variable</option><option value="FIXED">Fixed</option><option value="VARIABLE">Variable</option>
        </Select>
        {filtered ? <Button variant="ghost" size="sm" onClick={clear} className="col-span-2 sm:col-span-1">Clear filters</Button> : null}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <section className="relative col-span-2 flex min-w-0 flex-col gap-3 overflow-hidden rounded-[22px] bg-brand-hero p-5 text-white shine shadow-[0_16px_34px_rgb(204_19_37/0.35),inset_0_1px_0_rgb(255_255_255/0.35)] xl:col-span-1">
          <span className="pointer-events-none absolute -right-12 -top-16 size-44 rounded-full border-[20px] border-white/10" aria-hidden="true" />
          <span className="relative text-[15px] font-semibold">Expenses · {periodLabel.toLowerCase()}</span>
          <div className="relative min-w-0">{s ? <FitMoney value={s.total} currency={currency} max={34} codeClassName="text-white/85" className="[text-shadow:0_2px_14px_rgb(255_170_178/0.55)]" /> : <Skeleton className="h-9 w-40 bg-white/25" />}</div>
          <span className="relative text-xs text-white/85">{s ? <>{money.fmt(s.total - s.repeating, currency, { decimals: false })} once · {money.fmt(s.repeating, currency, { decimals: false })} repeating</> : " "}</span>
        </section>
        <Card className="flex min-w-0 flex-col gap-1.5 p-4">
          <p className="text-xs text-muted"><Term label="Repeating, each month" definition="What the repeating expenses still running cost in an average month: a daily one × 365 ÷ 12, a weekly one × 52 ÷ 12, a yearly one ÷ 12." /></p>
          {s ? <FitMoney value={s.repeatingPerMonth} currency={currency} max={26} /> : <Skeleton className="h-7 w-28" />}
          <p className="text-[11px] text-subtle">{running === 1 ? "1 running" : `${running} running`}</p>
        </Card>
        <Card className="flex min-w-0 flex-col gap-1.5 p-4">
          <p className="text-xs text-muted"><Term label="For the whole business" definition="Expenses not tied to one product. Profit shares them across products by the rule in Settings → Economics (by default, across delivered orders)." /></p>
          {s ? <FitMoney value={s.unallocated} currency={currency} max={26} className="text-warning" /> : <Skeleton className="h-7 w-28" />}
          <p className="text-[11px] text-subtle">{s ? <>{money.fmt(s.total - s.unallocated, currency, { decimals: false })} for products</> : " "}</p>
        </Card>
        <Card className="col-span-2 flex min-w-0 flex-col gap-1.5 p-4 sm:col-span-1">
          <p className="text-xs text-muted"><Term label="Bank rows to review" definition="Imported bank rows don't count in profit until you give them a category or leave them out." /></p>
          <p className="num text-2xl font-extrabold">{s?.pendingBankRows ?? "–"}</p>
          <Link href="/imports?tab=bank" className="text-xs font-semibold text-brand-strong hover:underline">Review bank rows</Link>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <RepeatingCard rows={recurring.data} currency={currency} canWrite={canWrite} today={today} periodLabel={periodLabel} onAdd={() => setDialog({ kind: "new", repeats: true })} onEdit={(row) => setDialog({ kind: "recurring", row })} />

          <Card className="min-w-0">
            <CardHeader title="One-off expenses" description={list.data && list.data.length >= 500 ? "The latest 500. Pick fewer days to see the rest, or export." : undefined} />
            {list.error ? <ErrorState message={errorMessage(list.error)} /> : !list.data ? <Loading /> : !list.data.length ? (
              filtered || range !== "all" ? (
                <EmptyState icon={<Receipt />} title="Nothing matches" description="No one-off expense in these days with these filters." action={filtered ? <Button variant="secondary" onClick={clear}>Clear filters</Button> : undefined} />
              ) : (
                <EmptyState icon={<Receipt />} title="No expenses" description="Add software, call-center, packaging and other costs so profit reflects the whole business." />
              )
            ) : (
              <Table>
                <THead><tr><Th>Date</Th><Th>Category</Th><Th>Description</Th><Th>For</Th><Th>Type</Th><Th className="text-right">Amount</Th><Th><span className="sr-only">Actions</span></Th></tr></THead>
                <tbody>
                  {list.data.map((e) => (
                    <Tr key={e.id}>
                      <Td className="whitespace-nowrap text-xs text-muted">{formatDate(e.date)}</Td>
                      <Td className="whitespace-nowrap">{categoryName(e)}</Td>
                      <Td className="max-w-64 truncate text-muted">{e.description ?? "—"}</Td>
                      <Td>{e.allocation === "GLOBAL" ? <Badge tone="warning">Whole business</Badge> : <Badge tone="info">{e.product?.name ?? "Product"}</Badge>}</Td>
                      <Td className="text-xs text-muted">{e.costType === "FIXED" ? "Fixed" : "Variable"}</Td>
                      <Td className="num whitespace-nowrap text-right">{money.fmt(e.amount, e.currency)}<OriginalAmount amount={e.originalAmount} currency={e.originalCurrency} rate={e.fxRate} /></Td>
                      <Td>
                        {canWrite ? (
                          <div className="flex justify-end gap-1">
                            <Button size="icon" variant="ghost" aria-label="Edit expense" onClick={() => setDialog({ kind: "expense", row: e })}><Pencil /></Button>
                            <Button size="icon" variant="ghost" aria-label="Delete expense" onClick={() => confirm("Delete this expense?") && del.mutate({ id: e.id })}><Trash2 /></Button>
                          </div>
                        ) : null}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader title="By category" description="One-off and repeating together." />
            {!s ? <Skeleton className="mx-5 mb-5 h-32" /> : <Bars rows={s.byCategory.map((c) => ({ key: c.category, label: c.name ?? categoryLabel(c.category), amount: c.amount }))} total={s.total} currency={currency} empty="No expenses in these days." />}
          </Card>
          {s && s.byProduct.length ? (
            <Card>
              <CardHeader title="By product" description="Expenses tied to one product." />
              <Bars rows={s.byProduct.map((p) => ({ key: p.productId, label: p.name, amount: p.amount }))} total={s.total - s.unallocated} currency={currency} empty="" />
            </Card>
          ) : null}
          <Card>
            <CardHeader title="Each month" />
            <CardBody className="p-0">
              {!s ? <Skeleton className="m-4 h-32" /> : s.months.length === 0 ? <p className="px-5 pb-5 text-sm text-muted">No expenses in these days.</p> : (
                <Table>
                  <THead><tr><Th>Month</Th><Th className="text-right">Repeating</Th><Th className="text-right">Total</Th></tr></THead>
                  <tbody>
                    {s.months.map((m) => (
                      <Tr key={m.month}>
                        <Td className="whitespace-nowrap text-xs">{monthLabel(m.month)}</Td>
                        <Td className="num whitespace-nowrap text-right text-muted">{money.fmt(m.repeating, currency, { decimals: false })}</Td>
                        <Td className="num whitespace-nowrap text-right font-semibold">{money.fmt(m.total, currency, { decimals: false })}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      {dialog?.kind === "new" ? <ExpenseDialog initialRepeats={dialog.repeats ? "MONTHLY" : "ONCE"} onClose={() => setDialog(null)} currency={currency} rates={rates} today={today} /> : null}
      {dialog?.kind === "expense" ? <ExpenseDialog expense={dialog.row} onClose={() => setDialog(null)} currency={currency} rates={rates} today={today} /> : null}
      {dialog?.kind === "recurring" ? <ExpenseDialog recurring={dialog.row} onClose={() => setDialog(null)} currency={currency} rates={rates} today={today} /> : null}
      {dialog?.kind === "categories" ? <CategoriesDialog onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "export" ? <ExportDialog filters={filters} onClose={() => setDialog(null)} /> : null}
    </>
  );
}
