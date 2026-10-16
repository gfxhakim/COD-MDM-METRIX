"use client";

import type { NormalizedStatus, OrderStatus } from "@prisma/client";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, ClipboardList, Download, Plus, Search } from "lucide-react";
import * as React from "react";
import { useMoney } from "@/components/app/currency";
import { AdsFilter, useAdsFilter } from "@/components/app/ads-filter";
import { MoreDetailsButton, useMoreDetails } from "@/components/app/more-details";
import { PageHeader } from "@/components/app/page-header";
import { OrderStatusBadge, ParcelStatusBadge } from "@/components/app/status";
import { Badge } from "@/components/ui/badge";
import { useCan } from "@/components/app/use-can";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { EmptyState, ErrorState, Loading } from "@/components/ui/states";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { HelpTip } from "@/components/ui/tooltip";
import { wilayaLabel } from "@/domain/wilayas";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/core";
import { errorMessage, useTRPC } from "@/lib/trpc/client";
import { PHONE, useMedia } from "@/lib/use-media";
import { ExportPanel, PrintSheet, SOURCE_WORD, type PrintData } from "./export-panel";
import { OrderDrawer } from "./order-drawer";
import { NewOrderDialog } from "./new-order-dialog";

const PARCEL_STATUSES: NormalizedStatus[] = ["PENDING", "CONFIRMED", "SHIPPED", "DELIVERED", "RETURNED", "LOST", "CANCELED", "EXCHANGED", "UNKNOWN"];
const ORDER_STATUSES: OrderStatus[] = ["PENDING", "CONFIRMED", "CANCELED"];
/** The statuses as the filter menus write them (lowercase). */
const ORDER_STATUS_WORD: Record<OrderStatus, string> = { PENDING: msg("pending"), CONFIRMED: msg("confirmed"), CANCELED: msg("canceled") };
const PARCEL_STATUS_WORD: Record<NormalizedStatus, string> = {
  PENDING: msg("pending"),
  CONFIRMED: msg("confirmed"),
  SHIPPED: msg("shipped"),
  DELIVERED: msg("delivered"),
  RETURNED: msg("returned"),
  LOST: msg("lost"),
  CANCELED: msg("canceled"),
  EXCHANGED: msg("exchanged"),
  UNKNOWN: msg("unknown"),
};

