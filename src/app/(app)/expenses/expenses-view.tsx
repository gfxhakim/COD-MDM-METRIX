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
import { MoreDetails, MoreDetailsButton, useMoreDetails } from "@/components/app/more-details";
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
import { useT } from "@/i18n/client";
import { msg, type TFunction } from "@/i18n/core";
import { RANGES, rangeDays, shortDay, todayIn, type RangeKey } from "@/lib/dateRanges";
import { download } from "@/lib/download";
import { categoryLabel, EXPENSE_CATEGORIES, type ExpenseCategoryKey } from "@/lib/labels";
import { currencyExponent, parseToMinor } from "@/lib/money";
import { errorMessage, useTRPC } from "@/lib/trpc/client";
import { cn, toDateInput } from "@/lib/utils";
import type { AppRouter } from "@/server/trpc/root";

type Out = inferRouterOutputs<AppRouter>["expenses"];
type ExpenseRow = Out["list"][number];
type RecurringRow = Out["recurring"][number];
type Category = Out["categories"][number];

const MONTHS = [msg("Jan"), msg("Feb"), msg("Mar"), msg("Apr"), msg("May"), msg("Jun"), msg("Jul"), msg("Aug"), msg("Sep"), msg("Oct"), msg("Nov"), msg("Dec")];
const monthLabel = (m: string, t: TFunction) => `${t(MONTHS[Number(m.slice(5, 7)) - 1] ?? "")} ${m.slice(0, 4)}`;

/** A category picker value: a built-in key, or "custom:<id>" for one the business made. */
const categoryValue = (r: { category: string; customCategoryId: string | null }) => (r.customCategoryId ? `custom:${r.customCategoryId}` : r.category);
const categoryName = (r: { category: string; customCategory: { name: string } | null }, t: TFunction) => r.customCategory?.name ?? t(categoryLabel(r.category));
/** Whole units for the big numbers: cents only clutter a total. */
const whole = (minor: number, currency: string) => Math.round(minor / 10 ** currencyExponent(currency)) * 10 ** currencyExponent(currency);

