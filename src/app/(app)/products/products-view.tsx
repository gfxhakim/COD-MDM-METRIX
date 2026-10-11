"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator, History, Package, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { useMoney } from "@/components/app/currency";
import { CurrencyAmountInput, OriginalAmount, parseCurrencyAmount, rateInput, type CurrencyAmount, type Rates } from "@/components/app/currency-amount";
import { MoneyInput, minorToInput } from "@/components/app/money-input";
import { MoreDetailsButton, useMoreDetails } from "@/components/app/more-details";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { EmptyState, ErrorState, Loading } from "@/components/ui/states";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { Term } from "@/components/ui/tooltip";
import { parseToMinor } from "@/lib/money";
import { errorMessage, useTRPC } from "@/lib/trpc/client";
import { PHONE, useMedia } from "@/lib/use-media";
import { formatDate, toDateInput } from "@/lib/utils";
import { useCan } from "@/components/app/use-can";
import { AdLinksPicker, type AdLinks } from "./ad-links";

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

export type ProductRow = {
  id: string;
  name: string;
  sku: string;
  currency: string;
  active: boolean;
  versionCount: number;
  linkedCampaigns: number;
  linkedAdAccounts: number;
  fromMdm: boolean;
  mdmProducts: { id: string; name: string | null }[];
  currentCost: (CostValues & SourcingOriginal & { effectiveFrom: Date }) | null;
};

