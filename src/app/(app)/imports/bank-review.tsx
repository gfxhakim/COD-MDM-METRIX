"use client";

import type { CostType, ExpenseAllocation } from "@prisma/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Landmark, RotateCcw, Tags } from "lucide-react";
import * as React from "react";
import { Money } from "@/components/app/format";
import { useCan } from "@/components/app/use-can";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { EmptyState, ErrorState, Loading } from "@/components/ui/states";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { TabsList, TabsTrigger, Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { categoryLabel, EXPENSE_CATEGORIES, type ExpenseCategoryKey } from "@/lib/labels";
import { errorMessage, useTRPC } from "@/lib/trpc/client";
import { formatDate } from "@/lib/utils";

type Status = "PENDING" | "CATEGORIZED" | "EXCLUDED";
type BankRow = { id: string; date: Date; description: string | null; amount: number; currency: string; reference: string | null; reviewStatus: Status; expense: { category: string } | null };

/** Guess a category from the bank label so reviewing is mostly confirming. */
function guessCategory(label: string | null): ExpenseCategoryKey {
  const l = (label ?? "").toLowerCase();
  if (/openai|chatgpt|midjourney|claude|elevenlabs/.test(l)) return "AI_TOOLS";
  if (/shopify|canva|google|notion|capcut|adobe|easysell/.test(l)) return "SOFTWARE";
  if (/namecheap|godaddy|hostinger|proxy|domain/.test(l)) return "DOMAINS_PROXIES";
  if (/frais|fee|commission|agios/.test(l)) return "BANK_FEES";
  if (/rent|loyer|office/.test(l)) return "OFFICE";
  if (/carton|packag|emball/.test(l)) return "PACKAGING";
  return "OTHER";
}

function CategorizeDialog({ row, onClose }: { row: BankRow; onClose: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const products = useQuery(trpc.products.list.queryOptions({ includeInactive: true }));
  const [f, setF] = React.useState({ category: guessCategory(row.description), allocation: "GLOBAL" as ExpenseAllocation, productId: "", costType: "FIXED" as CostType, description: row.description ?? "" });
  const [error, setError] = React.useState<string | null>(null);
  const m = useMutation(
    trpc.bank.categorize.mutationOptions({
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: trpc.bank.pathKey() });
        qc.invalidateQueries({ queryKey: trpc.expenses.pathKey() });
        qc.invalidateQueries({ queryKey: trpc.reports.pathKey() });
        toast("success", "Added as an expense");
        onClose();
      },
      onError: (e) => setError(errorMessage(e)),
    }),
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Categorize bank row" description={<>{formatDate(row.date)} · <Money value={row.amount} currency={row.currency} signed /> · {row.description ?? "No description"}</>}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            m.mutate({ id: row.id, category: f.category, allocation: f.allocation, productId: f.allocation === "PRODUCT" ? f.productId || null : null, costType: f.costType, description: f.description });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category" htmlFor="bc"><Select id="bc" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as ExpenseCategoryKey })}>{EXPENSE_CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
            <Field label="Type" htmlFor="bt"><Select id="bt" value={f.costType} onChange={(e) => setF({ ...f, costType: e.target.value as CostType })}><option value="FIXED">Fixed</option><option value="VARIABLE">Variable</option></Select></Field>
            <Field label="Allocation" htmlFor="ba"><Select id="ba" value={f.allocation} onChange={(e) => setF({ ...f, allocation: e.target.value as ExpenseAllocation })}><option value="GLOBAL">Global (unallocated)</option><option value="PRODUCT">Specific product</option></Select></Field>
            {f.allocation === "PRODUCT" ? (
              <Field label="Product" htmlFor="bp"><Select id="bp" required value={f.productId} onChange={(e) => setF({ ...f, productId: e.target.value })}><option value="">Choose product…</option>{products.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
            ) : null}
          </div>
          <Field label="Description" htmlFor="bd"><Input id="bd" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={500} /></Field>
          {error ? <p className="text-sm text-negative" role="alert">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={m.isPending}>Add expense</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function BankReview() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const canWrite = useCan("expenses.write");
  const [status, setStatus] = React.useState<Status>("PENDING");
  const list = useQuery(trpc.bank.list.queryOptions({ status, limit: 200 }));
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [categorizing, setCategorizing] = React.useState<BankRow | null>(null);
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: trpc.bank.pathKey() });
    qc.invalidateQueries({ queryKey: trpc.expenses.pathKey() });
    qc.invalidateQueries({ queryKey: trpc.reports.pathKey() });
  };
  const exclude = useMutation(trpc.bank.exclude.mutationOptions({ onSuccess: (r) => { setSelected(new Set()); invalidate(); toast("success", `${r.count} row${r.count === 1 ? "" : "s"} excluded`); }, onError: (e) => toast("error", errorMessage(e)) }));
  const reopen = useMutation(trpc.bank.reopen.mutationOptions({ onSuccess: () => { invalidate(); toast("success", "Moved back to review"); }, onError: (e) => toast("error", errorMessage(e)) }));
  const counts = list.data?.counts;
  const rows = (list.data?.items ?? []) as BankRow[];
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <Card>
      <CardHeader
        title="Bank review queue"
        description="Money going out can become an expense. Incoming transfers (such as courier remittances) and personal or duplicate rows should be excluded. Nothing here affects profit until you decide."
        actions={canWrite && status === "PENDING" && selected.size ? <Button size="sm" variant="outline" onClick={() => exclude.mutate({ ids: [...selected] })}><Ban /> Exclude {selected.size}</Button> : null}
      />
      <Tabs value={status} onValueChange={(v) => { setStatus(v as Status); setSelected(new Set()); }}>
        <TabsList className="px-3">
          {(["PENDING", "CATEGORIZED", "EXCLUDED"] as const).map((s) => (
            <TabsTrigger key={s} value={s}>{s === "PENDING" ? "To review" : s === "CATEGORIZED" ? "Categorized" : "Excluded"} <span className="num ml-1 text-xs text-muted">{counts?.[s]?.count ?? 0}</span></TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {list.error ? <ErrorState message={errorMessage(list.error)} /> : list.isLoading ? <Loading /> : !rows.length ? (
        <EmptyState icon={<Landmark />} title={status === "PENDING" ? "Nothing to review" : "No rows"} description={status === "PENDING" ? "Import a bank statement above; its rows will wait here for review." : undefined} />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <THead>
              <tr>
                {canWrite && status === "PENDING" ? (
                  <Th className="w-8"><input type="checkbox" aria-label="Select all" checked={selected.size === rows.length} onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} /></Th>
                ) : null}
                <Th>Date</Th><Th>Description</Th><Th>Reference</Th><Th className="text-right">Amount</Th>{status === "CATEGORIZED" ? <Th>Category</Th> : null}<Th><span className="sr-only">Actions</span></Th>
              </tr>
            </THead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  {canWrite && status === "PENDING" ? <Td><input type="checkbox" aria-label={`Select ${r.description ?? r.id}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} /></Td> : null}
                  <Td className="whitespace-nowrap text-xs text-muted">{formatDate(r.date)}</Td>
                  <Td className="max-w-72 truncate">{r.description ?? "—"}</Td>
                  <Td className="text-xs text-muted">{r.reference ?? "—"}</Td>
                  <Td className="text-right"><Money value={r.amount} currency={r.currency} signed /></Td>
                  {status === "CATEGORIZED" ? <Td>{r.expense ? <Badge tone="info">{categoryLabel(r.expense.category)}</Badge> : "—"}</Td> : null}
                  <Td>
                    {canWrite ? (
                      <div className="flex justify-end gap-1">
                        {status === "PENDING" ? (
                          <>
                            {r.amount < 0 ? <Button size="sm" variant="outline" onClick={() => setCategorizing(r)}><Tags /> Categorize</Button> : <span className="self-center text-xs text-muted">Incoming</span>}
                            <Button size="sm" variant="ghost" onClick={() => exclude.mutate({ ids: [r.id] })}><Ban /> Exclude</Button>
                          </>
                        ) : (
                          <Button size="sm" variant="ghost" onClick={() => reopen.mutate({ id: r.id })}><RotateCcw /> {status === "CATEGORIZED" ? "Undo (removes expense)" : "Reopen"}</Button>
                        )}
                      </div>
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
      {categorizing ? <CategorizeDialog row={categorizing} onClose={() => setCategorizing(null)} /> : null}
    </Card>
  );
}
