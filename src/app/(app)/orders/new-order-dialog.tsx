"use client";

import type { OrderStatus } from "@prisma/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import * as React from "react";
import { MoneyInput, minorToInput } from "@/components/app/money-input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { Term } from "@/components/ui/tooltip";
import { WILAYAS, wilayaLabel } from "@/domain/wilayas";
import { useT } from "@/i18n/client";
import { parseToMinor } from "@/lib/money";
import { errorMessage, useTRPC } from "@/lib/trpc/client";
import { toDateInput } from "@/lib/utils";
import { useInvalidateOrders } from "./orders-view";

type Line = { productId: string; quantity: string; unitPrice: string };

export function NewOrderDialog({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const trpc = useTRPC();
  const toast = useToast();
  const invalidate = useInvalidateOrders();
  const products = useQuery(trpc.products.list.queryOptions({ includeInactive: false }));
  const ws = useQuery(trpc.workspace.getCurrent.queryOptions());
  const currency = ws.data?.currency ?? "DZD";
  const [f, setF] = React.useState({ orderNumber: "", placedAt: toDateInput(new Date()), status: "PENDING" as OrderStatus, wilaya: "", city: "", phone: "", utmCampaign: "", utmContent: "", notes: "", cod: "" });
  const [lines, setLines] = React.useState<Line[]>([{ productId: "", quantity: "1", unitPrice: "" }]);
  const [error, setError] = React.useState<string | null>(null);
  const create = useMutation(trpc.orders.create.mutationOptions({ onSuccess: () => { invalidate(); toast("success", t("Order created")); onClose(); }, onError: (e) => setError(errorMessage(e)) }));
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  function setLine(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, j) => {
      if (j !== i) return l;
      const next = { ...l, ...patch };
      if (patch.productId) {
        const p = products.data?.find((x) => x.id === patch.productId);
        if (p?.currentCost && !l.unitPrice) next.unitPrice = minorToInput(p.currentCost.salePrice, currency);
      }
      return next;
    }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const parsedLines = lines.map((l) => {
        if (!l.productId) throw new Error(t("Choose a product for every line"));
        return { productId: l.productId, quantity: Number.parseInt(l.quantity, 10), unitPrice: parseToMinor(l.unitPrice || "0", currency) };
      });
      const cod = f.cod ? parseToMinor(f.cod, currency) : parsedLines.reduce((a, l) => a + l.quantity * l.unitPrice, 0);
      create.mutate({
        orderNumber: f.orderNumber,
        placedAt: new Date(`${f.placedAt}T12:00:00Z`),
        status: f.status,
        wilaya: f.wilaya || undefined,
        city: f.city || undefined,
        phone: f.phone || undefined,
        utmCampaign: f.utmCampaign || undefined,
        utmContent: f.utmContent || undefined,
        notes: f.notes || undefined,
        codAmount: cod,
        lines: parsedLines,
      });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={t("Manual order")} description={t("For orders that did not come through an import. The phone number is hashed and masked; the raw number is never stored.")} className="max-w-2xl">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t("Order number")} htmlFor="on" help={t("Your number for the order, e.g. #1001. An MDM parcel with the same reference links to this order by itself.")}><Input id="on" value={f.orderNumber} onChange={set("orderNumber")} required className="font-mono" /></Field>
            <Field label={t("Placed on")} htmlFor="pa" help={t("The day the customer ordered. Reports count the order on this day.")}><Input id="pa" type="date" value={f.placedAt} onChange={set("placedAt")} required /></Field>
            <Field label={t("Status")} htmlFor="st" help={t("The call center's result. Confirmed orders count in the confirmation rate; pending ones still wait for a call.")}>
              <Select id="st" value={f.status} onChange={set("status")}><option value="PENDING">{t("Pending")}</option><option value="CONFIRMED">{t("Confirmed")}</option><option value="CANCELED">{t("Canceled")}</option></Select>
            </Field>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-xs font-medium text-muted"><Term label={t("Lines")} definition={t("One line per product: pick it, type the pieces and the price of one piece. The price fills in from the product's sale price.")} /></legend>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_5rem_8rem_2rem] items-center gap-2">
                <Select aria-label={t("Product")} value={l.productId} onChange={(e) => setLine(i, { productId: e.target.value })} required>
                  <option value="">{t("Choose product…")}</option>
                  {products.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
                <Input aria-label={t("Quantity")} type="number" min={1} value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} className="num" />
                <MoneyInput id={`up-${i}`} aria-label={t("Unit price")} currency={currency} value={l.unitPrice} onChange={(v) => setLine(i, { unitPrice: v })} />
                <Button type="button" size="icon" variant="ghost" aria-label={t("Remove line")} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><X /></Button>
              </div>
            ))}
            <Button type="button" size="sm" variant="ghost" className="self-start" onClick={() => setLines((ls) => [...ls, { productId: "", quantity: "1", unitPrice: "" }])}><Plus /> {t("Add line")}</Button>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t("COD amount")} htmlFor="cod" hint={t("Defaults to the line total")} help={t("Everything the customer pays the delivery person for this order. Example: 3900.")}><MoneyInput id="cod" currency={currency} value={f.cod} onChange={(v) => setF({ ...f, cod: v })} /></Field>
            <Field label={t("Wilaya")} htmlFor="wi" help={t("Where the parcel goes. The dashboard uses wilayas to show where parcels come back from.")}>
              <Select id="wi" value={f.wilaya} onChange={set("wilaya")}>
                <option value="">{t("Pick a wilaya")}</option>
                {WILAYAS.map((w) => <option key={w.code} value={w.ar}>{wilayaLabel(w.ar)}</option>)}
              </Select>
            </Field>
            <Field label={t("City")} htmlFor="ci" help={t("The customer's commune or city, shown on the order.")}><Input id="ci" value={f.city} onChange={set("city")} /></Field>
            <Field label={t("Phone")} htmlFor="ph" hint={t("Stored only as a hash + mask")} help={t("The customer's number. You can then find this order by phone in the Orders search.")}><Input id="ph" type="tel" value={f.phone} onChange={set("phone")} autoComplete="off" /></Field>
            <Field label={t("UTM campaign")} htmlFor="uc" help={t("The campaign name from the ad link (utm_campaign), kept on the order for your records.")}><Input id="uc" value={f.utmCampaign} onChange={set("utmCampaign")} /></Field>
            <Field label={t("UTM content (creative ID)")} htmlFor="ut" help={t("The Meta ad ID from the ad link (utm_content). It links the order to its ad, so the ad's results count it.")}><Input id="ut" value={f.utmContent} onChange={set("utmContent")} className="font-mono" /></Field>
          </div>
          <Field label={t("Notes")} htmlFor="no" help={t("Anything to remember about this order. Shown when you open it.")}><Textarea id="no" value={f.notes} onChange={set("notes")} /></Field>
          {error ? <p className="text-sm text-negative" role="alert">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>{t("Cancel")}</Button>
            <Button type="submit" variant="primary" disabled={create.isPending}>{t("Create order")}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
