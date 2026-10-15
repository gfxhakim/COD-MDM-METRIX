"use client";

import type { AttributionMethod, MatchMethod, OrderSource, OrderStatus } from "@prisma/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link2, Trash2, Unlink } from "lucide-react";
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

function Section({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-subtle">{title}</h3>
      {children}
    </section>
  );
}

function KV({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border border-border bg-surface-2 p-4 text-sm">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-[11px] text-subtle">{k}</dt>
          <dd className="truncate">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
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
                  [t("Delivery"), o.deliveryType === "STOP_DESK" ? t("Stop desk") : o.deliveryType === "HOME" ? t("Home delivery") : "—"],
                  [t("Address"), o.customer?.address ?? "—"],
                  [t("Commune · wilaya"), o.city || o.wilaya ? <span key="w">{o.city ? <bdi>{o.city}</bdi> : null}{o.city && o.wilaya ? " · " : null}{o.wilaya ? <bdi>{o.wilaya}</bdi> : null}</span> : "—"],
                ]}
              />
            </Section>

            <Section title={t("Order")}>
              <KV
                items={[
                  [t("Status"), <OrderStatusBadge key="s" status={o.status} />],
                  [t("MDM status"), o.mdmStatus ? `${providerStatusLabel(o.mdmStatus)}${o.mdmStatusAt ? ` · ${dateTime(o.mdmStatusAt)}` : ""}` : "—"],
                  [t("COD amount"), <span key="c" className="num">{money.fmt(o.codAmount, o.currency)}</span>],
                  [t("MDM order ID"), <span key="m" className="font-mono text-xs">{o.mdmOrderId ?? "—"}</span>],
                  [t("External order ID"), <span key="e" className="font-mono text-xs">{o.externalOrderId}</span>],
                  [t("Store"), o.storeName ?? "—"],
                  [t("Confirmed at"), dateTime(o.confirmedAt)],
                  [t("Tags"), o.tags ?? "—"],
                ]}
              />
              {canWrite ? (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <Field label={t("Change order status")} htmlFor="ostatus">
                    <Select id="ostatus" value={o.status} onChange={(e) => setStatus.mutate({ id: o.id, status: e.target.value as OrderStatus })} className="w-44">
                      <option value="PENDING">{t("Pending")}</option>
                      <option value="CONFIRMED">{t("Confirmed")}</option>
                      <option value="CANCELED">{t("Canceled")}</option>
                    </Select>
                  </Field>
                  <Button variant="danger" size="sm" className="ms-auto" onClick={() => confirm(t("Delete this order? Linked parcels are kept and become unmatched.")) && del.mutate({ id: o.id })}><Trash2 /> {t("Delete order")}</Button>
                </div>
              ) : null}
            </Section>

            <Section title={o.mdmUpsell ? <span className="flex items-center gap-2">{t("Lines")} <Badge tone="brand">{t("Upsell")}</Badge></span> : t("Lines")}>
              <ul className="divide-y divide-border rounded-lg border border-border bg-surface-2 text-sm">
                {o.lines.map((l) => (
                  <li key={l.id} className="flex items-center justify-between px-4 py-2">
                    <span>{l.product?.name ?? l.productName ?? t("Unknown product")} <span className="font-mono text-xs text-subtle">{l.product?.sku ?? l.sku}</span></span>
                    <span className="num text-muted">{l.quantity} × {money.fmt(l.unitPrice, l.currency)}</span>
                  </li>
                ))}
              </ul>
            </Section>

            <Section title={t("Attribution")}>
              <KV
                items={[
                  [t("Creative"), o.attribution?.creative ? <span key="c" className="font-mono text-xs">{o.attribution.creative.externalCreativeId}</span> : t("Unattributed")],
                  [t("Method"), o.attribution ? t(ATTRIBUTION_METHOD[o.attribution.method]) : "—"],
                  [t("UTM content (raw)"), <span key="u" className="font-mono text-xs">{o.utmContent ?? "—"}</span>],
                  [t("UTM campaign"), o.utmCampaign ?? "—"],
                  [t("UTM source / medium"), [o.utmSource, o.utmMedium].filter(Boolean).join(" / ") || "—"],
                  [t("Confidence"), o.attribution ? `${Math.round(o.attribution.confidence * 100)}%` : "—"],
                ]}
              />
            </Section>

            <Section title={t("Parcels ({n})", { n: o.parcels.length })}>
              {o.parcels.length === 0 ? <p className="text-sm text-muted">{t("No parcel linked yet.")}</p> : (
                <div className="flex flex-col gap-3">
                  {o.parcels.map((p) => (
                    <div key={p.id} className="rounded-lg border border-border bg-surface-2 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm">{p.trackingId}</span>
                        <ParcelStatusBadge status={p.normalizedStatus} />
                        <Badge>{t("provider: {status}", { status: p.providerStatus ?? "—" })}</Badge>
                        {p.isDemoFixture ? <Badge tone="warning">{t("demo fixture")}</Badge> : null}
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
                      </p>
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
                    </div>
                  ))}
                </div>
              )}
              {canMatch ? (
                <form className="mt-3 flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (tracking.trim()) match.mutate({ orderId: o.id, trackingId: tracking.trim() }); }}>
                  <Field label={t("Link a parcel by tracking ID")} htmlFor="trk" className="flex-1"><Input id="trk" value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder={t("e.g. {example}", { example: "MDM-DEMO-0042" })} className="font-mono" /></Field>
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
