"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator, History, Package, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { CurrencyAmountInput, OriginalAmount, parseCurrencyAmount, rateInput, type CurrencyAmount, type Rates } from "@/components/app/currency-amount";
import { MoneyInput, minorToInput } from "@/components/app/money-input";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/form";
import { EmptyState, ErrorState, Loading } from "@/components/ui/states";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { Term } from "@/components/ui/tooltip";
import { formatMoney, parseToMinor } from "@/lib/money";
import { errorMessage, useTRPC } from "@/lib/trpc/client";
import { formatDate, toDateInput } from "@/lib/utils";
import { useCan } from "@/components/app/use-can";

const COST_FIELDS = [
  { key: "salePrice", label: "Sale price", hint: "COD amount collected per unit" },
  { key: "sourcingCost", label: "Sourcing cost (COGS)", hint: "Per delivered unit. Pick the currency you pay your supplier in." },
  { key: "forwardShippingFee", label: "Forward shipping fee", hint: "Per shipped parcel" },
  { key: "rtoFee", label: "RTO fee", hint: "Per returned parcel" },
  { key: "callCenterFee", label: "Call-center fee", hint: "Per call basis unit" },
  { key: "packagingFee", label: "Packaging fee", hint: "Per shipped parcel" },
] as const;
type CostKey = (typeof COST_FIELDS)[number]["key"];
type CostValues = Record<CostKey, number>;
/** Sourcing cost can be in any currency; the other fields are in the workspace currency. */
type CostForm = Record<Exclude<CostKey, "sourcingCost">, string> & { sourcing: CurrencyAmount };
type SourcingOriginal = { sourcingCostOriginal: number | null; sourcingCurrency: string | null; sourcingFxRate: number | null };

const emptyCost = (currency: string): CostForm => ({ salePrice: "", sourcing: { amount: "", currency, rate: "" }, forwardShippingFee: "", rtoFee: "", callCenterFee: "", packagingFee: "" });

function parseCost(form: CostForm, currency: string) {
  const out = {} as CostValues;
  for (const f of COST_FIELDS) {
    if (f.key === "sourcingCost") continue;
    const minor = parseToMinor(form[f.key] || "0", currency);
    if (minor < 0) throw new Error(`${f.label} cannot be negative`);
    out[f.key] = minor;
  }
  const sourcing = parseCurrencyAmount(form.sourcing, currency, "Sourcing cost");
  return { ...out, sourcingCost: sourcing.amount, sourcingCurrency: sourcing.currency, sourcingFxRate: sourcing.rate };
}

function CostFields({ value, onChange, currency, rates }: { value: CostForm; onChange: (v: CostForm) => void; currency: string; rates: Rates }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {COST_FIELDS.map((f) => (
        <Field key={f.key} label={f.label} htmlFor={f.key} hint={f.hint}>
          {f.key === "sourcingCost" ? (
            <CurrencyAmountInput id={f.key} value={value.sourcing} onChange={(v) => onChange({ ...value, sourcing: v })} workspaceCurrency={currency} rates={rates} />
          ) : (
            <MoneyInput id={f.key} currency={currency} value={value[f.key]} onChange={(v) => onChange({ ...value, [f.key]: v })} required={f.key === "salePrice"} />
          )}
        </Field>
      ))}
    </div>
  );
}

type ProductRow = {
  id: string;
  name: string;
  sku: string;
  currency: string;
  active: boolean;
  versionCount: number;
  currentCost: (CostValues & SourcingOriginal & { effectiveFrom: Date }) | null;
};

