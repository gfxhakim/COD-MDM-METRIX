"use client";

import type { NormalizedStatus, OrderStatus } from "@prisma/client";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, ClipboardList, Plus, Search } from "lucide-react";
import * as React from "react";
import { PageHeader } from "@/components/app/page-header";
import { OrderStatusBadge, ParcelStatusBadge } from "@/components/app/status";
import { useCan } from "@/components/app/use-can";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { EmptyState, ErrorState, Loading } from "@/components/ui/states";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { formatMoney } from "@/lib/money";
import { errorMessage, useTRPC } from "@/lib/trpc/client";
import { formatDate, timeAgo } from "@/lib/utils";
import { OrderDrawer } from "./order-drawer";
import { NewOrderDialog } from "./new-order-dialog";

const PARCEL_STATUSES: NormalizedStatus[] = ["PENDING", "CONFIRMED", "SHIPPED", "DELIVERED", "RETURNED", "LOST", "CANCELED", "EXCHANGED", "UNKNOWN"];
const ORDER_STATUSES: OrderStatus[] = ["PENDING", "CONFIRMED", "CANCELED"];

export function OrdersView({ initialParcelStatus }: { initialParcelStatus?: NormalizedStatus }) {
  const trpc = useTRPC();
  const canWrite = useCan("orders.write");
  const [search, setSearch] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [status, setStatus] = React.useState<OrderStatus | "">("");
  const [parcelStatus, setParcelStatus] = React.useState<NormalizedStatus | "">(initialParcelStatus ?? "");
  const [wilaya, setWilaya] = React.useState("");
  const [productId, setProductId] = React.useState("");
  const [creativeId, setCreativeId] = React.useState("");
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  // Changing any filter returns to page 1.
  const filterKey = JSON.stringify([debounced, status, parcelStatus, wilaya, productId, creativeId]);
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
      page,
      pageSize,
    }),
    placeholderData: keepPreviousData,
  });
  const totalPages = orders.data ? Math.max(1, Math.ceil(orders.data.total / pageSize)) : 1;

  return (
    <>
      <PageHeader
        title="Orders & parcels"
        description="Orders from your store and the carrier parcels linked to them. One order can have several parcels."
        actions={canWrite ? <Button variant="primary" onClick={() => setCreating(true)}><Plus /> Manual order</Button> : null}
      />
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-border p-3">
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
            <label htmlFor="order-search" className="sr-only">Search orders</label>
            <Input id="order-search" placeholder="Order number or tracking ID" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select aria-label="Order status" value={status} onChange={(e) => setStatus(e.target.value as OrderStatus | "")} className="w-36">
            <option value="">All orders</option>
            {ORDER_STATUSES.map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}
          </Select>
          <Select aria-label="Parcel status" value={parcelStatus} onChange={(e) => setParcelStatus(e.target.value as NormalizedStatus | "")} className="w-40">
            <option value="">All parcel statuses</option>
            {PARCEL_STATUSES.map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}
          </Select>
          <Select aria-label="Wilaya" value={wilaya} onChange={(e) => setWilaya(e.target.value)} className="w-40">
            <option value="">All wilayas</option>
            {facets.data?.wilayas.map((w) => <option key={w} value={w}>{w}</option>)}
          </Select>
          <Select aria-label="Product" value={productId} onChange={(e) => setProductId(e.target.value)} className="w-44">
            <option value="">All products</option>
            {facets.data?.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Select aria-label="Creative" value={creativeId} onChange={(e) => setCreativeId(e.target.value)} className="w-44">
            <option value="">All creatives</option>
            {facets.data?.creatives.map((c) => <option key={c.id} value={c.id}>{c.externalCreativeId}</option>)}
          </Select>
        </div>
        {orders.error ? <ErrorState message={errorMessage(orders.error)} /> : orders.isLoading ? <Loading /> : !orders.data?.items.length ? (
          <EmptyState icon={<ClipboardList />} title="No orders match" description="Import an orders CSV (Milestone 3) or add a manual order." />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Order</Th><Th>Source</Th><Th>Product</Th><Th>Creative</Th><Th>Placed</Th><Th>Wilaya</Th><Th>Order status</Th>
                <Th className="text-right">Parcels</Th><Th>Tracking</Th><Th>Provider status</Th><Th>Normalized</Th><Th className="text-right">COD</Th><Th>Last MDM update</Th>
              </tr>
            </THead>
            <tbody>
              {orders.data.items.map((o) => (
                <Tr key={o.id} className="cursor-pointer" onClick={() => setOpenId(o.id)}>
                  <Td>
                    <button className="font-mono text-xs font-medium text-fg hover:text-positive" onClick={(e) => { e.stopPropagation(); setOpenId(o.id); }}>{o.orderNumber}</button>
                  </Td>
                  <Td className="text-xs text-muted">{o.source.toLowerCase()}</Td>
                  <Td className="max-w-40 truncate">{o.product ?? "—"}{o.extraLines ? <span className="text-subtle"> +{o.extraLines}</span> : null}</Td>
                  <Td className="font-mono text-xs text-muted">{o.creative?.externalCreativeId ?? <span className="text-subtle">unattributed</span>}</Td>
                  <Td className="text-xs text-muted">{formatDate(o.placedAt)}</Td>
                  <Td className="text-xs">{o.wilaya ?? "—"}</Td>
                  <Td><OrderStatusBadge status={o.status} /></Td>
                  <Td className="num text-right">{o.parcelCount}</Td>
                  <Td className="font-mono text-xs text-muted">{o.trackingId ?? "—"}</Td>
                  <Td className="font-mono text-xs text-muted">{o.providerStatus ?? "—"}</Td>
                  <Td><ParcelStatusBadge status={o.normalizedStatus} /></Td>
                  <Td className="num text-right">{formatMoney(o.codAmount, o.currency)}</Td>
                  <Td className="text-xs text-muted">{o.lastProviderUpdateAt ? timeAgo(o.lastProviderUpdateAt) : "—"}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-muted">
          <span className="num">{orders.data ? `${orders.data.total.toLocaleString("en-US")} orders` : " "}</span>
          <div className="flex items-center gap-2">
            <Button size="icon" variant="ghost" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft /></Button>
            <span className="num">Page {page} of {totalPages}</span>
            <Button size="icon" variant="ghost" aria-label="Next page" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}><ChevronRight /></Button>
          </div>
        </div>
      </Card>
      {openId ? <OrderDrawer orderId={openId} onClose={() => setOpenId(null)} /> : null}
      {creating ? <NewOrderDialog onClose={() => setCreating(false)} /> : null}
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
