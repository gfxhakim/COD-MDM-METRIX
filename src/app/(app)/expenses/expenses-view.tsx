"use client";

import type { CostType, ExpenseAllocation } from "@prisma/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Receipt, Trash2 } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { MoneyInput, minorToInput } from "@/components/app/money-input";
import { PageHeader } from "@/components/app/page-header";
import { useCan } from "@/components/app/use-can";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { EmptyState, ErrorState, Loading, Skeleton } from "@/components/ui/states";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { Term } from "@/components/ui/tooltip";
import { categoryLabel, EXPENSE_CATEGORIES, type ExpenseCategoryKey } from "@/lib/labels";
import { formatMoney, parseToMinor } from "@/lib/money";
import { errorMessage, useTRPC } from "@/lib/trpc/client";
import { formatDate, toDateInput } from "@/lib/utils";

type ExpenseRow = {
  id: string;
  date: Date;
  category: ExpenseCategoryKey;
  amount: number;
  currency: string;
  description: string | null;
  allocation: ExpenseAllocation;
  productId: string | null;
  costType: CostType;
  product: { id: string; name: string } | null;
};

function ExpenseDialog({ expense, onClose, currency }: { expense?: ExpenseRow; onClose: () => void; currency: string }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const products = useQuery(trpc.products.list.queryOptions({ includeInactive: true }));
  const [f, setF] = React.useState({
    date: toDateInput(expense?.date ?? new Date()),
    category: (expense?.category ?? "SOFTWARE") as ExpenseCategoryKey,
    amount: minorToInput(expense?.amount, currency),
    description: expense?.description ?? "",
    allocation: (expense?.allocation ?? "GLOBAL") as ExpenseAllocation,
    productId: expense?.productId ?? "",
    costType: (expense?.costType ?? "FIXED") as CostType,
  });
  const [error, setError] = React.useState<string | null>(null);
  const done = (msg: string) => { qc.invalidateQueries({ queryKey: trpc.expenses.pathKey() }); toast("success", msg); onClose(); };
  const create = useMutation(trpc.expenses.create.mutationOptions({ onSuccess: () => done("Expense added"), onError: (e) => setError(errorMessage(e)) }));
  const update = useMutation(trpc.expenses.update.mutationOptions({ onSuccess: () => done("Expense updated"), onError: (e) => setError(errorMessage(e)) }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const data = {
        date: new Date(`${f.date}T12:00:00Z`),
        category: f.category,
        amount: parseToMinor(f.amount, currency),
        description: f.description || undefined,
        allocation: f.allocation,
        productId: f.allocation === "PRODUCT" ? f.productId || null : null,
        costType: f.costType,
      };
      if (expense) update.mutate({ id: expense.id, data });
      else create.mutate(data);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={expense ? "Edit expense" : "New expense"}>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date" htmlFor="ed"><Input id="ed" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required /></Field>
            <Field label="Amount" htmlFor="ea"><MoneyInput id="ea" currency={currency} value={f.amount} onChange={(v) => setF({ ...f, amount: v })} required /></Field>
            <Field label="Category" htmlFor="ec">
              <Select id="ec" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as ExpenseCategoryKey })}>
                {EXPENSE_CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </Select>
            </Field>
            <Field label="Type" htmlFor="et" hint="Fixed: monthly overhead. Variable: scales with volume.">
              <Select id="et" value={f.costType} onChange={(e) => setF({ ...f, costType: e.target.value as CostType })}><option value="FIXED">Fixed</option><option value="VARIABLE">Variable</option></Select>
            </Field>
            <Field label="Allocation" htmlFor="eal">
              <Select id="eal" value={f.allocation} onChange={(e) => setF({ ...f, allocation: e.target.value as ExpenseAllocation })}><option value="GLOBAL">Global (unallocated)</option><option value="PRODUCT">Specific product</option></Select>
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
          <Field label="Description" htmlFor="edesc"><Textarea id="edesc" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          {error ? <p className="text-sm text-negative" role="alert">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={create.isPending || update.isPending}>{expense ? "Save" : "Add expense"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ExpensesView() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const canWrite = useCan("expenses.write");
  const ws = useQuery(trpc.workspace.getCurrent.queryOptions());
  const products = useQuery(trpc.products.list.queryOptions({ includeInactive: true }));
  const currency = ws.data?.currency ?? "DZD";
  const [category, setCategory] = React.useState("");
  const [allocation, setAllocation] = React.useState("");
  const [productId, setProductId] = React.useState("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const filters = {
    category: (category || undefined) as ExpenseCategoryKey | undefined,
    allocation: (allocation || undefined) as ExpenseAllocation | undefined,
    productId: productId || undefined,
    from: from ? new Date(from) : undefined,
    to: to ? new Date(`${to}T23:59:59Z`) : undefined,
  };
  const list = useQuery(trpc.expenses.list.queryOptions(filters));
  const summary = useQuery(trpc.expenses.summary.queryOptions(filters));
  const [editing, setEditing] = React.useState<ExpenseRow | null>(null);
  const [creating, setCreating] = React.useState(false);
  const del = useMutation(trpc.expenses.delete.mutationOptions({ onSuccess: () => { qc.invalidateQueries({ queryKey: trpc.expenses.pathKey() }); toast("success", "Expense deleted"); }, onError: (e) => toast("error", errorMessage(e)) }));
  const s = summary.data;

  return (
    <>
      <PageHeader
        title="Expenses"
        description="Overheads and operating costs. Global expenses are allocated across products by your workspace policy when profit is calculated."
        actions={canWrite ? <Button variant="primary" onClick={() => setCreating(true)}><Plus /> New expense</Button> : null}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Total expenses", value: s?.total, tone: "" },
          { label: "Unallocated (global)", value: s?.unallocated, tone: "text-warning", def: "Expenses not tied to a product. They reduce profit through the allocation policy set in Settings → Economics defaults (by default, spread across delivered orders)." },
          { label: "Product-specific", value: s ? s.total - s.unallocated : undefined, tone: "" },
        ].map((k) => (
          <Card key={k.label} className="p-4">
            <p className="text-xs text-muted">{k.def ? <Term label={k.label} definition={k.def} /> : k.label}</p>
            {k.value === undefined ? <Skeleton className="mt-2 h-7 w-32" /> : <p className={`num mt-1 text-2xl font-semibold ${k.tone}`}>{formatMoney(k.value, currency)}</p>}
          </Card>
        ))}
        <Card className="p-4">
          <p className="text-xs text-muted"><Term label="Bank rows awaiting review" definition="Imported bank rows do not affect profit until they are categorized or explicitly excluded." /></p>
          <p className="num mt-1 text-2xl font-semibold">{s?.pendingBankRows ?? "–"}</p>
          <Link href="/imports" className="text-xs text-positive hover:underline">Bank import review (Milestone 3)</Link>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
        <Card>
          <div className="flex flex-wrap gap-2 border-b border-border p-3">
            <Select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} className="w-40">
              <option value="">All categories</option>
              {EXPENSE_CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
            <Select aria-label="Allocation" value={allocation} onChange={(e) => setAllocation(e.target.value)} className="w-40">
              <option value="">All allocations</option><option value="GLOBAL">Global</option><option value="PRODUCT">Product</option>
            </Select>
            <Select aria-label="Product" value={productId} onChange={(e) => setProductId(e.target.value)} className="w-40">
              <option value="">All products</option>
              {products.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <Input aria-label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-38" />
            <Input aria-label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-38" />
          </div>
          {list.error ? <ErrorState message={errorMessage(list.error)} /> : list.isLoading ? <Loading /> : !list.data?.length ? (
            <EmptyState icon={<Receipt />} title="No expenses" description="Add software, call-center, packaging and other costs so profit reflects the whole business." />
          ) : (
            <Table>
              <THead><tr><Th>Date</Th><Th>Category</Th><Th>Description</Th><Th>Allocation</Th><Th>Type</Th><Th className="text-right">Amount</Th><Th><span className="sr-only">Actions</span></Th></tr></THead>
              <tbody>
                {list.data.map((e) => (
                  <Tr key={e.id}>
                    <Td className="text-xs text-muted">{formatDate(e.date)}</Td>
                    <Td>{categoryLabel(e.category)}</Td>
                    <Td className="max-w-64 truncate text-muted">{e.description ?? "—"}</Td>
                    <Td>{e.allocation === "GLOBAL" ? <Badge tone="warning">Global</Badge> : <Badge tone="info">{e.product?.name ?? "Product"}</Badge>}</Td>
                    <Td className="text-xs text-muted">{e.costType.toLowerCase()}</Td>
                    <Td className="num text-right">{formatMoney(e.amount, e.currency)}</Td>
                    <Td>
                      {canWrite ? (
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" aria-label="Edit expense" onClick={() => setEditing(e as ExpenseRow)}><Pencil /></Button>
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

        <Card>
          <CardHeader title="Monthly totals" />
          <CardBody className="p-0">
            {!s ? <Skeleton className="m-4 h-32" /> : s.months.length === 0 ? <p className="p-4 text-sm text-muted">No data.</p> : (
              <Table>
                <THead><tr><Th>Month</Th><Th className="text-right">Global</Th><Th className="text-right">Total</Th></tr></THead>
                <tbody>
                  {s.months.map((m) => (
                    <Tr key={m.month}>
                      <Td className="text-xs">{m.month}</Td>
                      <Td className="num text-right text-warning">{formatMoney(m.global, currency)}</Td>
                      <Td className="num text-right">{formatMoney(m.total, currency)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </CardBody>
        </Card>
      </div>

      {creating ? <ExpenseDialog onClose={() => setCreating(false)} currency={currency} /> : null}
      {editing ? <ExpenseDialog expense={editing} onClose={() => setEditing(null)} currency={currency} /> : null}
    </>
  );
}