function CategoryOptions({ categories }: { categories: Category[] }) {
  const { t } = useT();
  return (
    <>
      {EXPENSE_CATEGORIES.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
      {categories.length ? (
        <optgroup label={t("Your categories")}>
          {categories.map((c) => <option key={c.id} value={`custom:${c.id}`}>{c.name}</option>)}
        </optgroup>
      ) : null}
    </>
  );
}

// ─────────────────────────── New or edited expense ───────────────────────────

type Repeats = "ONCE" | Frequency;

/** Quick starts for a new expense: pay is the expense people most often forget to enter. */
const KINDS = [
  { key: "OWNER_PAY", label: msg("My pay"), name: msg("My pay") },
  { key: "SALARIES", label: msg("Employee pay"), name: "" },
  { key: "OTHER_COST", label: msg("Something else"), name: "" },
] as const;
type Kind = (typeof KINDS)[number]["key"];
const kindOf = (category: string): Kind => (category === "OWNER_PAY" || category === "SALARIES" ? category : "OTHER_COST");

function ExpenseDialog({ expense, recurring, initialRepeats, onClose, currency, rates, today }: { expense?: ExpenseRow; recurring?: RecurringRow; initialRepeats?: Repeats; onClose: () => void; currency: string; rates: Rates; today: string }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const money = useMoney();
  const { t } = useT();
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
  const done = (text: string) => { qc.invalidateQueries({ queryKey: trpc.expenses.pathKey() }); toast("success", text); onClose(); };
  const onError = (e: unknown) => setError(errorMessage(e));
  const create = useMutation(trpc.expenses.create.mutationOptions({ onSuccess: () => done(t("Expense added")), onError }));
  const update = useMutation(trpc.expenses.update.mutationOptions({ onSuccess: () => done(t("Expense updated")), onError }));
  const createRec = useMutation(trpc.expenses.createRecurring.mutationOptions({ onSuccess: () => done(t("Repeating expense added")), onError }));
  const updateRec = useMutation(trpc.expenses.updateRecurring.mutationOptions({ onSuccess: () => done(t("Repeating expense updated")), onError }));
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
  const kind = kindOf(f.category);
  const pay = kind !== "OTHER_COST";
  // Pay is usually the same each month: picking it sets the expense to repeat monthly for the whole business.
  const pickKind = (k: Kind) => {
    if (k === kind) return;
    const preset = KINDS.find((x) => x.key === k)!;
    const oldName = t(KINDS.find((x) => x.key === kind)!.name);
    const name = !f.name || f.name === oldName ? t(preset.name) : f.name;
    if (k === "OTHER_COST") setF({ ...f, category: "SOFTWARE", name });
    else setF({ ...f, category: k, name, repeats: f.repeats === "ONCE" ? "MONTHLY" : f.repeats, costType: "FIXED", allocation: "GLOBAL", productId: "" });
  };

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
    if (f.category === "__new") return setError(t("Add the new category first, or pick one."));
    try {
      const amount = parseCurrencyAmount(f.amount, currency, undefined, t);
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

  const title = recurring ? t("Edit repeating expense") : expense ? t("Edit expense") : t("New expense");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={title} description={!row ? t("Once, or every day, week, month or year: rent, pay and subscriptions count by themselves each day.") : undefined}>
        <form onSubmit={submit} className="flex flex-col gap-4">
          {!row ? (
            <div className="flex flex-col gap-2">
              <div role="group" aria-label={t("What is it?")} className="flex flex-wrap gap-2">
                {KINDS.map((k) => <Chip key={k.key} active={kind === k.key} onClick={() => pickKind(k.key)}>{t(k.label)}</Chip>)}
              </div>
              {pay ? <p className="text-xs text-muted">{t("Pay counts as an expense: it lowers your profit like any other cost. Set to repeat each month, it counts by itself every day.")}</p> : null}
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            {!expense ? (
              <Field label={t("Repeats")} htmlFor="erep" className="sm:col-span-2">
                <Select id="erep" value={f.repeats} onChange={(e) => setF({ ...f, repeats: e.target.value as Repeats })}>
                  {!recurring ? <option value="ONCE">{t("Once")}</option> : null}
                  {FREQUENCIES.map((k) => <option key={k} value={k}>{t(FREQUENCY_LABEL[k])}</option>)}
                </Select>
              </Field>
            ) : null}
            {repeating ? (
              <Field label={f.category === "SALARIES" ? t("Who is paid") : t("Name")} htmlFor="ename" className="sm:col-span-2">
                <Input id="ename" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={f.category === "SALARIES" ? t("Confirmation agent, driver, designer…") : t("Rent, confirmation agent, Shopify…")} maxLength={120} required />
              </Field>
            ) : null}
            <Field label={repeating ? t("First day") : t("Date")} htmlFor="ed"><Input id="ed" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required /></Field>
            {repeating ? (
              <Field label={t("Last day")} htmlFor="eend" hint={t("Leave empty while it goes on.")}>
                <Input id="eend" type="date" value={f.endDate} min={f.date} onChange={(e) => setF({ ...f, endDate: e.target.value })} />
              </Field>
            ) : null}
            <Field label={repeating ? t("Amount each {unit}", { unit: t(FREQUENCY_UNIT[f.repeats as Frequency]) }) : t("Amount")} htmlFor="ea" hint={perMonth ? t("About {amount} a month, spread over every day.", { amount: perMonth }) : undefined} className={repeating ? "sm:col-span-2" : undefined}>
              <CurrencyAmountInput id="ea" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} workspaceCurrency={currency} rates={rates} required />
            </Field>
            <Field label={t("Category")} htmlFor="ec">
              <Select id="ec" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
                <CategoryOptions categories={categories.data ?? []} />
                <option value="__new">{t("＋ New category…")}</option>
              </Select>
            </Field>
            <Field label={t("Type")} htmlFor="et" hint={t("Fixed: the same each month. Variable: grows with orders.")}>
              <Select id="et" value={f.costType} onChange={(e) => setF({ ...f, costType: e.target.value as CostType })}><option value="FIXED">{t("Fixed")}</option><option value="VARIABLE">{t("Variable")}</option></Select>
            </Field>
            {f.category === "__new" ? (
              <div className="flex items-end gap-2 sm:col-span-2">
                <Field label={t("New category")} htmlFor="ecat-new" className="flex-1">
                  <Input id="ecat-new" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder={t("Influencers, Fuel, Photographer…")} maxLength={60} autoFocus />
                </Field>
                <Button type="button" variant="secondary" disabled={!newCategory.trim() || addCategory.isPending} onClick={() => addCategory.mutate({ name: newCategory })}>{t("Add")}</Button>
              </div>
            ) : null}
            <Field label={t("Counts for")} htmlFor="eal">
              <Select id="eal" value={f.allocation} onChange={(e) => setF({ ...f, allocation: e.target.value as ExpenseAllocation })}><option value="GLOBAL">{t("The whole business")}</option><option value="PRODUCT">{t("One product")}</option></Select>
            </Field>
            {f.allocation === "PRODUCT" ? (
              <Field label={t("Product")} htmlFor="ep">
                <Select id="ep" value={f.productId} onChange={(e) => setF({ ...f, productId: e.target.value })} required>
                  <option value="">{t("Choose product…")}</option>
                  {products.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </Field>
            ) : null}
          </div>
          {!repeating ? <Field label={t("Description")} htmlFor="edesc"><Textarea id="edesc" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field> : null}
          {error ? <p className="text-sm text-negative" role="alert">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>{t("Cancel")}</Button>
            <Button type="submit" variant="primary" disabled={busy}>{row ? t("Save") : repeating ? t("Add repeating expense") : t("Add expense")}</Button>
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
  const { t } = useT();
  const categories = useQuery(trpc.expenses.categories.queryOptions());
  const [name, setName] = React.useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: trpc.expenses.pathKey() });
  const add = useMutation(trpc.expenses.createCategory.mutationOptions({ onSuccess: () => { refresh(); setName(""); }, onError: (e) => toast("error", errorMessage(e)) }));
  const del = useMutation(trpc.expenses.deleteCategory.mutationOptions({ onSuccess: () => { refresh(); toast("success", t("Category deleted")); }, onError: (e) => toast("error", errorMessage(e)) }));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={t("Your categories")} description={t("Add the categories your business needs. Deleting one moves its expenses to Other.")}>
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) add.mutate({ name }); }}>
          <Field label={t("New category")} htmlFor="cat-name" className="flex-1">
            <Input id="cat-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Influencers, Fuel, Photographer…")} maxLength={60} />
          </Field>
          <Button type="submit" variant="primary" disabled={!name.trim() || add.isPending}><Plus /> {t("Add")}</Button>
        </form>
        <ul className="mt-4 flex flex-col divide-y divide-border">
          {!categories.data ? <Skeleton className="h-16" /> : categories.data.length === 0 ? <li className="py-3 text-sm text-muted">{t("None yet. The built-in ones are always there.")}</li> : categories.data.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 py-2.5">
              <span className="min-w-0 truncate text-sm font-semibold">{c.name}</span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="text-xs text-muted">{c.used === 1 ? t("1 expense") : t("{n} expenses", { n: c.used })}</span>
                <Button size="icon" variant="ghost" aria-label={t("Delete {name}", { name: c.name })} onClick={() => confirm(t('Delete "{name}"? Its expenses move to Other.', { name: c.name })) && del.mutate({ id: c.id })}><Trash2 /></Button>
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
/** "Excel" and "CSV" are names, shown as they are. */
const FORMATS = [
  { key: "xlsx", label: "Excel", hint: msg("Three sheets: expenses, repeating, by category.") },
  { key: "csv", label: "CSV", hint: msg("For English Excel and Google Sheets.") },
  { key: "csv;", label: msg("CSV for French Excel"), hint: msg("Uses ; between columns, as Excel in French expects.") },
] as const;

function ExportDialog({ filters, onClose }: { filters: Filters; onClose: () => void }) {
  const trpc = useTRPC();
  const toast = useToast();
  const { t } = useT();
  const [format, setFormat] = React.useState<(typeof FORMATS)[number]["key"]>("xlsx");
  const run = useMutation(
    trpc.expenses.export.mutationOptions({
      onSuccess: (r) => { download(r.filename, r.mime, r.base64); toast("success", t("Exported {n} expenses", { n: r.rows })); onClose(); },
      onError: (e) => toast("error", errorMessage(e)),
    }),
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={t("Export expenses")} description={t("Everything the page shows with your days and filters: each expense, the repeating ones with their share of those days, and the totals by category.")}>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("File type")}>
          {FORMATS.map((k) => <Chip key={k.key} active={format === k.key} onClick={() => setFormat(k.key)}>{t(k.label)}</Chip>)}
        </div>
        <p className="mt-2 text-xs text-muted">{t(FORMATS.find((k) => k.key === format)?.hint ?? "")}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>{t("Cancel")}</Button>
          <Button
            variant="primary"
            disabled={run.isPending}
            onClick={() => run.mutate({ ...filters, format: format === "xlsx" ? "xlsx" : "csv", csvDelimiter: format === "csv;" ? ";" : "," })}
          >
            <Download /> {run.isPending ? t("Preparing…") : t("Download")}
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
              <span className="ms-1.5 text-xs font-normal text-muted">{total > 0 ? `${Math.round((r.amount / total) * 100)}%` : ""}</span>
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
  const { t, tx } = useT();
  const refresh = () => qc.invalidateQueries({ queryKey: trpc.expenses.pathKey() });
  const stop = useMutation(trpc.expenses.stopRecurring.mutationOptions({ onSuccess: () => { refresh(); toast("success", t("Stopped. It no longer counts after today.")); }, onError: (e) => toast("error", errorMessage(e)) }));
  const del = useMutation(trpc.expenses.deleteRecurring.mutationOptions({ onSuccess: () => { refresh(); toast("success", t("Repeating expense deleted")); }, onError: (e) => toast("error", errorMessage(e)) }));
  return (
    <Card>
      <CardHeader
        title={<span className="inline-flex items-center gap-2"><Repeat className="size-4 text-brand-strong" /> {t("Repeating expenses")}</span>}
        description={t("Rent, your pay, employee pay, subscriptions: added once, they count a share every day.")}
        actions={canWrite ? <Button size="sm" variant="secondary" onClick={onAdd}><Plus /> {t("Add repeating")}</Button> : null}
      />
      {!rows ? <Skeleton className="mx-5 mb-5 h-20" /> : rows.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-muted">{canWrite ? t("None yet. Add rent, your pay or an employee's pay once and it counts by itself every month.") : t("None yet.")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border border-t border-border">
          {rows.map((r) => (
            <li key={r.id} className={cn("flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center", !r.running && "opacity-70")}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate font-bold">{r.name}</span>
                  <Badge tone={r.running ? "positive" : "neutral"}>{r.running ? (r.endDate ? t("Until {day}", { day: shortDay(toDateInput(r.endDate), t) }) : t("Running")) : r.endDate && toDateInput(r.endDate) < today ? t("Stopped") : t("Not started")}</Badge>
                  <Badge>{categoryName(r, t)}</Badge>
                  {r.allocation === "PRODUCT" ? <Badge tone="info">{r.product?.name ?? t("Product")}</Badge> : null}
                </div>
                <p className="mt-1 text-xs text-muted">
                  {t(FREQUENCY_LABEL[r.frequency])} · <span className="num">{money.fmt(r.amount, r.currency)}</span>
                  <OriginalAmount amount={r.originalAmount} currency={r.originalCurrency} rate={r.fxRate} />
                  {" · "}{r.endDate ? t("from {start} to {end}", { start: shortDay(toDateInput(r.startDate), t), end: shortDay(toDateInput(r.endDate), t) }) : t("from {start}", { start: shortDay(toDateInput(r.startDate), t) })}
                </p>
              </div>
              <div className="flex items-center justify-between gap-3 sm:justify-end">
                <div className="text-start sm:text-end">
                  <p className="num text-[15px] font-extrabold">{money.fmt(r.inPeriod, currency, { decimals: false })}</p>
                  <p className="text-[11px] text-subtle">{tx("{period} · ≈ {amount}/month", { period: periodLabel, amount: <span className="num">{money.fmt(r.perMonth, currency, { decimals: false })}</span> })}</p>
                </div>
                {canWrite ? (
                  <div className="flex gap-0.5">
                    <Button size="icon" variant="ghost" aria-label={t("Edit {name}", { name: r.name })} onClick={() => onEdit(r)}><Pencil /></Button>
                    {r.running && (!r.endDate || toDateInput(r.endDate) > today) ? <Button size="icon" variant="ghost" aria-label={t("Stop {name}", { name: r.name })} title={t("Stop after today")} onClick={() => confirm(t('Stop "{name}"? It counts until today and stops after. What it cost before stays.', { name: r.name })) && stop.mutate({ id: r.id, today })}><CircleStop /></Button> : null}
                    <Button size="icon" variant="ghost" aria-label={t("Delete {name}", { name: r.name })} onClick={() => confirm(t('Delete "{name}" and everything it cost so far? To keep the past, stop it instead.', { name: r.name })) && del.mutate({ id: r.id })}><Trash2 /></Button>
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
  const { t, date } = useT();
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
  const del = useMutation(trpc.expenses.delete.mutationOptions({ onSuccess: () => { qc.invalidateQueries({ queryKey: trpc.expenses.pathKey() }); toast("success", t("Expense deleted")); }, onError: (e) => toast("error", errorMessage(e)) }));
  const s = summary.data;
  const rangeLabel = RANGES.find((r) => r.key === range)?.label;
  const periodLabel = range === "all" ? t("So far") : range === "custom" ? t("These days") : rangeLabel ? t(rangeLabel) : "";
  const running = recurring.data?.filter((r) => r.running).length ?? 0;
  const clear = () => { setCategory(""); setScope(""); setType(""); setSearch(""); };
  const [moreFilters, setMoreFilters] = useMoreDetails("expenses-filters");

  return (
    <>
      <PageHeader
        title={t("Expenses")}
        description={t("Every cost of the business, once or repeating, your pay included.")}
        actions={
          <>
            <Button variant="secondary" onClick={() => setDialog({ kind: "export" })} className="flex-1 sm:flex-none"><Download /> {t("Export")}</Button>
            {canWrite ? <Button variant="secondary" onClick={() => setDialog({ kind: "categories" })} className="flex-1 sm:flex-none"><Tags /> {t("Categories")}</Button> : null}
            {canWrite ? <Button variant="primary" onClick={() => setDialog({ kind: "new" })} className="w-full sm:w-auto"><Plus /> {t("New expense")}</Button> : null}
          </>
        }
      />

      <div className="mb-4 flex flex-col gap-2">
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="group" aria-label={t("Days")}>
          {RANGES.map((r) => <Chip key={r.key} active={range === r.key} onClick={() => setRange(r.key)} className="shrink-0">{t(r.label)}</Chip>)}
        </div>
        {range === "custom" ? (
          <div className="grid grid-cols-2 gap-2 sm:max-w-sm">
            <Input type="date" aria-label={t("From")} value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
            <Input type="date" aria-label={t("To")} value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
          </div>
        ) : null}
        {bad ? <p className="text-sm text-negative">{t("The start day must be before the end day.")}</p> : null}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <div className="relative col-span-2 sm:w-56">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
          <Input aria-label={t("Search")} type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("Search expenses")} className="ps-9" />
        </div>
        <Select aria-label={t("Category")} value={category} onChange={(e) => setCategory(e.target.value)} className="col-span-2 w-full sm:w-48">
          <option value="">{t("All categories")}</option>
          <CategoryOptions categories={categories.data ?? []} />
        </Select>
        <MoreDetailsButton open={moreFilters || !!scope || !!type} onToggle={(o) => { setMoreFilters(o); if (!o) { setScope(""); setType(""); } }} labels={[t("More filters"), t("Fewer filters")]} className="col-span-2 justify-self-start" />
        {moreFilters || scope || type ? (
          <>
        <Select aria-label={t("Counts for")} value={scope} onChange={(e) => setScope(e.target.value)} className="col-span-2 w-full sm:w-56">
          <option value="">{t("Business and products")}</option>
          <option value="GLOBAL">{t("The whole business")}</option>
          <option value="PRODUCT">{t("Any product")}</option>
          {products.data?.length ? <optgroup label={t("One product")}>{products.data.map((p) => <option key={p.id} value={`p:${p.id}`}>{p.name}</option>)}</optgroup> : null}
        </Select>
        <Select aria-label={t("Type")} value={type} onChange={(e) => setType(e.target.value)} className={cn("w-full sm:w-44", !filtered && "col-span-2")}>
          <option value="">{t("Fixed and variable")}</option><option value="FIXED">{t("Fixed")}</option><option value="VARIABLE">{t("Variable")}</option>
        </Select>
          </>
        ) : null}
        {filtered ? <Button variant="ghost" onClick={clear}>{t("Clear filters")}</Button> : null}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4">
        <section className="relative col-span-2 flex min-w-0 flex-col gap-3 overflow-hidden rounded-[22px] bg-brand-hero p-5 text-white shine shadow-[0_16px_34px_rgb(204_19_37/0.35),inset_0_1px_0_rgb(255_255_255/0.35)] sm:col-span-3 xl:col-span-1">
          <span className="pointer-events-none absolute -end-12 -top-16 size-44 rounded-full border-[20px] border-white/10" aria-hidden="true" />
          <span className="relative text-[15px] font-semibold">{t("Expenses · {period}", { period: periodLabel.toLowerCase() })}</span>
          <div className="relative min-w-0">{s ? <FitMoney value={whole(s.total, currency)} currency={currency} max={34} codeClassName="text-white/85" className="[text-shadow:0_2px_14px_rgb(255_170_178/0.55)]" /> : <Skeleton className="h-9 w-40 bg-white/25" />}</div>
          <span className="relative text-xs text-white/85">{s ? t("{once} once · {repeating} repeating", { once: money.fmt(s.total - s.repeating, currency, { decimals: false }), repeating: money.fmt(s.repeating, currency, { decimals: false }) }) : " "}</span>
        </section>
        <Card className="flex min-w-0 flex-col gap-1.5 p-4">
          <p className="text-xs text-muted"><Term label={t("Repeating, each month")} definition={t("What the repeating expenses still running cost in an average month: a daily one × 365 ÷ 12, a weekly one × 52 ÷ 12, a yearly one ÷ 12.")} /></p>
          {s ? <FitMoney value={whole(s.repeatingPerMonth, currency)} currency={currency} max={26} /> : <Skeleton className="h-7 w-28" />}
          <p className="text-[11px] text-subtle">{running === 1 ? t("1 running") : t("{n} running", { n: running })}</p>
        </Card>
        <Card className="flex min-w-0 flex-col gap-1.5 p-4">
          <p className="text-xs text-muted"><Term label={t("For the whole business")} definition={t("Expenses not tied to one product. Profit shares them across products by the rule in Settings → Economics (by default, across delivered orders).")} /></p>
          {s ? <FitMoney value={whole(s.unallocated, currency)} currency={currency} max={26} className="text-warning" /> : <Skeleton className="h-7 w-28" />}
          <p className="text-[11px] text-subtle">{s ? t("{amount} for products", { amount: money.fmt(s.total - s.unallocated, currency, { decimals: false }) }) : " "}</p>
        </Card>
        <Card className="col-span-2 flex min-w-0 flex-col gap-1.5 p-4 sm:col-span-1">
          <p className="text-xs text-muted"><Term label={t("Bank rows to review")} definition={t("Imported bank rows don't count in profit until you give them a category or leave them out.")} /></p>
          <p className="num text-2xl font-extrabold">{s?.pendingBankRows ?? "–"}</p>
          <Link href="/imports?tab=bank" className="text-xs font-semibold text-brand-strong hover:underline">{t("Review bank rows")}</Link>
        </Card>
      </div>

      <div className="flex min-w-0 flex-col gap-6">
          <RepeatingCard rows={recurring.data} currency={currency} canWrite={canWrite} today={today} periodLabel={periodLabel} onAdd={() => setDialog({ kind: "new", repeats: true })} onEdit={(row) => setDialog({ kind: "recurring", row })} />

          <Card className="min-w-0">
            <CardHeader title={t("One-off expenses")} description={list.data && list.data.length >= 500 ? t("The latest 500. Pick fewer days to see the rest, or export.") : undefined} />
            {list.error ? <ErrorState message={errorMessage(list.error)} /> : !list.data ? <Loading /> : !list.data.length ? (
              filtered || range !== "all" ? (
                <EmptyState icon={<Receipt />} title={t("Nothing matches")} description={t("No one-off expense in these days with these filters.")} action={filtered ? <Button variant="secondary" onClick={clear}>{t("Clear filters")}</Button> : undefined} />
              ) : (
                <EmptyState icon={<Receipt />} title={t("No expenses")} description={t("Add software, call-center, packaging and other costs so profit reflects the whole business.")} />
              )
            ) : (
              <>
                <div className="hidden md:block">
                  <Table>
                    <THead><tr><Th>{t("Date")}</Th><Th>{t("Category")}</Th><Th>{t("Description")}</Th><Th>{t("For")}</Th><Th className="text-end">{t("Amount")}</Th><Th><span className="sr-only">{t("Actions")}</span></Th></tr></THead>
                    <tbody>
                      {list.data.map((e) => (
                        <Tr key={e.id}>
                          <Td className="whitespace-nowrap text-xs text-muted">{date(e.date)}</Td>
                          <Td className="whitespace-nowrap">{categoryName(e, t)}<span className="block text-[11px] text-subtle">{e.costType === "FIXED" ? t("Fixed") : t("Variable")}</span></Td>
                          <Td className="max-w-56 truncate text-muted">{e.description ?? "—"}</Td>
                          <Td>{e.allocation === "GLOBAL" ? <Badge tone="warning">{t("Whole business")}</Badge> : <Badge tone="info">{e.product?.name ?? t("Product")}</Badge>}</Td>
                          <Td className="num whitespace-nowrap text-end">{money.fmt(e.amount, e.currency)}<OriginalAmount amount={e.originalAmount} currency={e.originalCurrency} rate={e.fxRate} /></Td>
                          <Td>
                            {canWrite ? (
                              <div className="flex justify-end gap-0.5">
                                <Button size="icon" variant="ghost" aria-label={t("Edit expense")} onClick={() => setDialog({ kind: "expense", row: e })}><Pencil /></Button>
                                <Button size="icon" variant="ghost" aria-label={t("Delete expense")} onClick={() => confirm(t("Delete this expense?")) && del.mutate({ id: e.id })}><Trash2 /></Button>
                              </div>
                            ) : null}
                          </Td>
                        </Tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
                <ul className="flex flex-col divide-y divide-border border-t border-border md:hidden">
                  {list.data.map((e) => (
                    <li key={e.id} className="flex flex-col gap-1.5 px-5 py-3.5">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 truncate font-bold">{e.description || categoryName(e, t)}</span>
                        <span className="num shrink-0 font-extrabold">{money.fmt(e.amount, e.currency)}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                        <span>{date(e.date)}</span>·<span>{categoryName(e, t)}</span>·<span>{e.costType === "FIXED" ? t("Fixed") : t("Variable")}</span>
                        {e.allocation === "GLOBAL" ? <Badge tone="warning">{t("Whole business")}</Badge> : <Badge tone="info">{e.product?.name ?? t("Product")}</Badge>}
                      </div>
                      <OriginalAmount amount={e.originalAmount} currency={e.originalCurrency} rate={e.fxRate} />
                      {canWrite ? (
                        <div className="-ms-2 flex gap-0.5">
                          <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "expense", row: e })}><Pencil /> {t("Edit")}</Button>
                          <Button size="sm" variant="ghost" onClick={() => confirm(t("Delete this expense?")) && del.mutate({ id: e.id })}><Trash2 /> {t("Delete")}</Button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
      </div>

      <MoreDetails id="expenses" hint={t("Totals by category, by product and for each month.")} className="mt-6">
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
          <Card>
            <CardHeader title={t("By category")} description={t("One-off and repeating together.")} />
            {!s ? <Skeleton className="mx-5 mb-5 h-32" /> : <Bars rows={s.byCategory.map((c) => ({ key: c.category, label: c.name ?? t(categoryLabel(c.category)), amount: c.amount }))} total={s.total} currency={currency} empty={t("No expenses in these days.")} />}
          </Card>
          {s && s.byProduct.length ? (
            <Card>
              <CardHeader title={t("By product")} description={t("Expenses tied to one product.")} />
              <Bars rows={s.byProduct.map((p) => ({ key: p.productId, label: p.name, amount: p.amount }))} total={s.total - s.unallocated} currency={currency} empty="" />
            </Card>
          ) : null}
          <Card>
            <CardHeader title={t("Each month")} />
            <CardBody className="p-0">
              {!s ? <Skeleton className="m-4 h-32" /> : s.months.length === 0 ? <p className="px-5 pb-5 text-sm text-muted">{t("No expenses in these days.")}</p> : (
                <Table>
                  <THead><tr><Th>{t("Month")}</Th><Th className="text-end">{t("Repeating")}</Th><Th className="text-end">{t("Total")}</Th></tr></THead>
                  <tbody>
                    {s.months.map((m) => (
                      <Tr key={m.month}>
                        <Td className="whitespace-nowrap text-xs">{monthLabel(m.month, t)}</Td>
                        <Td className="num whitespace-nowrap text-end text-muted">{money.fmt(m.repeating, currency, { decimals: false })}</Td>
                        <Td className="num whitespace-nowrap text-end font-semibold">{money.fmt(m.total, currency, { decimals: false })}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </CardBody>
          </Card>
        </div>
      </MoreDetails>

      {dialog?.kind === "new" ? <ExpenseDialog initialRepeats={dialog.repeats ? "MONTHLY" : "ONCE"} onClose={() => setDialog(null)} currency={currency} rates={rates} today={today} /> : null}
      {dialog?.kind === "expense" ? <ExpenseDialog expense={dialog.row} onClose={() => setDialog(null)} currency={currency} rates={rates} today={today} /> : null}
      {dialog?.kind === "recurring" ? <ExpenseDialog recurring={dialog.row} onClose={() => setDialog(null)} currency={currency} rates={rates} today={today} /> : null}
      {dialog?.kind === "categories" ? <CategoriesDialog onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "export" ? <ExportDialog filters={filters} onClose={() => setDialog(null)} /> : null}
    </>
  );
}
