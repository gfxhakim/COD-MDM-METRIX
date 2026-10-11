"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PackageCheck, RefreshCw, Trash2 } from "lucide-react";
import * as React from "react";
import { useCan } from "@/components/app/use-can";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { addDays, shortDay, todayIn } from "@/lib/dateRanges";
import { errorMessage, useTRPC } from "@/lib/trpc/client";

type From = "all" | "7" | "30" | "90" | "day";
const FROM_LABEL: Record<Exclude<From, "day">, string> = { all: "Every order", "7": "Last 7 days", "30": "Last 30 days", "90": "Last 90 days" };

/**
 * Which MDM products the sync brings in, and how far back: one row per MDM product, with a
 * switch for new products. Orders already in the app keep updating; they leave only when removed here.
 */
export function MdmProductsCard({ timezone }: { timezone: string }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const canEdit = useCan("integrations.manage");
  const list = useQuery(trpc.sync.mdmProducts.queryOptions());
  const refresh = () => {
    qc.invalidateQueries({ queryKey: trpc.sync.mdmProducts.queryKey() });
    for (const k of [trpc.orders, trpc.reports, trpc.creatives, trpc.money, trpc.profit]) qc.invalidateQueries({ queryKey: k.pathKey() });
  };
  const onError = (e: unknown) => toast("error", errorMessage(e));
  const set = useMutation(trpc.sync.setMdmProduct.mutationOptions({ onSuccess: (r) => { refresh(); toast("success", r.widened ? "Saved. The next sync brings in its orders." : "Saved. It applies from the next sync."); }, onError }));
  const setNew = useMutation(trpc.sync.setBringNewMdmProducts.mutationOptions({ onSuccess: () => { refresh(); toast("success", "Saved"); }, onError }));
  const remove = useMutation(trpc.sync.removeNotBrought.mutationOptions({ onSuccess: (r) => { refresh(); toast("success", `${r.orders} order${r.orders === 1 ? "" : "s"} removed`); }, onError }));
  const today = todayIn(timezone);
  const data = list.data;
  if (!data || (!data.products.length && data.bringNew)) return null;

  return (
    <Card className="min-w-0" role="region" aria-labelledby="mdm-bring-title">
      <CardHeader
        title={<span id="mdm-bring-title" className="inline-flex items-center gap-2"><PackageCheck className="size-4 text-brand-strong" /> What to bring from MDM</span>}
        description="Pick the MDM products the sync brings in, and how far back. Orders already in the app keep updating."
      />
      <div className="flex flex-col gap-3 px-5 pb-5">
        <label className="flex flex-col gap-1.5 rounded-2xl bg-surface-2 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span className="font-semibold">New products MDM sends</span>
          {canEdit ? (
            <Select aria-label="New products MDM sends" value={data.bringNew ? "bring" : "wait"} disabled={setNew.isPending} onChange={(e) => setNew.mutate({ bring: e.target.value === "bring" })} className="h-9 w-full text-sm sm:w-64">
              <option value="bring">Bring them in</option>
              <option value="wait">Wait until I pick them</option>
            </Select>
          ) : <span className="text-muted">{data.bringNew ? "Brought in" : "Wait until someone picks them"}</span>}
        </label>
        {data.rereadPending ? (
          <p className="flex items-start gap-2 rounded-xl border border-info/30 bg-info-soft p-3 text-xs text-info"><RefreshCw className="mt-0.5 size-3.5 shrink-0" /> The next sync reads every MDM order once, to bring in what you just turned on. It takes longer than usual.</p>
        ) : null}
        {!data.products.length ? <p className="text-sm text-muted">No MDM product yet. They appear here after the first sync.</p> : (
          <ul className="flex flex-col divide-y divide-border rounded-2xl border border-border">
            {data.products.map((p) => (
              // Keyed by the saved day too, so the pickers start over from what was saved.
              <ProductRow key={`${p.id}:${p.sinceDay ?? ""}`} p={p} today={today} canEdit={canEdit} busy={set.isPending || remove.isPending}
                onSave={(bring, sinceDay) => set.mutate({ mdmProductId: p.id, bring, sinceDay })}
                onRemove={() => confirm(`Remove ${p.notBrought} order${p.notBrought === 1 ? "" : "s"} of ${p.name ?? p.id} and their parcels from the app? They come back if you bring this product in again.`) && remove.mutate({ mdmProductId: p.id })}
              />
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

type Row = { id: string; name: string | null; bring: boolean; sinceDay: string | null; countsAs: string | null; orders: number; notBrought: number };

function ProductRow({ p, today, canEdit, busy, onSave, onRemove }: { p: Row; today: string; canEdit: boolean; busy: boolean; onSave: (bring: boolean, sinceDay: string | null) => void; onRemove: () => void }) {
  const name = p.name ?? `MDM product ${p.id}`;
  // A saved first day shows as "From a day"; the quick choices turn into a day when saved.
  const [from, setFrom] = React.useState<From>(p.sinceDay ? "day" : "all");
  const [day, setDay] = React.useState(p.sinceDay ?? addDays(today, -29));
  const pickFrom = (v: From) => {
    setFrom(v);
    if (v === "all") onSave(true, null);
    else if (v !== "day") {
      const d = addDays(today, -(Number(v) - 1));
      setDay(d);
      onSave(true, d);
    } else onSave(true, day);
  };
  return (
    <li className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate font-semibold">{name}</span>
          {!p.bring ? <Badge>Not brought in</Badge> : p.sinceDay ? <Badge tone="info">From {shortDay(p.sinceDay)}</Badge> : null}
        </div>
        <p className="mt-0.5 text-xs text-muted">
          <span className="num">{p.orders.toLocaleString("en-US")}</span> order{p.orders === 1 ? "" : "s"} in the app{p.countsAs && p.countsAs !== p.name ? ` · counts as ${p.countsAs}` : ""}
        </p>
        {p.notBrought ? (
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-warning">
            <span><span className="num">{p.notBrought}</span> already here aren&apos;t in this choice. They keep updating until you remove them.</span>
            {canEdit ? <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={busy} onClick={onRemove}><Trash2 /> Remove them</Button> : null}
          </p>
        ) : null}
      </div>
      {canEdit ? (
        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
          <Select aria-label={`Bring in ${name}`} value={p.bring ? "yes" : "no"} disabled={busy} onChange={(e) => onSave(e.target.value === "yes", e.target.value === "yes" && from === "day" ? day : null)} className="h-9 text-sm sm:w-36">
            <option value="yes">Bring in</option>
            <option value="no">Don&apos;t bring</option>
          </Select>
          <Select aria-label={`How far back for ${name}`} value={from} disabled={busy || !p.bring} onChange={(e) => pickFrom(e.target.value as From)} className="h-9 text-sm sm:w-40">
            {(Object.keys(FROM_LABEL) as Exclude<From, "day">[]).map((k) => <option key={k} value={k}>{FROM_LABEL[k]}</option>)}
            <option value="day">From a day…</option>
          </Select>
          {p.bring && from === "day" ? (
            <Input type="date" aria-label={`First day for ${name}`} value={day} max={today} disabled={busy} onChange={(e) => setDay(e.target.value)} onBlur={() => day && day !== p.sinceDay && onSave(true, day)} className="col-span-2 h-9 text-sm sm:w-40" />
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
