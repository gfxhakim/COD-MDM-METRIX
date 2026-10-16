"use client";

import type { AttributionMethod, MatchMethod, OrderSource, OrderStatus } from "@prisma/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FileJson, Link2, Trash2, Unlink } from "lucide-react";
import * as React from "react";
import { useMoney } from "@/components/app/currency";
import { OrderStatusBadge, ParcelStatusBadge } from "@/components/app/status";
import { useCan } from "@/components/app/use-can";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { ErrorState, Loading } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { HelpTip, Term } from "@/components/ui/tooltip";
import { errorMessage, useTRPC } from "@/lib/trpc/client";
import { providerStatusLabel } from "@/domain/statusMapping";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/core";
import { useInvalidateOrders } from "./orders-view";

/** Where an order came from; brand names stay as they are. */
const SOURCE_NAME: Record<OrderSource, string> = { SHOPIFY: "Shopify", EASYSELL: "Easysell", MANUAL: msg("Manual"), OTHER: msg("Other"), MDM_EXPRESS: "MDM express" };
const ATTRIBUTION_METHOD: Record<AttributionMethod, string> = { UTM_CONTENT: msg("Utm content"), MANUAL: msg("Manual"), NONE: msg("None") };
const MATCH_METHOD: Record<MatchMethod, string> = {
  ORDER_REFERENCE: msg("Order reference"),
  TRACKING_ID: msg("Tracking id"),
  SOURCE_ORDER_ID: msg("Source order id"),
  MANUAL: msg("Manual"),
  NONE: msg("None"),
  MDM_ORDER: msg("MDM order"),
};

/** A titled part of the drawer; `help` is the ⓘ explanation beside the title. */
function Section({ title, help, children }: { title: React.ReactNode; help?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      {help ? (
        <h3 className="mb-2 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-subtle">
          {title}
          <HelpTip label={typeof title === "string" ? title : undefined}>{help}</HelpTip>
        </h3>
      ) : (
        <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-subtle">{title}</h3>
      )}
      {children}
    </section>
  );
}

