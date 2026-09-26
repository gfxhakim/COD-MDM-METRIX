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
import { parseToMinor } from "@/lib/money";
import { errorMessage, useTRPC } from "@/lib/trpc/client";
import { toDateInput } from "@/lib/utils";
import { useInvalidateOrders } from "./orders-view";

type Line = { productId: string; quantity: string; unitPrice: string };

export function NewOrderDialog({ onClose }: { onClose: () => void }) {
  const trpc = useTRPC();
  const toast = useToast();
  const invalidate = useInvalidateOrders();
  const products = useQuery(trpc.products.list.queryOptions({ includeInactive: false }));
  const ws = useQuery(trpc.workspace.getCurrent.queryOptions());
  const currency = ws.data?.currency ?? "DZD";
  const [f, setF] = React.useState({ orderNumber: "", placedAt: toDateInput(new Date()), status: "PENDING" as OrderStatus, wilaya: "", city: "", phone: "", utmCampaign: "", utmContent: "", notes: "", cod: "" });
  const [lines, setLines] = React.useState<Line[]>([{ productId: "", quantity: "1", unitPrice: "" }]);
  const [error, setError] = React.useState<string | null>(null);
  const create = useMutation(trpc.orders.create.mutationOptions({ onSuccess: () => { invalidate(); toast("success", "Order created"); onClose(); }, onError: (e) => setError(errorMessage(e)) }));
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
        if (!l.productId) throw new Error("Choose a product for every line");
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
      <DialogContent title="Manual order" description="For orders that did not come through an import. The phone number is hashed and masked; the raw number is never stored." className="max-w-2xl">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Order number" htmlFor="on"><Input id="on" value={f.orderNumber} onChange={set("orderNumber")} required className="font-mono" /></Field>
            <Field label="Placed on" htmlFor="pa"><Input id="pa" type="date" value={f.placedAt} onChange={set("placedAt")} required /></Field>
            <Field label="Status" htmlFor="st">
              <Select id="st" value={f.status} onChange={set("status")}><option value="PENDING">Pending</option><option value="CONFIRMED">Confirmed</option><option value="CANCELED">Canceled</option></Select>
            </Field>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-xs font-medium text-muted">Lines</legend>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_5rem_8rem_2rem] items-center gap-2">
                <Select aria-label="Product" value={l.productId} onChange={(e) => setLine(i, { productId: e.target.value })} required>
                  <option value="">Choose product…</option>
                  {products.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
                <Input aria-label="Quantity" type="number" min={1} value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} className="num" />
                <MoneyInput id={`up-${i}`} aria-label="Unit price" currency={currency} value={l.unitPrice} onChange={(v) => setLine(i, { unitPrice: v })} />
                <Button type="button" size="icon" variant="ghost" aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><X /></Button>
              </div>
            ))}
            <Button type="button" size="sm" variant="ghost" className="self-start" onClick={() => setLines((ls) => [...ls, { productId: "", quantity: "1", unitPrice: "" }])}><Plus /> Add line</Button>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="COD amount" htmlFor="cod" hint="Defaults to the line total"><MoneyInput id="cod" currency={currency} value={f.cod} onChange={(v) => setF({ ...f, cod: v })} /></Field>
            <Field label="Wilaya" htmlFor="wi"><Input id="wi" value={f.wilaya} onChange={set("wilaya")} /></Field>
            <Field label="City" htmlFor="ci"><Input id="ci" value={f.city} onChange={set("city")} /></Field>
            <Field label="Phone" htmlFor="ph" hint="Stored only as a hash + mask"><Input id="ph" type="tel" value={f.phone} onChange={set("phone")} autoComplete="off" /></Field>
            <Field label="UTM campaign" htmlFor="uc"><Input id="uc" value={f.utmCampaign} onChange={set("utmCampaign")} /></Field>
            <Field label="UTM content (creative ID)" htmlFor="ut"><Input id="ut" value={f.utmContent} onChange={set("utmContent")} className="font-mono" /></Field>
          </div>
          <Field label="Notes" htmlFor="no"><Textarea id="no" value={f.notes} onChange={set("notes")} /></Field>
          {error ? <p className="text-sm text-negative" role="alert">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={create.isPending}>Create order</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