function ProductDialog({ product, open, onOpenChange, currency, rates }: { product?: ProductRow; open: boolean; onOpenChange: (o: boolean) => void; currency: string; rates: Rates }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = React.useState(product?.name ?? "");
  const [sku, setSku] = React.useState(product?.sku ?? "");
  const [active, setActive] = React.useState(product?.active ?? true);
  const [cost, setCost] = React.useState<CostForm>(() => emptyCost(currency));
  const [error, setError] = React.useState<string | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: trpc.products.list.queryKey() });
  const create = useMutation(trpc.products.create.mutationOptions({ onSuccess: () => { invalidate(); toast("success", "Product created"); onOpenChange(false); }, onError: (e) => setError(errorMessage(e)) }));
  const update = useMutation(trpc.products.update.mutationOptions({ onSuccess: () => { invalidate(); toast("success", "Product updated"); onOpenChange(false); }, onError: (e) => setError(errorMessage(e)) }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (product) update.mutate({ id: product.id, name, sku, active });
      else create.mutate({ name, sku, active, cost: parseCost(cost, currency) });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={product ? "Edit product" : "New product"} description={product ? "Cost assumptions are versioned separately so history is never overwritten." : "Set the unit economics that apply from today."} className="max-w-2xl">
        <form onSubmit={submit} className="flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Product name" htmlFor="pname"><Input id="pname" value={name} onChange={(e) => setName(e.target.value)} required /></Field>
            <Field label="SKU" htmlFor="psku"><Input id="psku" value={sku} onChange={(e) => setSku(e.target.value)} required className="font-mono" /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-4 accent-[#b6f24a]" /> Active
          </label>
          {!product ? <CostFields value={cost} onChange={setCost} currency={currency} rates={rates} /> : null}
          {error ? <p className="text-sm text-negative" role="alert">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={create.isPending || update.isPending}>{product ? "Save" : "Create product"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CostVersionDialog({ product, open, onOpenChange, rates }: { product: ProductRow; open: boolean; onOpenChange: (o: boolean) => void; rates: Rates }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const details = useQuery({ ...trpc.products.get.queryOptions({ id: product.id }), enabled: open });
  const current = product.currentCost;
  const [cost, setCost] = React.useState<CostForm>(() => {
    if (!current) return emptyCost(product.currency);
    const form = Object.fromEntries(COST_FIELDS.map((f) => [f.key, minorToInput(current[f.key], product.currency)])) as Record<CostKey, string>;
    // Start from the currency the supplier was paid in, at today's rate from Settings.
    const sourcing: CurrencyAmount = current.sourcingCurrency
      ? { amount: minorToInput(current.sourcingCostOriginal, current.sourcingCurrency), currency: current.sourcingCurrency, rate: rateInput(rates, current.sourcingCurrency, current.sourcingFxRate) }
      : { amount: form.sourcingCost, currency: product.currency, rate: "" };
    return { ...form, sourcing };
  });
  const [effectiveFrom, setEffectiveFrom] = React.useState(toDateInput(new Date()));
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const mutation = useMutation(
    trpc.products.createCostVersion.mutationOptions({
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: trpc.products.list.queryKey() });
        qc.invalidateQueries({ queryKey: trpc.products.get.queryKey({ id: product.id }) });
        toast("success", "New cost version saved");
        onOpenChange(false);
      },
      onError: (e) => setError(errorMessage(e)),
    }),
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent side="right" title={`Cost versions · ${product.name}`} description="A new version starts on its effective date and closes the previous one. Past orders keep the costs that applied when they were placed.">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            try {
              mutation.mutate({ productId: product.id, effectiveFrom: new Date(`${effectiveFrom}T00:00:00Z`), note: note || undefined, cost: parseCost(cost, product.currency) });
            } catch (err) {
              setError((err as Error).message);
            }
          }}
          className="flex flex-col gap-4"
        >
          <Field label="Effective from" htmlFor="eff"><Input id="eff" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} required /></Field>
          <CostFields value={cost} onChange={setCost} currency={product.currency} rates={rates} />
          <Field label="Note" htmlFor="note"><Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Supplier price increase" /></Field>
          {error ? <p className="text-sm text-negative" role="alert">{error}</p> : null}
          <div className="flex justify-end"><Button type="submit" variant="primary" disabled={mutation.isPending}>Add cost version</Button></div>
        </form>
        <h3 className="mb-2 mt-8 text-xs font-medium uppercase tracking-wide text-subtle">History</h3>
        {details.isLoading ? <Loading /> : (
          <ol className="flex flex-col gap-2">
            {details.data?.costVersions.map((v) => (
              <li key={v.id} className="rounded-lg border border-border bg-surface-2 p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-fg">{formatDate(v.effectiveFrom)} → {v.effectiveTo ? formatDate(v.effectiveTo) : "now"}</span>
                  {v.effectiveTo === null ? <Badge tone="positive">current</Badge> : <Badge>closed</Badge>}
                </div>
                <div className="num mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-muted sm:grid-cols-3">
                  {COST_FIELDS.map((f) => (
                    <span key={f.key}>
                      {f.label.split(" (")[0]}: <span className="text-fg">{formatMoney(v[f.key], v.currency)}</span>
                      {f.key === "sourcingCost" ? <OriginalAmount amount={v.sourcingCostOriginal} currency={v.sourcingCurrency} rate={v.sourcingFxRate} /> : null}
                    </span>
                  ))}
                </div>
                {v.note ? <p className="mt-2 text-subtle">{v.note}</p> : null}
              </li>
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ProductsView() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const ws = useQuery(trpc.workspace.getCurrent.queryOptions());
  const products = useQuery(trpc.products.list.queryOptions({ includeInactive: true }));
  const canWrite = useCan("catalog.write");
  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<ProductRow | null>(null);
  const [versioning, setVersioning] = React.useState<ProductRow | null>(null);
  const del = useMutation(
    trpc.products.delete.mutationOptions({
      onSuccess: (r) => { qc.invalidateQueries({ queryKey: trpc.products.list.queryKey() }); toast("success", r.deleted ? "Product deleted" : "Product has order history, so it was deactivated instead"); },
      onError: (e) => toast("error", errorMessage(e)),
    }),
  );
  const currency = ws.data?.currency ?? "DZD";
  const rates: Rates = ws.data?.exchangeRates ?? {};

  return (
    <>
      <PageHeader
        title="Products & unit economics"
        description="Costs are versioned by effective date. Changing a price never rewrites historical profit."
        actions={canWrite ? <Button variant="primary" onClick={() => setCreating(true)}><Plus /> New product</Button> : null}
      />
      <Card>
        {products.error ? <ErrorState message={errorMessage(products.error)} /> : products.isLoading ? <Loading /> : !products.data?.length ? (
          <EmptyState icon={<Package />} title="No products yet" description="Add your products with sale price, sourcing cost and fees to unlock profit metrics." action={canWrite ? <Button variant="primary" onClick={() => setCreating(true)}><Plus /> New product</Button> : null} />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Product</Th>
                <Th>SKU</Th>
                <Th className="text-right">Sale price</Th>
                <Th className="text-right"><Term label="Sourcing" definition="Cost of goods per delivered unit (COGS)." /></Th>
                <Th className="text-right">Shipping</Th>
                <Th className="text-right"><Term label="RTO fee" definition="Fee charged by the carrier for each parcel returned to origin." /></Th>
                <Th className="text-right">Call center</Th>
                <Th className="text-right">Packaging</Th>
                <Th>Costs since</Th>
                <Th>Status</Th>
                <Th><span className="sr-only">Actions</span></Th>
              </tr>
            </THead>
            <tbody>
              {products.data.map((p) => (
                <Tr key={p.id}>
                  <Td className="font-medium">{p.name}</Td>
                  <Td className="font-mono text-xs text-muted">{p.sku}</Td>
                  {(["salePrice", "sourcingCost", "forwardShippingFee", "rtoFee", "callCenterFee", "packagingFee"] as const).map((k) => (
                    <Td key={k} className="num text-right">
                      {p.currentCost ? formatMoney(p.currentCost[k], p.currency) : "—"}
                      {k === "sourcingCost" && p.currentCost ? <OriginalAmount amount={p.currentCost.sourcingCostOriginal} currency={p.currentCost.sourcingCurrency} rate={p.currentCost.sourcingFxRate} /> : null}
                    </Td>
                  ))}
                  <Td className="text-xs text-muted">{p.currentCost ? formatDate(p.currentCost.effectiveFrom) : "—"} <span className="text-subtle">· v{p.versionCount}</span></Td>
                  <Td>{p.active ? <Badge tone="positive">Active</Badge> : <Badge>Inactive</Badge>}</Td>
                  <Td>
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" asChild><Link href={`/simulator?productId=${p.id}`} aria-label={`Breakeven simulator for ${p.name}`}><Calculator /></Link></Button>
                      <Button size="icon" variant="ghost" aria-label={`Cost versions for ${p.name}`} onClick={() => setVersioning(p)}><History /></Button>
                      {canWrite ? (
                        <>
                          <Button size="icon" variant="ghost" aria-label={`Edit ${p.name}`} onClick={() => setEditing(p)}><Pencil /></Button>
                          <Button size="icon" variant="ghost" aria-label={`Delete ${p.name}`} onClick={() => { if (confirm(`Delete ${p.name}? Products with orders are deactivated instead.`)) del.mutate({ id: p.id }); }}><Trash2 /></Button>
                        </>
                      ) : null}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {creating ? <ProductDialog open onOpenChange={setCreating} currency={currency} rates={rates} /> : null}
      {editing ? <ProductDialog product={editing} open onOpenChange={(o) => !o && setEditing(null)} currency={currency} rates={rates} /> : null}
      {versioning ? <CostVersionDialog product={versioning} open onOpenChange={(o) => !o && setVersioning(null)} rates={rates} /> : null}
    </>
  );
}
