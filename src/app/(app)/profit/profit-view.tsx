"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Lock, PackageOpen } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { AdsFilter, useAdsFilter } from "@/components/app/ads-filter";
import { useMoney } from "@/components/app/currency";
import { PageHeader } from "@/components/app/page-header";
import { useCan } from "@/components/app/use-can";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Chip } from "@/components/ui/choice";
import { Input, Select } from "@/components/ui/form";
import { EmptyState, ErrorState, Loading } from "@/components/ui/states";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { Term } from "@/components/ui/tooltip";
import { offerLabel } from "@/domain/offers";
import { useT } from "@/i18n/client";
import { RANGES, rangeDays, todayIn, type RangeKey } from "@/lib/dateRanges";
import { errorMessage, useTRPC } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { CostVersionDialog } from "../products/products-view";
import { ProductProfit, productLine } from "./product-view";
import { useAdMoney, type Tracker } from "./shared";

// ─────────────────────────── Every product ───────────────────────────

function ProductsOverview({ data, selected, onSelect }: { data: Tracker; selected: string; onSelect: (id: string) => void }) {
  const { t } = useT();
  const money = useMoney();
  const ad = useAdMoney(data.currency);
  const fmt = (v: number) => money.fmt(v, data.currency, { decimals: false });
  const rows = data.products.map((p) => ({ p, ...productLine(p) }));
  const defs = {
    total: t("The orders placed in these days: their real profit plus what their orders not finished yet should still bring."),
    perDelivered: t("What one delivered order really leaves you: its price − the product, delivery, calls, the ads it took and its share of returned and lost parcels. Before your expenses."),
    perOrder: t("What Meta cost for each order placed: the ad spend of the campaigns linked to this product ÷ its orders placed."),
  };
  const badges = (p: Tracker["products"][number]) => (
    <>
      {p.inputs.costPerPiece.source === "none" ? <Badge tone="warning">{t("Needs its cost")}</Badge> : null}
      {!p.adsLinked ? <Badge tone="warning">{t("No ads linked")}</Badge> : null}
    </>
  );
  return (
    <Card className="min-w-0">
      <CardHeader title={t("Your products")} help={t("One row per product, with the same numbers as its own page below. Tap a product to open it.")} description={t("Each product's profit of these days, what a delivered order leaves you and what Meta costs per order.")} />
      <div className="hidden px-2 pb-3 md:block">
        <Table>
          <THead>
            <tr>
              <Th>{t("Product")}</Th>
              <Th>{t("Offer")}</Th>
              <Th className="text-end"><Term label={t("Profit of these days")} definition={defs.total} /></Th>
              <Th className="text-end"><Term label={t("Per delivered order")} definition={defs.perDelivered} /></Th>
              <Th className="text-end"><Term label={t("Meta per order")} definition={defs.perOrder} /></Th>
            </tr>
          </THead>
          <tbody>
            {rows.map(({ p, input, result: r, total }) => (
              <Tr key={p.id} className={cn("cursor-pointer", selected === p.id && "bg-brand-soft/60")} onClick={() => onSelect(p.id)}>
                <Td className="whitespace-normal">
                  <button type="button" className="text-start font-semibold hover:text-brand-strong" aria-pressed={selected === p.id} onClick={(e) => { e.stopPropagation(); onSelect(p.id); }}>{p.name}</button>
                  <span className="mt-0.5 flex flex-wrap gap-1">{badges(p)}</span>
                </Td>
                <Td className="text-[13px] text-muted">{offerLabel(input.pieces, t)}</Td>
                <Td className={cn("num text-end font-bold", total < 0 ? "text-negative" : "text-positive")}>{fmt(total)}</Td>
                <Td className={cn("num text-end font-semibold", r.ok && r.profit < 0 && "text-negative")} title={r.ok ? undefined : t(r.reason)}>{r.ok ? fmt(r.profit) : "—"}</Td>
                <Td className="num text-end">{input.adCostPerOrder !== null ? ad.fmtAd(input.adCostPerOrder) : <span className="text-xs font-semibold text-subtle">{p.adsLinked ? "—" : t("Link ads")}</span>}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </div>
      <ul className="flex flex-col gap-2 px-4 pb-4 md:hidden">
        {rows.map(({ p, input, result: r, total }) => (
          <li key={p.id}>
            <button type="button" aria-pressed={selected === p.id} onClick={() => onSelect(p.id)} className={cn("press flex w-full min-w-0 flex-col gap-2 rounded-2xl p-3 text-start", selected === p.id ? "bg-brand-soft ring-1 ring-brand/30" : "bg-surface-2")}>
              <span className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">{p.name}{badges(p)}</span>
              <span className="grid grid-cols-3 gap-2 text-[11px] text-subtle">
                <span className="min-w-0">{t("These days")}<b className={cn("num block truncate text-[13px]", total < 0 ? "text-negative" : "text-positive")}>{fmt(total)}</b></span>
                <span className="min-w-0">{t("Per delivered")}<b className={cn("num block truncate text-[13px] text-fg", r.ok && r.profit < 0 && "text-negative")}>{r.ok ? fmt(r.profit) : "—"}</b></span>
                <span className="min-w-0">{t("Meta per order")}<b className="num block truncate text-[13px] text-fg">{input.adCostPerOrder !== null ? ad.fmtAd(input.adCostPerOrder) : "—"}</b></span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * Ad spend counts for a product only through a campaign (or ad account) someone linked to it.
 * What nobody linked is listed here with a product picker per campaign, so it can be linked at once.
 */
function UnlinkedAds({ data, canLink }: { data: Tracker; canLink: boolean }) {
  const { t, tx } = useT();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const money = useMoney();
  const fmt = (v: number) => money.fmt(v, data.currency, { decimals: false });
  const [all, setAll] = React.useState(false);
  const link = useMutation(
    trpc.campaigns.setProduct.mutationOptions({
      onSuccess: async (_r, vars) => {
        await Promise.all([qc.invalidateQueries({ queryKey: trpc.profit.pathKey() }), qc.invalidateQueries({ queryKey: trpc.campaigns.pathKey() })]);
        const product = data.products.find((p) => p.id === vars.productId);
        toast("success", product ? t("Its ad spend now counts for {name}", { name: product.name }) : t("Campaign unlinked"));
      },
      onError: (e) => toast("error", errorMessage(e)),
    }),
  );
  const { total, campaigns, other } = data.unlinked;
  if (total <= 0) return null;
  const campaignsLink = <Link href="/campaigns" className="font-semibold text-brand-strong hover:underline">{t("Campaigns")}</Link>;
  const shown = all ? campaigns : campaigns.slice(0, 5);
  return (
    <Card className="min-w-0 border border-warning/30">
      <CardHeader
        title={<span className="inline-flex items-center gap-2"><AlertTriangle className="size-4 text-warning" aria-hidden="true" />{t("Ads not linked to a product")}</span>}
        help={t("Ad spend counts for a product only through a campaign or ad account linked to it. This lists the spend linked to none, so you can link it.")}
        description={
          campaigns.length
            ? t("{amount} of ad spend counts for no product, so no product's profit includes it. Your business's total profit still does. Pick the product each campaign sells.", { amount: fmt(total) })
            : t("{amount} of ad spend counts for no product, so no product's profit includes it. Your business's total profit still does.", { amount: fmt(total) })
        }
      />
      <ul className="flex flex-col gap-2 px-4 pb-4">
        {shown.map((c) => (
          <li key={c.id} className="flex flex-col gap-2 rounded-2xl bg-surface-2 p-3 sm:flex-row sm:items-center">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{c.name}</span>
              <span className="num text-xs text-muted">{t("{amount} spent", { amount: fmt(c.spend) })}</span>
            </span>
            {canLink ? (
              <Select aria-label={t("Product for {name}", { name: c.name })} value="" disabled={link.isPending} onChange={(e) => e.target.value && link.mutate({ id: c.id, productId: e.target.value })} className="h-9 w-full text-sm sm:w-56">
                <option value="">{t("Link to a product…")}</option>
                {data.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            ) : null}
          </li>
        ))}
        {campaigns.length > 5 ? (
          <li><Button size="sm" variant="ghost" onClick={() => setAll((v) => !v)}>{all ? t("Show fewer") : t("Show all {n} campaigns", { n: campaigns.length })}</Button></li>
        ) : null}
        {other > 0 ? (
          <li className="text-xs text-subtle">
            {campaigns.length
              ? t("{amount} more comes from ads with no known campaign, such as imported rows without a campaign ID, so it can't be linked here.", { amount: fmt(other) })
              : t("{amount} comes from ads with no known campaign, such as imported rows without a campaign ID, so it can't be linked here.", { amount: fmt(other) })}
          </li>
        ) : null}
        <li className="text-xs text-subtle">
          {canLink
            ? tx("You can also link a whole ad account, or several campaigns at once, in {campaigns}.", { campaigns: campaignsLink })
            : tx("The owner or an admin can link them in {campaigns}.", { campaigns: campaignsLink })}
        </li>
      </ul>
    </Card>
  );
}

// ─────────────────────────── Page ───────────────────────────

export function ProfitView({ initialProductId }: { initialProductId: string }) {
  const { t } = useT();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const workspace = useQuery(trpc.workspace.getCurrent.queryOptions());
  const canRead = useCan("money.read");
  const canEdit = useCan("catalog.write");
  const [range, setRange] = React.useState<RangeKey>("30d");
  const [custom, setCustom] = React.useState({ from: "", to: "" });
  const timezone = workspace.data?.timezone ?? "Africa/Algiers";
  const days = rangeDays(range, todayIn(timezone), custom);
  const bad = !!days.from && !!days.to && days.from > days.to;
  const ads = useAdsFilter().filter;
  const tracker = useQuery({ ...trpc.profit.tracker.queryOptions({ ...days, ads }), enabled: canRead && !bad, placeholderData: keepPreviousData });
  const products = useQuery({ ...trpc.products.list.queryOptions(), enabled: canEdit });
  const [picked, setPicked] = React.useState(initialProductId);
  const [editing, setEditing] = React.useState(false);
  const detailRef = React.useRef<HTMLDivElement>(null);

  const data = tracker.data;
  const selected = data?.products.find((p) => p.id === picked) ?? data?.products[0] ?? null;
  const editRow = products.data?.find((p) => p.id === selected?.id) ?? null;

  // Opened at #what-if (from Products, or the old simulator address): go there once the numbers are in.
  const scrolled = React.useRef(false);
  React.useEffect(() => {
    if (!data || scrolled.current || window.location.hash !== "#what-if") return;
    scrolled.current = true;
    requestAnimationFrame(() => document.getElementById("what-if")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [data]);

  const select = (id: string) => {
    setPicked(id);
    requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  if (workspace.data && !canRead) {
    return (
      <>
        <PageHeader title={t("Profit tracker")} />
        <Card><EmptyState icon={<Lock className="size-6" />} title={t("Owners, admins and analysts see this page")} description={t("Ask the owner of this business if you need to see its profit.")} /></Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t("Profit tracker")}
        description={t("What your orders of these days really leave you, what one delivered order earns, and what Meta can cost before you lose money.")}
        actions={
          data && data.products.length > 1 ? (
            <Select aria-label={t("Product")} value={selected?.id ?? ""} onChange={(e) => select(e.target.value)} className="w-full sm:w-56">
              {data.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          ) : undefined
        }
      />
      <div className="mb-5 flex flex-col gap-2">
        <span className="text-xs font-semibold text-muted"><Term label={t("Orders placed in")} definition={t("Only orders placed in these days, and the ad spend of these days, count. Rates come from these days once enough of their parcels have finished, else from all your orders.")} /></span>
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {RANGES.map((r) => <Chip key={r.key} active={range === r.key} onClick={() => setRange(r.key)} className="shrink-0">{t(r.label)}</Chip>)}
        </div>
        {range === "custom" ? (
          <div className="grid grid-cols-2 gap-2 sm:max-w-sm">
            <Input type="date" aria-label={t("From")} value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
            <Input type="date" aria-label={t("To")} value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
          </div>
        ) : null}
        {bad ? <p className="text-sm text-negative">{t("The start day must be before the end day.")}</p> : null}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
          <AdsFilter />
          {ads ? <span className="text-xs text-muted">{t("Only the orders and ad spend of these ads count.")}</span> : null}
        </div>
      </div>

      {tracker.isError ? (
        <ErrorState message={errorMessage(tracker.error)} />
      ) : !data ? (
        <Loading label={t("Loading your products")} />
      ) : data.products.length === 0 ? (
        <Card>
          <EmptyState icon={<PackageOpen className="size-6" />} title={t("No products yet")} description={t("Products appear here once MDM sends orders, or when you add one.")} action={<Button asChild variant="primary"><Link href="/products">{t("Open Products")}</Link></Button>} />
        </Card>
      ) : (
        <div className="flex min-w-0 flex-col gap-[18px]">
          {data.demo ? <div><Badge tone="brand">{t("Demo data")}</Badge></div> : null}
          <UnlinkedAds data={data} canLink={canEdit} />
          {data.products.length > 1 ? <ProductsOverview data={data} selected={selected?.id ?? ""} onSelect={select} /> : null}
          <div ref={detailRef} className="scroll-mt-24">
            {selected ? <ProductProfit key={selected.id} row={selected} data={data} canEdit={canEdit && !!editRow} onEditDetails={() => setEditing(true)} days={days} /> : null}
          </div>
        </div>
      )}
      {editing && editRow ? (
        <CostVersionDialog product={editRow} open onOpenChange={setEditing} rates={workspace.data?.exchangeRates ?? {}} onSaved={() => qc.invalidateQueries({ queryKey: trpc.profit.pathKey() })} />
      ) : null}
    </>
  );
}
