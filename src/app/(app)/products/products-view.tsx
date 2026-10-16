"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator, History, Package, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { useMoney } from "@/components/app/currency";
import { CurrencyAmountInput, OriginalAmount, parseCurrencyAmount, rateInput, type CurrencyAmount, type Rates } from "@/components/app/currency-amount";
import { MoneyInput, minorToInput } from "@/components/app/money-input";
import { MoreDetailsButton, useMoreDetails } from "@/components/app/more-details";
import { OfferPicker } from "@/components/app/offer-picker";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { EmptyState, ErrorState, Loading } from "@/components/ui/states";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { HelpTip, Term } from "@/components/ui/tooltip";
import { parseToMinor } from "@/lib/money";
import { errorMessage, useTRPC } from "@/lib/trpc/client";
import { PHONE, useMedia } from "@/lib/use-media";
import { toDateInput } from "@/lib/utils";
import { useCan } from "@/components/app/use-can";
import { useT } from "@/i18n/client";
import { msg, type TFunction } from "@/i18n/core";
import { AdLinksPicker, type AdLinks } from "./ad-links";

const COST_FIELDS = [
  { key: "salePrice", label: msg("Sale price"), hint: msg("What the customer pays for one order, every piece of your offer included, without delivery"), help: msg("Used as the price of an order line that comes without one, and by the Profit tracker and Breakeven CPA. Profit counts the cash of delivered parcels. Example: 2900.") },
  { key: "sourcingCost", label: msg("Sourcing cost (COGS)"), hint: msg("Per piece. Pick the currency you pay your supplier in."), help: msg("What one piece costs you from the supplier. It counts for each delivered piece, free offer pieces included; returned pieces go back to stock. Example: 800.") },
  { key: "forwardShippingFee", label: msg("Forward shipping fee"), hint: msg("Per shipped parcel"), help: msg("What the carrier charges to deliver one parcel. Profit uses it when a parcel has no real fee from the carrier. Example: 600.") },
  { key: "rtoFee", label: msg("RTO fee"), hint: msg("Per returned parcel"), help: msg("What the carrier charges when a parcel comes back to you, on top of the shipping fee. Profit uses it when a parcel has no real return fee. Example: 200.") },
  { key: "callCenterFee", label: msg("Call-center fee"), hint: msg("Per call basis unit"), help: msg("What your call center charges. It counts per lead, per confirmed order or per call attempt, as set in Settings > Economics & currencies. Example: 100.") },
  { key: "packagingFee", label: msg("Packaging fee"), hint: msg("Per shipped parcel"), help: msg("Box, bag and label for one parcel. It counts on each shipped parcel once its delivery is finished. Example: 50.") },
] as const;
type CostKey = (typeof COST_FIELDS)[number]["key"];
type CostValues = Record<CostKey, number>;
/** Sourcing cost can be in any currency; the other fields are in the workspace currency. */
type CostForm = Record<Exclude<CostKey, "sourcingCost">, string> & { sourcing: CurrencyAmount };
type SourcingOriginal = { sourcingCostOriginal: number | null; sourcingCurrency: string | null; sourcingFxRate: number | null };

const emptyCost = (currency: string): CostForm => ({ salePrice: "", sourcing: { amount: "", currency, rate: "" }, forwardShippingFee: "", rtoFee: "", callCenterFee: "", packagingFee: "" });

function parseCost(form: CostForm, currency: string, t: TFunction) {
  const out = {} as CostValues;
  for (const f of COST_FIELDS) {
    if (f.key === "sourcingCost") continue;
    const minor = parseToMinor(form[f.key] || "0", currency);
    if (minor < 0) throw new Error(t("{field} cannot be negative", { field: t(f.label) }));
    out[f.key] = minor;
  }
  const sourcing = parseCurrencyAmount(form.sourcing, currency, t("Sourcing cost"), t);
  return { ...out, sourcingCost: sourcing.amount, sourcingCurrency: sourcing.currency, sourcingFxRate: sourcing.rate };
}