/** Label and value pairs; a third item is the label's ⓘ explanation. */
function KV({ items }: { items: [string, React.ReactNode, string?][] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border border-border bg-surface-2 p-4 text-sm">
      {items.map(([k, v, help]) => (
        <div key={k} className="min-w-0">
          <dt className="text-[11px] text-subtle">{help ? <Term label={k} definition={help} /> : k}</dt>
          <dd className="truncate">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

/** What MDM sent, exactly as it came: MDM's field names and values (amounts in dinars, dates as sent). */
function AsReceived({ data, title }: { data: { observedAt: Date | string; rows: [string, string][] } | null | undefined; title: string }) {
  const { t, dateTime } = useT();
  if (!data?.rows.length) return null;
  return (
    <details className="group mt-3 rounded-lg border border-dashed border-border-strong bg-surface text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 font-medium text-brand-strong [&::-webkit-details-marker]:hidden">
        <FileJson className="size-4 shrink-0" />
        <span>{title}</span>
        <span className="ms-auto text-[11px] font-normal text-subtle">{t("read {date}", { date: dateTime(data.observedAt) })}</span>
      </summary>
      <p className="px-3 text-[11px] text-subtle">{t("MDM's own field names and values, as the last sync read them. Amounts are in dinars, as MDM sends them. The customer's details are never kept here.")}</p>
      <dl dir="ltr" className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-x-3 px-3 py-2 font-mono text-[11px]">
        {data.rows.map(([k, v], i) => (
          <React.Fragment key={`${k}-${i}`}>
            <dt className="break-all border-t border-border py-1 text-subtle">{k}</dt>
            <dd className="break-all border-t border-border py-1 text-fg">{v}</dd>
          </React.Fragment>
        ))}
      </dl>
    </details>
  );
}

/** A phone number that calls when tapped; masked numbers stay plain text. */
function PhoneLink({ value }: { value: string | null | undefined }) {
  if (!value) return <>—</>;
  const dial = value.replace(/[^\d+]/g, "");
  return value.includes("•") || dial.length < 6 ? <>{value}</> : <a href={`tel:${dial}`} className="font-medium text-brand-strong hover:underline">{value}</a>;
}

export function OrderDrawer({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const { t, tx, dateTime } = useT();
  const money = useMoney();
  const trpc = useTRPC();
  const toast = useToast();
  const invalidate = useInvalidateOrders();
  const canWrite = useCan("orders.write");
  const canMatch = useCan("orders.match");
  const q = useQuery(trpc.orders.getDetails.queryOptions({ id: orderId }));
  const [tracking, setTracking] = React.useState("");
  const onError = (e: unknown) => toast("error", errorMessage(e));
  const setStatus = useMutation(trpc.orders.updateStatus.mutationOptions({ onSuccess: () => { invalidate(); toast("success", t("Order status updated")); }, onError }));
  const match = useMutation(trpc.orders.manualMatchParcel.mutationOptions({ onSuccess: () => { invalidate(); setTracking(""); toast("success", t("Parcel linked")); }, onError }));
  const unlink = useMutation(trpc.orders.unlinkParcel.mutationOptions({ onSuccess: () => { invalidate(); toast("success", t("Parcel unlinked and sent to review")); }, onError }));
  const del = useMutation(trpc.orders.delete.mutationOptions({ onSuccess: () => { invalidate(); toast("success", t("Order deleted")); onClose(); }, onError }));
  const o = q.data;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent side="right" title={o ? t("Order {number}", { number: o.orderNumber }) : t("Order")} description={o ? t("{source} · placed {date}", { source: t(SOURCE_NAME[o.source]), date: dateTime(o.placedAt) }) : undefined}>
        {q.error ? <ErrorState message={errorMessage(q.error)} /> : !o ? <Loading /> : (
          <>
            <Section title={t("Customer")}>
              <KV
                items={[
                  [t("Name"), o.customer?.name ?? "—"],
                  [t("Phone"), <PhoneLink key="p" value={o.customer?.phone ?? o.phoneMasked} />],
                  [t("Second phone"), <PhoneLink key="p2" value={o.customer?.phone2} />],
                  [t("Delivery"), o.deliveryType === "STOP_DESK" ? t("Stop desk") : o.deliveryType === "HOME" ? t("Home delivery") : "—", t("Home delivery: to the customer's door. Stop desk: the customer collects the parcel at the carrier's office.")],
                  [t("Address"), o.customer?.address ?? "—"],
                  [t("Commune · wilaya"), o.city || o.wilaya ? <span key="w">{o.city ? <bdi>{o.city}</bdi> : null}{o.city && o.wilaya ? " · " : null}{o.wilaya ? <bdi>{o.wilaya}</bdi> : null}</span> : "—"],
                ]}
              />
            </Section>

            <Section title={o.mdmArchived ? <span className="flex items-center gap-2">{t("Order")} <Badge tone="warning">{t("Archived in MDM")}</Badge></span> : t("Order")} help={o.mdmArchived ? t("MDM archived this order, so it counts in no report. It stays here so you can still find it.") : undefined}>
              <KV
                items={[
                  [t("Status"), <OrderStatusBadge key="s" status={o.status} />, t("The call center's result: pending, confirmed or canceled. It follows the parcels: a parcel being prepared or shipped confirms it, and all parcels canceled cancels it.")],
                  [t("MDM status"), o.mdmStatus ? `${providerStatusLabel(o.mdmStatus)}${o.mdmStatusAt ? ` · ${dateTime(o.mdmStatusAt)}` : ""}` : "—", t("The order's status in MDM's own words at the last MDM sync, with when it changed. Empty for orders MDM never received.")],
                  [t("COD amount"), <span key="c" className="num">{money.fmt(o.codAmount, o.currency)}</span>, t("What the customer pays the delivery person, in cash, for this order.")],
                  [t("MDM order ID"), <span key="m" className="font-mono text-xs">{o.mdmOrderId ?? "—"}</span>],
                  [t("External order ID"), <span key="e" className="font-mono text-xs">{o.externalOrderId}</span>],
                  [t("Store"), o.storeName ?? "—"],
                  [t("Confirmed at"), dateTime(o.confirmedAt)],
                  [t("Tags"), o.tags ?? "—"],
                ]}
              />
              {canWrite ? (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <Field label={t("Change order status")} htmlFor="ostatus" help={t("Set it by hand after a call. For an order from MDM, the next MDM sync sets it again from MDM's status.")}>
                    <Select id="ostatus" value={o.status} onChange={(e) => setStatus.mutate({ id: o.id, status: e.target.value as OrderStatus })} className="w-44">
                      <option value="PENDING">{t("Pending")}</option>
                      <option value="CONFIRMED">{t("Confirmed")}</option>
                      <option value="CANCELED">{t("Canceled")}</option>
                    </Select>
                  </Field>
                  <Button variant="danger" size="sm" className="ms-auto" onClick={() => confirm(t("Delete this order? Linked parcels are kept and become unmatched.")) && del.mutate({ id: o.id })}><Trash2 /> {t("Delete order")}</Button>
                </div>
              ) : null}
              <AsReceived data={o.asReceived.order} title={t("What MDM sent for this order")} />
            </Section>

            <Section
              title={o.mdmUpsell ? <span className="flex items-center gap-2">{t("Lines")} <Badge tone="brand">{t("Upsell")}</Badge></span> : t("Lines")}
              help={t("The products in this order: pieces × price of one piece, as MDM, the store or a manual order gave them. Upsell: MDM marked the order as upsold by its call center.")}
            >
              <ul className="divide-y divide-border rounded-lg border border-border bg-surface-2 text-sm">
                {o.lines.map((l) => (
                  <li key={l.id} className="flex items-center justify-between px-4 py-2">
                    <span>{l.product?.name ?? l.productName ?? t("Unknown product")} <span className="font-mono text-xs text-subtle">{l.product?.sku ?? l.sku}</span></span>
                    <span className="num text-muted">{l.quantity} × {money.fmt(l.unitPrice, l.currency)}</span>
                  </li>
                ))}
              </ul>
            </Section>

            <Section title={t("Attribution")} help={t("Which Meta ad brought this order. The order then counts for that ad on the Creatives page.")}>
              <KV
                items={[
                  [t("Creative"), o.attribution?.creative ? <span key="c" className="font-mono text-xs">{o.attribution.creative.externalCreativeId}</span> : t("Unattributed"), t("The Meta ad ID found in the order's utm_content. Unattributed: the order has no ad ID, or no creative has that ID yet.")],
                  [t("Method"), o.attribution ? t(ATTRIBUTION_METHOD[o.attribution.method]) : "—", t("How the ad was found. Utm content: the ad ID in the order's link matched a creative. None: no match yet.")],
                  [t("UTM content (raw)"), <span key="u" className="font-mono text-xs">{o.utmContent ?? "—"}</span>],
                  [t("UTM campaign"), o.utmCampaign ?? "—"],
                  [t("UTM source / medium"), [o.utmSource, o.utmMedium].filter(Boolean).join(" / ") || "—"],
                  [t("Confidence"), o.attribution ? `${Math.round(o.attribution.confidence * 100)}%` : "—", t("How sure the link to the ad is: 100% when the ad ID matched a creative exactly, 0% when no ad is linked.")],
                ]}
              />
            </Section>

            <Section title={t("Parcels ({n})", { n: o.parcels.length })} help={t("The parcels MDM made for this order, with every status they went through. The order counts once in every number, however many parcels it has: an exchange, a refund or a copy adds its money, not one more delivery. Parcels MDM archived count for nothing.")}>
              {o.parcels.length === 0 ? <p className="text-sm text-muted">{t("No parcel linked yet.")}</p> : (
                <div className="flex flex-col gap-3">
                  {o.parcels.map((p) => (
                    <div key={p.id} className="rounded-lg border border-border bg-surface-2 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm">{p.trackingId}</span>
                        <ParcelStatusBadge status={p.normalizedStatus} />
                        <Badge>{t("provider: {status}", { status: p.providerStatus ?? "—" })}</Badge>
                        {p.isDemoFixture ? <Badge tone="warning">{t("demo fixture")}</Badge> : null}
                        {p.archived ? <Badge tone="warning">{t("Archived in MDM")}</Badge> : null}
                        {p.mdmParentParcelId ? <Badge tone="info">{tx("Made from {id}", { id: <bdi className="font-mono">{p.mdmParentParcelId}</bdi> })}</Badge> : null}
                        {p.mdmType || p.mdmSubType ? <Badge>{t("MDM type: {type}", { type: [p.mdmType, p.mdmSubType].filter(Boolean).join(" / ") })}</Badge> : null}
                        {canMatch ? (
                          <Button size="sm" variant="ghost" className="ms-auto" onClick={() => confirm(t("Unlink this parcel? It will move to the unmatched review queue.")) && unlink.mutate({ parcelId: p.id })}><Unlink /> {t("Unlink")}</Button>
                        ) : null}
                      </div>
                      <p className="mt-2 text-xs text-muted">
                        {tx("Match: {method} · confidence {confidence} · COD {cod} · last update {date}", {
                          method: t(MATCH_METHOD[p.matchMethod]),
                          confidence: `${Math.round(p.matchConfidence * 100)}%`,
                          cod: <span className="num">{money.fmt(p.codAmount, p.currency)}</span>,
                          date: dateTime(p.lastProviderUpdateAt),
                        })}
                        <HelpTip label={t("Confidence")} className="ms-1 align-middle">
                          {t("Match: how the parcel was tied to this order. Confidence: 100% by MDM order, order reference or by hand; 95% by an earlier tracking-ID link; 90% by the store order ID.")}
                        </HelpTip>
                      </p>
                      {p.piecesSent !== null ? (
                        <p className="mt-1 text-xs text-muted">
                          {p.piecesDelivered !== null
                            ? tx("Pieces: {sent} sent · {kept} kept by the customer", { sent: <span className="num">{p.piecesSent}</span>, kept: <span className="num">{p.piecesDelivered}</span> })
                            : tx("Pieces: {sent} sent", { sent: <span className="num">{p.piecesSent}</span> })}
                        </p>
                      ) : null}
                      {p.providerReference ? <p className="mt-1 text-xs text-muted">{tx("Provider reference: {ref}", { ref: <code className="rounded bg-surface-3 px-1 font-mono">{p.providerReference}</code> })}</p> : null}
                      <ol className="mt-3 border-s border-border-strong ps-4">
                        {p.events.map((e) => (
                          <li key={e.id} className="relative pb-2 text-xs">
                            <span className="absolute -start-[21px] top-1 size-2.5 rounded-full border-2 border-surface-2 bg-border-strong" />
                            <span className="text-muted">{dateTime(e.occurredAt)}</span> · <span className="font-mono">{e.providerStatus}</span> → <ParcelStatusBadge status={e.normalizedStatus} />
                          </li>
                        ))}
                        {p.events.length === 0 ? <li className="text-xs text-subtle">{t("No status events yet.")}</li> : null}
                      </ol>
                      <AsReceived data={o.asReceived.parcels[p.trackingId]} title={t("What MDM sent for this parcel")} />
                    </div>
                  ))}
                </div>
              )}
              {canMatch ? (
                <form className="mt-3 flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (tracking.trim()) match.mutate({ orderId: o.id, trackingId: tracking.trim() }); }}>
                  <Field label={t("Link a parcel by tracking ID")} htmlFor="trk" className="flex-1" help={t("For a parcel that did not link by itself. Type its tracking number; later syncs keep this link, and Unlink undoes it.")}><Input id="trk" value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder={t("e.g. {example}", { example: "MDM-DEMO-0042" })} className="font-mono" /></Field>
                  <Button type="submit" disabled={match.isPending}><Link2 /> {t("Link")}</Button>
                </form>
              ) : null}
            </Section>

            {o.notes ? <Section title={t("Notes")}><p className="whitespace-pre-wrap rounded-lg border border-border bg-surface-2 p-3 text-sm text-muted">{o.notes}</p></Section> : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
