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
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/core";
import { addDays, shortDay, todayIn } from "@/lib/dateRanges";
import { errorMessage, useTRPC } from "@/lib/trpc/client";

type From = "all" | "7" | "30" | "90" | "day";
const FROM_LABEL: Record<Exclude<From, "day">, string> = { all: msg("Every order"), "7": msg("Last 7 days"), "30": msg("Last 30 days"), "90": msg("Last 90 days") };

/**
 * Which MDM products the sync brings in, and how far back: one row per MDM product, with a
 * switch for new products. Orders already in the app keep updating; they leave only when removed here.
 */
export function MdmProductsCard({ timezone }: { timezone: string }) {
  const { t } = useT();
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
  const set = useMutation(trpc.sync.setMdmProduct.mutationOptions({ onSuccess: (r) => { refresh(); toast("success", r.widened ? t("Saved. The next sync brings in its orders.") : t("Saved. It applies from the next sync.")); }, onError }));
  const setNew = useMutation(trpc.sync.setBringNewMdmProducts.mutationOptions({ onSuccess: () => { refresh(); toast("success", t("Saved")); }, onError }));
  const remove = useMutation(trpc.sync.removeNotBrought.mutationOptions({ onSuccess: (r) => { refresh(); toast("success", r.orders === 1 ? t("1 order removed") : t("{n} orders removed", { n: r.orders })); }, onError }));
  const today = todayIn(timezone);
  const data = list.data;
  if (!data || (!data.products.length && data.bringNew)) return null;

  return (
    <Card className="min-w-0" role="region" aria-labelledby="mdm-bring-title">
      <CardHeader
        title={<span id="mdm-bring-title" className="inline-flex items-center gap-2"><PackageCheck className="size-4 text-brand-strong" /> {t("What to bring from MDM")}</span>}
        description={t("Pick the MDM products the sync brings in, and how far back. Orders already in the app keep updating.")}
      />
      <div className="flex flex-col gap-3 px-5 pb-5">
        <label className="flex flex-col gap-1.5 rounded-2xl bg-surface-2 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span className="font-semibold">{t("New products MDM sends")}</span>
          {canEdit ? (
            <Select aria-label={t("New products MDM sends")} value={data.bringNew ? "bring" : "wait"} disabled={setNew.isPending} onChange={(e) => setNew.mutate({ bring: e.target.value === "bring" })} className="h-9 w-full text-sm sm:w-64">
              <option value="bring">{t("Bring them in")}</option>
              <option value="wait">{t("Wait until I pick them")}</option>
            </Select>
          ) : <span className="text-muted">{data.bringNew ? t("Brought in") : t("Wait until someone picks them")}</span>}
        </label>
        {data.rereadPending ? (
          <p className="flex items-start gap-2 rounded-xl border border-info/30 bg-info-soft p-3 text-xs text-info"><RefreshCw className="mt-0.5 size-3.5 shrink-0" /> {t("The next sync reads every MDM order once, to bring in what you just turned on. It takes longer than usual.")}</p>
        ) : null}
        {!data.products.length ? <p className="text-sm text-muted">{t("No MDM product yet. They appear here after the first sync.")}</p> : (
          <ul className="flex flex-col divide-y divide-border rounded-2xl border border-border">
            {data.products.map((p) => (
              // Keyed by the saved day too, so the pickers start over from what was saved.
              <ProductRow key={`${p.id}:${p.sinceDay ?? ""}`} p={p} today={today} canEdit={canEdit} busy={set.isPending || remove.isPending}
                onSave={(bring, sinceDay) => set.mutate({ mdmProductId: p.id, bring, sinceDay })}
                onRemove={() => confirm(p.notBrought === 1
                  ? t("Remove 1 order of {name} and their parcels from the app? They come back if you bring this product in again.", { name: p.name ?? p.id })
                  : t("Remove {n} orders of {name} and their parcels from the app? They come back if you bring this product in again.", { n: p.notBrought, name: p.name ?? p.id })) && remove.mutate({ mdmProductId: p.id })}
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
  const { t, tx } = useT();
  const name = p.name ?? t("MDM product {id}", { id: p.id });
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
          {!p.bring ? <Badge>{t("Not brought in")}</Badge> : p.sinceDay ? <Badge tone="info">{t("From {day}", { day: shortDay(p.sinceDay, t) })}</Badge> : null}
        </div>
        <p className="mt-0.5 text-xs text-muted">
          {p.orders === 1
            ? tx("{n} order in the app", { n: <span className="num">{p.orders.toLocaleString("en-US")}</span> })
            : tx("{n} orders in the app", { n: <span className="num">{p.orders.toLocaleString("en-US")}</span> })}
          {p.countsAs && p.countsAs !== p.name ? ` · ${t("counts as {product}", { product: p.countsAs })}` : ""}
        </p>
        {p.notBrought ? (
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-warning">
            <span>{tx("{n} already here aren't in this choice. They keep updating until you remove them.", { n: <span className="num">{p.notBrought}</span> })}</span>
            {canEdit ? <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={busy} onClick={onRemove}><Trash2 /> {t("Remove them")}</Button> : null}
          </p>
        ) : null}
      </div>
      {canEdit ? (
        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
          <Select aria-label={t("Bring in {name}", { name })} value={p.bring ? "yes" : "no"} disabled={busy} onChange={(e) => onSave(e.target.value === "yes", e.target.value === "yes" && from === "day" ? day : null)} className="h-9 text-sm sm:w-36">
            <option value="yes">{t("Bring in")}</option>
            <option value="no">{t("Don't bring")}</option>
          </Select>
          <Select aria-label={t("How far back for {name}", { name })} value={from} disabled={busy || !p.bring} onChange={(e) => pickFrom(e.target.value as From)} className="h-9 text-sm sm:w-40">
            {(Object.keys(FROM_LABEL) as Exclude<From, "day">[]).map((k) => <option key={k} value={k}>{t(FROM_LABEL[k])}</option>)}
            <option value="day">{t("From a day…")}</option>
          </Select>
          {p.bring && from === "day" ? (
            <Input type="date" aria-label={t("First day for {name}", { name })} value={day} max={today} disabled={busy} onChange={(e) => setDay(e.target.value)} onBlur={() => day && day !== p.sinceDay && onSave(true, day)} className="col-span-2 h-9 text-sm sm:w-40" />
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