function ProductDialog({ product, open, onOpenChange, currency, rates, products }: { product?: ProductRow; open: boolean; onOpenChange: (o: boolean) => void; currency: string; rates: Rates; products: { id: string; name: string }[] }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = React.useState(product?.name ?? "");
  const [sku, setSku] = React.useState(product?.sku ?? "");
  const [active, setActive] = React.useState(product?.active ?? true);
  const [cost, setCost] = React.useState<CostForm>(() => emptyCost(currency));
  const [links, setLinks] = React.useState<AdLinks | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: trpc.products.list.queryKey() });
    if (links) {
      qc.invalidateQueries({ queryKey: trpc.campaigns.links.queryKey() });
      qc.invalidateQueries({ queryKey: trpc.campaigns.report.queryKey() });
    }
  };
  const create = useMutation(trpc.products.create.mutationOptions({ onSuccess: () => { invalidate(); toast("success", "Product created"); onOpenChange(false); }, onError: (e) => setError(errorMessage(e)) }));
  const update = useMutation(trpc.products.update.mutationOptions({ onSuccess: () => { invalidate(); toast("success", "Product updated"); onOpenChange(false); }, onError: (e) => setError(errorMessage(e)) }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (product) update.mutate({ id: product.id, name, sku, active, links: links ?? undefined });
      else create.mutate({ name, sku, active, cost: parseCost(cost, currency), links: links ?? undefined });
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
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-4 accent-[#e1182c]" /> Active
          </label>
          {!product ? <CostFields value={cost} onChange={setCost} currency={currency} rates={rates} /> : null}
          <section className="flex flex-col gap-2 border-t border-border pt-4">
            <h3 className="text-sm font-medium">Ads for this product</h3>
            <p className="text-xs text-muted">Pick the ad accounts and campaigns that sell this product. Their spend and ads then count for it, so its profit and POAS use only its own ads. Orders keep the product they were placed for.</p>
            <AdLinksPicker productId={product?.id} value={links} onChange={setLinks} products={products} />
          </section>
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

/** New cost version for a product. Also opened from the Profit tracker, which passes `onSaved` to refresh itself. */
export function CostVersionDialog({ product, open, onOpenChange, rates, onSaved }: { product: ProductRow; open: boolean; onOpenChange: (o: boolean) => void; rates: Rates; onSaved?: () => void }) {
  const money = useMoney();
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
        onSaved?.();
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
                      {f.label.split(" (")[0]}: <span className="text-fg">{money.fmt(v[f.key], v.currency)}</span>
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

/** The products MDM sends with orders, and the product each one counts as. */
function MdmProducts({ products, canWrite }: { products: ProductRow[]; canWrite: boolean }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery(trpc.products.mdmProducts.queryOptions());
  const move = useMutation(
    trpc.products.moveMdmProduct.mutationOptions({
      onSuccess: (r, v) => {
        qc.invalidateQueries({ queryKey: trpc.products.mdmProducts.queryKey() });
        qc.invalidateQueries({ queryKey: trpc.products.list.queryKey() });
        const to = products.find((p) => p.id === v.productId)?.name ?? "the product";
        toast("success", `Now counts as ${to}${r.moved ? `, with ${r.moved} order line${r.moved === 1 ? "" : "s"}` : ""}.${r.removed ? ` ${r.removed} had nothing left, so it was removed.` : ""}`);
      },
      onError: (e) => toast("error", errorMessage(e)),
    }),
  );
  if (!list.data?.length) return null;
  return (
    <Card className="mt-6">
      <div className="flex flex-col gap-1 border-b border-border p-4">
        <h2 className="text-base font-semibold">Products from MDM</h2>
        <p className="text-sm text-muted">Each product MDM sends with your orders counts as one of your products. A new one gets its own product, marked From MDM. If two MDM products are really the same product, point both at it here; their orders move with them.</p>
      </div>
      <Table>
        <THead>
          <tr>
            <Th>In MDM</Th>
            <Th className="text-right">Units ordered</Th>
            <Th>Counts as</Th>
          </tr>
        </THead>
        <tbody>
          {list.data.map((m) => (
            <Tr key={m.id}>
              <Td>
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="font-medium">{m.name ?? "No name"}</span>
                  <span className="font-mono text-[11px] text-subtle">{m.id}</span>
                </span>
              </Td>
              <Td className="num text-right">{m.units.toLocaleString("en-US")}</Td>
              <Td>
                {canWrite ? (
                  <Select aria-label={`Product for ${m.name ?? m.id}`} value={m.productId} disabled={move.isPending} onChange={(e) => move.mutate({ mdmProductId: m.id, productId: e.target.value })} className="w-full sm:w-56">
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.active ? "" : " (inactive)"}</option>)}
                  </Select>
                ) : (products.find((p) => p.id === m.productId)?.name ?? "—")}
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

export function ProductsView() {
  const money = useMoney();
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
  // Phones get one card per product instead of a twelve-column table.
  const phone = useMedia(PHONE);
  const [more, setMore] = useMoreDetails("products");

  const nameBlock = (p: ProductRow) => (
    <span className="flex min-w-0 flex-col gap-1">
      <span className="flex flex-wrap items-center gap-1.5 font-medium">
        {p.name}
        {p.fromMdm ? <Badge tone="brand">From MDM</Badge> : null}
        {!p.currentCost ? (
          canWrite ? (
            <button type="button" onClick={() => setVersioning(p)} className="rounded-full focus-visible:outline-2"><Badge tone="warning">Needs details · add costs</Badge></button>
          ) : <Badge tone="warning">Needs details</Badge>
        ) : null}
      </span>
      {p.mdmProducts.length ? (
        <span className="max-w-64 truncate text-[11px] text-subtle" title={p.mdmProducts.map((m) => `${m.name ?? m.id} (${m.id})`).join(", ")}>
          In MDM: {p.mdmProducts.map((m) => m.name ?? m.id).join(", ")}
        </span>
      ) : null}
    </span>
  );
  const adsLink = (p: ProductRow) =>
    p.linkedCampaigns || p.linkedAdAccounts ? (
      <Link href="/campaigns" className="hover:text-fg hover:underline">
        {[p.linkedAdAccounts ? `${p.linkedAdAccounts} ad account${p.linkedAdAccounts === 1 ? "" : "s"}` : null, p.linkedCampaigns ? `${p.linkedCampaigns} campaign${p.linkedCampaigns === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ")}
      </Link>
    ) : <span className="text-subtle">Not linked</span>;
  const actions = (p: ProductRow) => (
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
  );
  const COSTS = [
    ["sourcingCost", "Sourcing"],
    ["forwardShippingFee", "Shipping"],
    ["rtoFee", "RTO fee"],
    ["callCenterFee", "Call center"],
    ["packagingFee", "Packaging"],
  ] as const;

  return (
    <>
      <PageHeader
        title="Products & unit economics"
        description="What each product sells for and costs. A new price counts from its day on, never for past orders."
        actions={canWrite ? <Button variant="primary" onClick={() => setCreating(true)}><Plus /> New product</Button> : null}
      />
      <Card>
        {products.data?.length ? (
          <div className="flex justify-end px-3 pt-3">
            <MoreDetailsButton open={more} onToggle={setMore} what="details" />
          </div>
        ) : null}
        {products.error ? <ErrorState message={errorMessage(products.error)} /> : products.isLoading ? <Loading /> : !products.data?.length ? (
          <EmptyState icon={<Package />} title="No products yet" description="Products MDM sends with your orders appear here after a sync. You can also add one by hand. Then enter each product's costs to unlock profit." action={canWrite ? <Button variant="primary" onClick={() => setCreating(true)}><Plus /> New product</Button> : null} />
        ) : phone ? (
          <ul aria-label="Products" className="flex flex-col gap-2 p-3">
            {products.data.map((p) => (
              <li key={p.id} className="rounded-2xl bg-surface-2 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">{nameBlock(p)}</div>
                  <span className="num shrink-0 text-sm font-bold">{p.currentCost ? money.fmt(p.currentCost.salePrice, p.currency) : "—"}</span>
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-subtle">
                  <span className="font-mono">{p.sku}</span>
                  {p.active ? <Badge tone="positive">Active</Badge> : <Badge>Inactive</Badge>}
                  {p.currentCost ? <span>Costs since {formatDate(p.currentCost.effectiveFrom)} · v{p.versionCount}</span> : null}
                </p>
                {p.currentCost ? (
                  <dl className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2">
                    {COSTS.map(([k, label]) => (
                      <div key={k} className="min-w-0">
                        <dt className="text-[11px] text-muted">{label}</dt>
                        <dd className="num truncate text-[13px] font-semibold">{money.fmt(p.currentCost![k], p.currency)}</dd>
                      </div>
                    ))}
                    <div className="min-w-0">
                      <dt className="text-[11px] text-muted">Ads</dt>
                      <dd className="truncate text-[13px] font-semibold">{adsLink(p)}</dd>
                    </div>
                  </dl>
                ) : null}
                <div className="mt-2 border-t border-border pt-2">{actions(p)}</div>
              </li>
            ))}
          </ul>
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Product</Th>
                {more ? <Th>SKU</Th> : null}
                <Th className="text-right">Sale price</Th>
                <Th className="text-right"><Term label="Sourcing" definition="Cost of goods per delivered unit (COGS)." /></Th>
                {more ? (
                  <>
                    <Th className="text-right">Shipping</Th>
                    <Th className="text-right"><Term label="RTO fee" definition="Fee charged by the carrier for each parcel returned to origin." /></Th>
                    <Th className="text-right">Call center</Th>
                    <Th className="text-right">Packaging</Th>
                  </>
                ) : null}
                <Th><Term label="Ads" definition="Campaigns and whole ad accounts linked to this product. Edit the product to change them, or link campaigns on the Campaigns page." /></Th>
                {more ? <Th>Costs since</Th> : null}
                <Th>Status</Th>
                <Th><span className="sr-only">Actions</span></Th>
              </tr>
            </THead>
            <tbody>
              {products.data.map((p) => (
                <Tr key={p.id}>
                  <Td>{nameBlock(p)}</Td>
                  {more ? <Td className="font-mono text-xs text-muted">{p.sku}</Td> : null}
                  {(more ? (["salePrice", "sourcingCost", "forwardShippingFee", "rtoFee", "callCenterFee", "packagingFee"] as const) : (["salePrice", "sourcingCost"] as const)).map((k) => (
                    <Td key={k} className="num text-right">
                      {p.currentCost ? money.fmt(p.currentCost[k], p.currency) : "—"}
                      {k === "sourcingCost" && p.currentCost ? <OriginalAmount amount={p.currentCost.sourcingCostOriginal} currency={p.currentCost.sourcingCurrency} rate={p.currentCost.sourcingFxRate} /> : null}
                    </Td>
                  ))}
                  <Td className="text-xs text-muted">{adsLink(p)}</Td>
                  {more ? <Td className="text-xs text-muted">{p.currentCost ? formatDate(p.currentCost.effectiveFrom) : "—"} <span className="text-subtle">· v{p.versionCount}</span></Td> : null}
                  <Td>{p.active ? <Badge tone="positive">Active</Badge> : <Badge>Inactive</Badge>}</Td>
                  <Td>{actions(p)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {more ? <MdmProducts products={products.data ?? []} canWrite={canWrite} /> : null}
      {creating ? <ProductDialog open onOpenChange={setCreating} currency={currency} rates={rates} products={products.data ?? []} /> : null}
      {editing ? <ProductDialog product={editing} open onOpenChange={(o) => !o && setEditing(null)} currency={currency} rates={rates} products={products.data ?? []} /> : null}
      {versioning ? <CostVersionDialog product={versioning} open onOpenChange={(o) => !o && setVersioning(null)} rates={rates} /> : null}
    </>
  );
}