export function OrdersView({ initialParcelStatus }: { initialParcelStatus?: NormalizedStatus }) {
  const { t, date, ago } = useT();
  const money = useMoney();
  const trpc = useTRPC();
  const canWrite = useCan("orders.write");
  const [search, setSearch] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [status, setStatus] = React.useState<OrderStatus | "">("");
  const [parcelStatus, setParcelStatus] = React.useState<NormalizedStatus | "">(initialParcelStatus ?? "");
  const [wilaya, setWilaya] = React.useState("");
  const [productId, setProductId] = React.useState("");
  const [creativeId, setCreativeId] = React.useState("");
  const [upsell, setUpsell] = React.useState<"" | "yes" | "no">("");
  // Beginners see the main filters and columns; the rest are one tap away. A filter in use stays shown.
  const [moreOpen, setMore] = useMoreDetails("orders");
  const more = moreOpen || !!parcelStatus || !!creativeId || !!upsell;
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);
  const [printing, setPrinting] = React.useState<{ data: PrintData; title: string } | null>(null);
  const closePrint = React.useCallback(() => setPrinting(null), []);
  const workspace = useQuery(trpc.workspace.getCurrent.queryOptions());

  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(timer);
  }, [search]);
  // Changing any filter returns to page 1.
  const ads = useAdsFilter().filter;
  const filterKey = JSON.stringify([debounced, status, parcelStatus, wilaya, productId, creativeId, upsell, ads]);
  const upsellFilter = upsell === "" ? undefined : upsell === "yes";
  const [pageState, setPageState] = React.useState({ key: filterKey, page: 1 });
  const page = pageState.key === filterKey ? pageState.page : 1;
  const setPage = (fn: (p: number) => number) => setPageState({ key: filterKey, page: fn(page) });

  const facets = useQuery(trpc.orders.facets.queryOptions());
  const pageSize = 25;
  const orders = useQuery({
    ...trpc.orders.list.queryOptions({
      search: debounced || undefined,
      status: status || undefined,
      parcelStatus: parcelStatus || undefined,
      wilaya: wilaya || undefined,
      productId: productId || undefined,
      creativeId: creativeId || undefined,
      upsell: upsellFilter,
      ads,
      page,
      pageSize,
    }),
    placeholderData: keepPreviousData,
  });
  const totalPages = orders.data ? Math.max(1, Math.ceil(orders.data.total / pageSize)) : 1;
  // Phones get one card per order instead of a wide table.
  const phone = useMedia(PHONE);

  return (
    <>
      <PageHeader
        title={t("Orders & parcels")}
        description={t("Every order and where its parcel is. Tap an order to see everything about it.")}
        actions={
          <>
            <Button onClick={() => setExporting(true)} disabled={!workspace.data}><Download /> {t("Export")}</Button>
            {canWrite ? <Button variant="primary" onClick={() => setCreating(true)}><Plus /> {t("Manual order")}</Button> : null}
          </>
        }
      />
      <Card>
        <div className="grid grid-cols-2 gap-2 border-b border-border p-3 sm:grid-cols-[repeat(auto-fill,minmax(13rem,1fr))]">
          <div className="relative col-span-2">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
            <label htmlFor="order-search" className="sr-only">{t("Search orders")}</label>
            <Input id="order-search" placeholder={t("Order number, tracking ID or phone")} value={search} onChange={(e) => setSearch(e.target.value)} className="ps-9" />
          </div>
          <AdsFilter className="col-span-2 sm:col-span-1" />
          <div className="flex min-w-0 items-center gap-1">
            <Select aria-label={t("Order status")} value={status} onChange={(e) => setStatus(e.target.value as OrderStatus | "")} className="w-full min-w-0">
              <option value="">{t("All orders")}</option>
              {ORDER_STATUSES.map((s) => <option key={s} value={s}>{t(ORDER_STATUS_WORD[s])}</option>)}
            </Select>
            <HelpTip label={t("Order status")}>{t("The call center's result for the order: pending, confirmed or canceled. The parcel status filter is about delivery instead.")}</HelpTip>
          </div>
          <div className="flex min-w-0 items-center gap-1">
            <Select aria-label={t("Wilaya")} value={wilaya} onChange={(e) => setWilaya(e.target.value)} className="w-full min-w-0">
              <option value="">{t("All wilayas")}</option>
              {facets.data?.wilayas.map((w) => <option key={w} value={w}>{wilayaLabel(w)}</option>)}
            </Select>
            <HelpTip label={t("Wilaya")}>{t("Only orders going to this wilaya.")}</HelpTip>
          </div>
          <div className="flex min-w-0 items-center gap-1">
            <Select aria-label={t("Product")} value={productId} onChange={(e) => setProductId(e.target.value)} className="w-full min-w-0">
              <option value="">{t("All products")}</option>
              {facets.data?.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <HelpTip label={t("Product")}>{t("Only orders with this product on one of their lines.")}</HelpTip>
          </div>
          {more ? (
            <>
              <div className="flex min-w-0 items-center gap-1">
                <Select aria-label={t("Parcel status")} value={parcelStatus} onChange={(e) => setParcelStatus(e.target.value as NormalizedStatus | "")} className="w-full min-w-0">
                  <option value="">{t("All parcels")}</option>
                  {PARCEL_STATUSES.map((s) => <option key={s} value={s}>{t(PARCEL_STATUS_WORD[s])}</option>)}
                </Select>
                <HelpTip label={t("Parcel status")}>{t("Only orders with a parcel in this status, as MDM reports it: shipped, delivered, returned and so on.")}</HelpTip>
              </div>
              <div className="flex min-w-0 items-center gap-1">
                <Select aria-label={t("Creative")} value={creativeId} onChange={(e) => setCreativeId(e.target.value)} className="w-full min-w-0">
                  <option value="">{t("All creatives")}</option>
                  {facets.data?.creatives.map((c) => <option key={c.id} value={c.id}>{c.externalCreativeId}</option>)}
                </Select>
                <HelpTip label={t("Creative")}>{t("Only orders linked to this Meta ad, by the ad ID in their utm_content.")}</HelpTip>
              </div>
              <div className="flex min-w-0 items-center gap-1">
                <Select aria-label={t("Upsell")} value={upsell} onChange={(e) => setUpsell(e.target.value as "" | "yes" | "no")} className="w-full min-w-0">
                  <option value="">{t("Upsell or not")}</option>
                  <option value="yes">{t("Upsold")}</option>
                  <option value="no">{t("No upsell")}</option>
                </Select>
                <HelpTip label={t("Upsell")}>{t("Only the orders MDM marked as upsold by its call center, or only the others.")}</HelpTip>
              </div>
            </>
          ) : null}
          <MoreDetailsButton open={more} onToggle={(o) => { setMore(o); if (!o) { setParcelStatus(""); setCreativeId(""); setUpsell(""); } }} className="col-span-2 justify-self-start self-center sm:col-span-1" />
        </div>
        {orders.error ? <ErrorState message={errorMessage(orders.error)} /> : orders.isLoading ? <Loading /> : !orders.data?.items.length ? (
          <EmptyState icon={<ClipboardList />} title={t("No orders match")} description={t("Import an orders CSV from Imports, or add a manual order.")} />
        ) : phone ? (
          <ul aria-label={t("Orders")} className="flex flex-col divide-y divide-border">
            {orders.data.items.map((o) => (
              <li key={o.id}>
                <button type="button" onClick={() => setOpenId(o.id)} className="flex w-full flex-col gap-1.5 px-4 py-3 text-start transition-colors active:bg-surface-2">
                  <span className="flex items-center justify-between gap-3">
                    <span className="font-mono text-xs font-semibold text-fg">{o.orderNumber}</span>
                    <span className="num text-sm font-bold">{money.fmt(o.codAmount, o.currency)}</span>
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium">
                    <span className="truncate">{o.lines.length ? o.lines.map((l) => `${l.name ?? l.product ?? "—"} ×${l.quantity}`).join(", ") : t("No products")}</span>
                    {o.upsell ? <Badge tone="brand" className="shrink-0">{t("Upsell")}</Badge> : null}
                  </span>
                  {o.customer?.name || o.customer?.phone ? (
                    <span className="truncate text-xs text-muted">{[o.customer.name, o.customer.phone].filter(Boolean).join(" · ")}</span>
                  ) : null}
                  <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                    <OrderStatusBadge status={o.status} />
                    <ParcelStatusBadge status={o.normalizedStatus} />
                    {o.archived ? <Badge tone="warning">{t("Archived in MDM")}</Badge> : null}
                    <span>{o.wilaya ? <bdi>{o.wilaya}</bdi> : t("No wilaya")} · {date(o.placedAt)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <Table className="sticky-first">
            <THead>
              <tr>
                <Th>{t("Order")}</Th><Th>{t("Customer")}</Th>{more ? <Th>{t("Source")}</Th> : null}<Th>{t("Product")}</Th>{more ? <Th>{t("Creative")}</Th> : null}<Th>{t("date::Placed")}</Th><Th>{t("Wilaya")}</Th><Th>{t("Order status")}</Th>
                {more ? <><Th className="text-end">{t("Parcels")}</Th><Th>{t("Tracking")}</Th><Th>{t("MDM status")}</Th></> : null}<Th>{t("Parcel")}</Th><Th className="text-end">COD</Th>{more ? <Th>{t("Last MDM update")}</Th> : null}
              </tr>
            </THead>
            <tbody>
              {orders.data.items.map((o) => (
                <Tr key={o.id} className="cursor-pointer" onClick={() => setOpenId(o.id)}>
                  <Td>
                    <button className="font-mono text-xs font-medium text-fg hover:text-brand-strong" onClick={(e) => { e.stopPropagation(); setOpenId(o.id); }}>{o.orderNumber}</button>
                  </Td>
                  <Td className="max-w-48">
                    {o.customer?.name || o.customer?.phone ? (
                      <span className="flex min-w-0 flex-col leading-tight">
                        <span className="truncate text-[13px] font-medium">{o.customer.name ?? "—"}</span>
                        <span className="num truncate text-[11px] text-muted">{o.customer.phone ?? ""}</span>
                      </span>
                    ) : <span className="text-subtle">—</span>}
                  </Td>
                  {more ? <Td className="text-xs text-muted">{t(SOURCE_WORD[o.source])}</Td> : null}
                  <Td className="max-w-56">
                    {o.lines.length ? (
                      <span className="flex min-w-0 flex-col gap-0.5 leading-tight">
                        {o.lines.slice(0, 2).map((l, i) => (
                          <span key={i} className="truncate text-[13px]" title={l.product && l.product !== l.name ? t("Counts for {product}", { product: l.product }) : undefined}>
                            {l.name ?? l.product ?? "—"} <span className="num text-muted">×{l.quantity}</span>
                          </span>
                        ))}
                        {o.lines.length > 2 ? <span className="text-[11px] text-subtle">{t("+{n} more", { n: o.lines.length - 2 })}</span> : null}
                      </span>
                    ) : <span className="text-subtle">—</span>}
                    {o.upsell ? <Badge tone="brand" className="mt-1">{t("Upsell")}</Badge> : null}
                  </Td>
                  {more ? <Td className="font-mono text-xs text-muted">{o.creative?.externalCreativeId ?? <span className="text-subtle">{t("unattributed")}</span>}</Td> : null}
                  <Td className="text-xs text-muted">{date(o.placedAt)}</Td>
                  <Td className="text-xs">{o.wilaya ? <bdi>{o.wilaya}</bdi> : "—"}</Td>
                  <Td><OrderStatusBadge status={o.status} />{o.archived ? <Badge tone="warning" className="ms-1">{t("Archived in MDM")}</Badge> : null}</Td>
                  {more ? (
                    <>
                      <Td className="num text-end">{o.parcelCount}</Td>
                      <Td className="font-mono text-xs text-muted">{o.trackingId ?? "—"}</Td>
                      <Td className="font-mono text-xs text-muted">{o.providerStatus ?? "—"}</Td>
                    </>
                  ) : null}
                  <Td><ParcelStatusBadge status={o.normalizedStatus} /></Td>
                  <Td className="num text-end">{money.fmt(o.codAmount, o.currency)}</Td>
                  {more ? <Td className="text-xs text-muted">{o.lastProviderUpdateAt ? ago(o.lastProviderUpdateAt) : "—"}</Td> : null}
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-muted">
          <span className="num">{orders.data ? t("{n} orders", { n: orders.data.total.toLocaleString("en-US") }) : " "}</span>
          <div className="flex items-center gap-2">
            <Button size="icon" variant="ghost" aria-label={t("Previous page")} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft /></Button>
            <span className="num">{t("Page {page} of {pages}", { page, pages: totalPages })}</span>
            <Button size="icon" variant="ghost" aria-label={t("Next page")} disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}><ChevronRight /></Button>
          </div>
        </div>
      </Card>
      {openId ? <OrderDrawer orderId={openId} onClose={() => setOpenId(null)} /> : null}
      {creating ? <NewOrderDialog onClose={() => setCreating(false)} /> : null}
      {exporting && workspace.data ? (
        <ExportPanel
          workspaceId={workspace.data.id}
          timezone={workspace.data.timezone}
          filters={{
            search: debounced || undefined,
            status: status || undefined,
            parcelStatus: parcelStatus || undefined,
            wilaya: wilaya || undefined,
            productId: productId || undefined,
            productName: facets.data?.products.find((p) => p.id === productId)?.name,
            creativeId: creativeId || undefined,
            creativeName: facets.data?.creatives.find((c) => c.id === creativeId)?.externalCreativeId,
            upsell: upsellFilter,
            ads,
          }}
          onClose={() => setExporting(false)}
          onPrint={(data, title) => {
            setExporting(false);
            setPrinting({ data, title });
          }}
        />
      ) : null}
      {printing ? <PrintSheet data={printing.data} title={printing.title} onClose={closePrint} /> : null}
    </>
  );
}

export function useInvalidateOrders() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: trpc.orders.list.queryKey() });
    qc.invalidateQueries({ queryKey: trpc.orders.getDetails.queryKey() });
    qc.invalidateQueries({ queryKey: trpc.workspace.pathKey() });
  };
}