function CostFields({ value, onChange, currency, rates }: { value: CostForm; onChange: (v: CostForm) => void; currency: string; rates: Rates }) {
  const { t } = useT();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {COST_FIELDS.map((f) => (
        <Field key={f.key} label={t(f.label)} htmlFor={f.key} help={t(f.help)} hint={t(f.hint)}>
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
  /** Pieces one order sends: the product's offer. */
  piecesPerOrder: number;
  versionCount: number;
  linkedCampaigns: number;
  linkedAdAccounts: number;
  fromMdm: boolean;
  mdmProducts: { id: string; name: string | null }[];
  currentCost: (CostValues & SourcingOriginal & { effectiveFrom: Date }) | null;
};

function ProductDialog({ product, open, onOpenChange, currency, rates, products }: { product?: ProductRow; open: boolean; onOpenChange: (o: boolean) => void; currency: string; rates: Rates; products: { id: string; name: string }[] }) {
  const { t } = useT();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = React.useState(product?.name ?? "");
  const [sku, setSku] = React.useState(product?.sku ?? "");
  const [active, setActive] = React.useState(product?.active ?? true);
  const [pieces, setPieces] = React.useState(product?.piecesPerOrder ?? 1);
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
  const create = useMutation(trpc.products.create.mutationOptions({ onSuccess: () => { invalidate(); toast("success", t("Product created")); onOpenChange(false); }, onError: (e) => setError(errorMessage(e)) }));
  const update = useMutation(trpc.products.update.mutationOptions({ onSuccess: () => { invalidate(); toast("success", t("Product updated")); onOpenChange(false); }, onError: (e) => setError(errorMessage(e)) }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (product) update.mutate({ id: product.id, name, sku, active, piecesPerOrder: pieces, links: links ?? undefined });
      else create.mutate({ name, sku, active, piecesPerOrder: pieces, cost: parseCost(cost, currency, t), links: links ?? undefined });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={product ? t("Edit product") : t("New product")} description={product ? t("Cost assumptions are versioned separately so history is never overwritten.") : t("Set the price and costs. The first ones also count for orders placed before today.")} className="max-w-2xl">
        <form onSubmit={submit} className="flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("Product name")} htmlFor="pname" help={t("The name you know this product by. It shows on every page, and a new MDM product with the same name is linked to it.")}><Input id="pname" value={name} onChange={(e) => setName(e.target.value)} required /></Field>
            <Field label={t("SKU")} htmlFor="psku" help={t("A short code for the product: letters, digits, dot, dash or underscore. Imports and MDM match order lines to the product by this code. Example: NECK-01.")}><Input id="psku" value={sku} onChange={(e) => setSku(e.target.value)} required className="font-mono" /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-4 accent-[#e1182c]" /> {t("Active")}
            <HelpTip label={t("Active")}>{t("Untick it when you stop selling the product. It leaves the new order, simulator and import lists, but its past orders still count.")}</HelpTip>
          </label>
          <Field label={t("Offer")} htmlFor="poffer" help={t("Pick Buy 1, get 1 free when one order sends 2 pieces. When MDM lists fewer pieces than the offer, the offer's count is used.")} hint={t("How many pieces one order sends. Its sale price is for the whole order, and each piece's cost counts.")}>
            <OfferPicker id="poffer" value={pieces} onChange={setPieces} />
          </Field>
          {!product ? <CostFields value={cost} onChange={setCost} currency={currency} rates={rates} /> : null}
          <section className="flex flex-col gap-2 border-t border-border pt-4">
            <h3 className="text-sm font-medium"><Term label={t("Ads for this product")} definition={t("A campaign counts for one product only, and its own link wins over its ad account's. Ticking one here moves it from any other product.")} /></h3>
            <p className="text-xs text-muted">{t("Pick the ad accounts and campaigns that sell this product. Their spend and ads then count for it, so its profit and POAS use only its own ads. Orders keep the product they were placed for.")}</p>
            <AdLinksPicker productId={product?.id} value={links} onChange={setLinks} products={products} />
          </section>
          {error ? <p className="text-sm text-negative" role="alert">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>{t("Cancel")}</Button>
            <Button type="submit" variant="primary" disabled={create.isPending || update.isPending}>{product ? t("Save") : t("Create product")}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** New cost version for a product. Also opened from the Profit tracker, which passes `onSaved` to refresh itself. */
export function CostVersionDialog({ product, open, onOpenChange, rates, onSaved }: { product: ProductRow; open: boolean; onOpenChange: (o: boolean) => void; rates: Rates; onSaved?: () => void }) {
  const { t, date } = useT();
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
        toast("success", t("New cost version saved"));
        onSaved?.();
        onOpenChange(false);
      },
      onError: (e) => setError(errorMessage(e)),
    }),
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent side="right" title={t("Cost versions · {name}", { name: product.name })} description={t("A new version starts on its effective date and closes the previous one. Past orders keep the costs that applied when they were placed.")}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            try {
              mutation.mutate({ productId: product.id, effectiveFrom: new Date(`${effectiveFrom}T00:00:00Z`), note: note || undefined, cost: parseCost(cost, product.currency, t) });
            } catch (err) {
              setError((err as Error).message);
            }
          }}
          className="flex flex-col gap-4"
        >
          <Field label={t("Effective from")} htmlFor="eff" help={t("The first order date these costs apply to. It must be later than the start of the current version. Example: the day the supplier's new price starts.")}><Input id="eff" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} required /></Field>
          <CostFields value={cost} onChange={setCost} currency={product.currency} rates={rates} />
          <Field label={t("Note")} htmlFor="note" help={t("A reminder for you of why the costs changed. It shows only in the history below.")}><Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("e.g. Supplier price increase")} /></Field>
          {error ? <p className="text-sm text-negative" role="alert">{error}</p> : null}
          <div className="flex justify-end"><Button type="submit" variant="primary" disabled={mutation.isPending}>{t("Add cost version")}</Button></div>
        </form>
        <h3 className="mb-2 mt-8 text-xs font-medium uppercase tracking-wide text-subtle"><Term label={t("History")} definition={t("Every cost version of this product, newest first. Each order uses the version in effect on the day it was placed.")} /></h3>
        {details.isLoading ? <Loading /> : (
          <ol className="flex flex-col gap-2">
            {details.data?.costVersions.map((v) => (
              <li key={v.id} className="rounded-lg border border-border bg-surface-2 p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-fg">{t("{from} → {to}", { from: date(v.effectiveFrom), to: v.effectiveTo ? date(v.effectiveTo) : t("now") })}</span>
                  {v.effectiveTo === null ? <Badge tone="positive">{t("current")}</Badge> : <Badge>{t("closed")}</Badge>}
                </div>
                <div className="num mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-muted sm:grid-cols-3">
                  {COST_FIELDS.map((f) => (
                    <span key={f.key}>
                      {t(f.label.split(" (")[0])}: <span className="num text-fg">{money.fmt(v[f.key], v.currency)}</span>
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
  const { t } = useT();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery(trpc.products.mdmProducts.queryOptions());
  const move = useMutation(
    trpc.products.moveMdmProduct.mutationOptions({
      onSuccess: (r, v) => {
        qc.invalidateQueries({ queryKey: trpc.products.mdmProducts.queryKey() });
        qc.invalidateQueries({ queryKey: trpc.products.list.queryKey() });
        const to = products.find((p) => p.id === v.productId)?.name ?? t("the product");
        const moved = !r.moved ? t("Now counts as {product}.", { product: to }) : r.moved === 1 ? t("Now counts as {product}, with 1 order line.", { product: to }) : t("Now counts as {product}, with {n} order lines.", { product: to, n: r.moved });
        toast("success", r.removed ? `${moved} ${t("{n} had nothing left, so it was removed.", { n: r.removed })}` : moved);
      },
      onError: (e) => toast("error", errorMessage(e)),
    }),
  );
  if (!list.data?.length) return null;
  return (
    <Card className="mt-6">
      <div className="flex flex-col gap-1 border-b border-border p-4">
        <h2 className="text-base font-semibold"><Term label={t("Products from MDM")} definition={t("Linked by MDM's product ID, so renaming a product in MDM keeps it linked. A product the sync made that is left empty after a move is removed.")} /></h2>
        <p className="text-sm text-muted">{t("Each product MDM sends with your orders counts as one of your products. A new one gets its own product, marked From MDM. If two MDM products are really the same product, point both at it here; their orders move with them.")}</p>
      </div>
      <Table>
        <THead>
          <tr>
            <Th>{t("In MDM")}</Th>
            <Th className="text-end"><Term label={t("Units ordered")} definition={t("Pieces MDM listed on your order lines with this product, over all dates. Free offer pieces that MDM doesn't list are not included.")} /></Th>
            <Th><Term label={t("Counts as")} definition={t("The product whose costs and profit this MDM product's orders count for. Changing it moves its past order lines too.")} /></Th>
          </tr>
        </THead>
        <tbody>
          {list.data.map((m) => (
            <Tr key={m.id}>
              <Td>
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="font-medium">{m.name ?? t("No name")}</span>
                  <span className="font-mono text-[11px] text-subtle">{m.id}</span>
                </span>
              </Td>
              <Td className="num text-end">{m.units.toLocaleString("en-US")}</Td>
              <Td>
                {canWrite ? (
                  <Select aria-label={t("Product for {name}", { name: m.name ?? m.id })} value={m.productId} disabled={move.isPending} onChange={(e) => move.mutate({ mdmProductId: m.id, productId: e.target.value })} className="w-full sm:w-56">
                    {products.map((p) => <option key={p.id} value={p.id}>{p.active ? p.name : t("{name} (inactive)", { name: p.name })}</option>)}
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
  const { t, date } = useT();
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
      onSuccess: (r) => { qc.invalidateQueries({ queryKey: trpc.products.list.queryKey() }); toast("success", r.deleted ? t("Product deleted") : t("Product has order history, so it was deactivated instead")); },
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
        {p.fromMdm ? (
          <>
            <Badge tone="brand">{t("From MDM")}</Badge>
            <HelpTip label={t("From MDM")}>{t("The MDM sync made this product when MDM first sent it with your orders. Check its name and costs.")}</HelpTip>
          </>
        ) : null}
        {!p.currentCost ? (
          <>
            {canWrite ? (
              <button type="button" onClick={() => setVersioning(p)} className="rounded-full focus-visible:outline-2"><Badge tone="warning">{t("Needs details · add costs")}</Badge></button>
            ) : <Badge tone="warning">{t("Needs details")}</Badge>}
            <HelpTip label={t("Needs details")}>{t("It has no costs yet, so its orders count a product cost of 0 and the default fees in Settings > Economics & currencies. Add costs to see its real profit.")}</HelpTip>
          </>
        ) : null}
      </span>
      {p.mdmProducts.length ? (
        <span className="max-w-64 truncate text-[11px] text-subtle" title={p.mdmProducts.map((m) => `${m.name ?? m.id} (${m.id})`).join(", ")}>
          {t("In MDM: {names}", { names: p.mdmProducts.map((m) => m.name ?? m.id).join(", ") })}
        </span>
      ) : null}
    </span>
  );
  const adsLink = (p: ProductRow) =>
    p.linkedCampaigns || p.linkedAdAccounts ? (
      <Link href="/campaigns" className="hover:text-fg hover:underline">
        {[
          p.linkedAdAccounts ? (p.linkedAdAccounts === 1 ? t("1 ad account") : t("{n} ad accounts", { n: p.linkedAdAccounts })) : null,
          p.linkedCampaigns ? (p.linkedCampaigns === 1 ? t("1 campaign") : t("{n} campaigns", { n: p.linkedCampaigns })) : null,
        ].filter(Boolean).join(" · ")}
      </Link>
    ) : <span className="text-subtle">{t("Not linked")}</span>;
  const actions = (p: ProductRow) => (
    <div className="flex justify-end gap-1">
      <Button size="icon" variant="ghost" asChild><Link href={`/profit?productId=${p.id}#what-if`} aria-label={t("What if for {name}", { name: p.name })}><Calculator /></Link></Button>
      <Button size="icon" variant="ghost" aria-label={t("Cost versions for {name}", { name: p.name })} onClick={() => setVersioning(p)}><History /></Button>
      {canWrite ? (
        <>
          <Button size="icon" variant="ghost" aria-label={t("Edit {name}", { name: p.name })} onClick={() => setEditing(p)}><Pencil /></Button>
          <Button size="icon" variant="ghost" aria-label={t("Delete {name}", { name: p.name })} onClick={() => { if (confirm(t("Delete {name}? Products with orders are deactivated instead.", { name: p.name }))) del.mutate({ id: p.id }); }}><Trash2 /></Button>
        </>
      ) : null}
    </div>
  );
  const COSTS = [
    ["sourcingCost", msg("Sourcing")],
    ["forwardShippingFee", msg("Shipping")],
    ["rtoFee", msg("RTO fee")],
    ["callCenterFee", msg("Call center")],
    ["packagingFee", msg("Packaging")],
  ] as const;
  const COST_DEFS: Record<(typeof COSTS)[number][0] | "salePrice" | "ads", string> = {
    salePrice: msg("What the customer pays for one order, every piece of your offer included, without delivery"),
    sourcingCost: msg("Cost of goods per delivered unit (COGS)."),
    forwardShippingFee: msg("Forward shipping fee per shipped parcel, from the current cost version. A parcel's real carrier fee wins when known."),
    rtoFee: msg("Fee charged by the carrier for each parcel returned to origin."),
    callCenterFee: msg("Call-center fee from the current cost version, counted per lead, confirmed order or call attempt as set in Settings > Economics & currencies."),
    packagingFee: msg("Packaging fee per shipped parcel, from the current cost version."),
    ads: msg("Campaigns and whole ad accounts linked to this product. Edit the product to change them, or link campaigns on the Campaigns page."),
  };

  return (
    <>
      <PageHeader
        title={t("Products & unit economics")}
        description={t("What each product sells for and costs. A new price counts from its day on, never for past orders.")}
        actions={canWrite ? <Button variant="primary" onClick={() => setCreating(true)}><Plus /> {t("New product")}</Button> : null}
      />
      <Card>
        {products.data?.length ? (
          <div className="flex justify-end px-3 pt-3">
            <MoreDetailsButton open={more} onToggle={setMore} what="details" />
          </div>
        ) : null}
        {products.error ? <ErrorState message={errorMessage(products.error)} /> : products.isLoading ? <Loading /> : !products.data?.length ? (
          <EmptyState icon={<Package />} title={t("No products yet")} description={t("Products MDM sends with your orders appear here after a sync. You can also add one by hand. Then enter each product's costs to unlock profit.")} action={canWrite ? <Button variant="primary" onClick={() => setCreating(true)}><Plus /> {t("New product")}</Button> : null} />
        ) : phone ? (
          <ul aria-label={t("Products")} className="flex flex-col gap-2 p-3">
            {products.data.map((p) => (
              <li key={p.id} className="rounded-2xl bg-surface-2 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">{nameBlock(p)}</div>
                  <span className="num shrink-0 text-sm font-bold">{p.currentCost ? money.fmt(p.currentCost.salePrice, p.currency) : "—"}</span>
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-subtle">
                  <span className="font-mono">{p.sku}</span>
                  {p.active ? <Badge tone="positive">{t("Active")}</Badge> : <Badge>{t("Inactive")}</Badge>}
                  {p.currentCost ? <span>{t("Costs since {date} · v{n}", { date: date(p.currentCost.effectiveFrom), n: p.versionCount })}</span> : null}
                </p>
                {p.currentCost ? (
                  <dl className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2">
                    {COSTS.map(([k, label]) => (
                      <div key={k} className="min-w-0">
                        <dt className="text-[11px] text-muted"><Term label={t(label)} definition={t(COST_DEFS[k])} /></dt>
                        <dd className="num truncate text-[13px] font-semibold">{money.fmt(p.currentCost![k], p.currency)}</dd>
                      </div>
                    ))}
                    <div className="min-w-0">
                      <dt className="text-[11px] text-muted"><Term label={t("Ads")} definition={t(COST_DEFS.ads)} /></dt>
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
                <Th>{t("Product")}</Th>
                {more ? <Th>{t("SKU")}</Th> : null}
                <Th className="text-end"><Term label={t("Sale price")} definition={t(COST_DEFS.salePrice)} /></Th>
                <Th className="text-end"><Term label={t("Sourcing")} definition={t(COST_DEFS.sourcingCost)} /></Th>
                {more ? (
                  <>
                    <Th className="text-end"><Term label={t("Shipping")} definition={t(COST_DEFS.forwardShippingFee)} /></Th>
                    <Th className="text-end"><Term label={t("RTO fee")} definition={t(COST_DEFS.rtoFee)} /></Th>
                    <Th className="text-end"><Term label={t("Call center")} definition={t(COST_DEFS.callCenterFee)} /></Th>
                    <Th className="text-end"><Term label={t("Packaging")} definition={t(COST_DEFS.packagingFee)} /></Th>
                  </>
                ) : null}
                <Th><Term label={t("Ads")} definition={t(COST_DEFS.ads)} /></Th>
                {more ? <Th><Term label={t("Costs since")} definition={t("The day the current costs started, and how many cost versions the product has (v2 = 2 versions).")} /></Th> : null}
                <Th>{t("Status")}</Th>
                <Th><span className="sr-only">{t("Actions")}</span></Th>
              </tr>
            </THead>
            <tbody>
              {products.data.map((p) => (
                <Tr key={p.id}>
                  <Td>{nameBlock(p)}</Td>
                  {more ? <Td className="font-mono text-xs text-muted">{p.sku}</Td> : null}
                  {(more ? (["salePrice", "sourcingCost", "forwardShippingFee", "rtoFee", "callCenterFee", "packagingFee"] as const) : (["salePrice", "sourcingCost"] as const)).map((k) => (
                    <Td key={k} className="num text-end">
                      {p.currentCost ? money.fmt(p.currentCost[k], p.currency) : "—"}
                      {k === "sourcingCost" && p.currentCost ? <OriginalAmount amount={p.currentCost.sourcingCostOriginal} currency={p.currentCost.sourcingCurrency} rate={p.currentCost.sourcingFxRate} /> : null}
                    </Td>
                  ))}
                  <Td className="text-xs text-muted">{adsLink(p)}</Td>
                  {more ? <Td className="text-xs text-muted">{p.currentCost ? date(p.currentCost.effectiveFrom) : "—"} <span className="text-subtle">· {t("v{n}", { n: p.versionCount })}</span></Td> : null}
                  <Td>{p.active ? <Badge tone="positive">{t("Active")}</Badge> : <Badge>{t("Inactive")}</Badge>}</Td>
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
