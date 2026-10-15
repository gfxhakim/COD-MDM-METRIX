"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileUp, Lock, Megaphone, Package, Receipt, Trash2, Truck, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { useCan } from "@/components/app/use-can";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/form";
import { EmptyState, ErrorState, Loading } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/i18n/client";
import { msg, type TFunction } from "@/i18n/core";
import { errorMessage, useTRPC } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

type Target = "mdm" | "meta" | "imports" | "expenses" | "products" | "everything";

const n = (v: number) => v.toLocaleString("en-US");
/** "1 order" or "1,234 orders": `one` and `many` are texts marked with msg(), `many` with an {n}. */
const plural = (t: TFunction, v: number, one: string, many: string) => (v === 1 ? t(one) : t(many, { n: n(v) }));

/** What the dialog says goes, and what stays, for each kind. */
const DETAILS: Record<Target, { title: string; goes: string[]; stays: string[]; stopLabel?: string }> = {
  mdm: {
    title: msg("everything from MDM"),
    goes: [msg("Orders and parcels read from MDM, with their status history"), msg("Money and stock copied from MDM, and the sync history"), msg("Customer details MDM added to imported orders")],
    stays: [msg("Your MDM key and your choices of what to bring from MDM"), msg("Your products and their costs"), msg("The next sync brings back what MDM still has")],
    stopLabel: msg("Also remove my MDM key, so syncs stop"),
  },
  meta: {
    title: msg("the ad spend from Meta"),
    goes: [msg("Every day of spend, impressions and clicks read from Meta")],
    stays: [msg("Your Meta tokens, ad accounts and the campaigns linked to products"), msg("Ad spend from imported files, which counts again"), msg("The next spend sync reads the last 180 days again")],
    stopLabel: msg("Also remove my Meta tokens, so spend syncs stop"),
  },
  imports: {
    title: msg("every imported file"),
    goes: [msg("Every file in Imports, with the orders, ad spend, expenses and bank rows it added")],
    stays: [msg("Everything synced from MDM and Meta, and what you typed in")],
  },
  expenses: {
    title: msg("the expenses you added"),
    goes: [msg("Every expense you typed in, your pay included"), msg("Every repeating expense"), msg("Your own categories that nothing uses any more")],
    stays: [msg("Expenses from imported files")],
  },
  products: {
    title: msg("your products and costs"),
    goes: [msg("Every product, with its prices, costs and saved Profit tracker numbers"), msg("Links between campaigns and products")],
    stays: [msg("Orders, without a product: profit has no costs until you add products again"), msg("Products MDM sends come back with the next sync, marked Needs details")],
  },
  everything: {
    title: msg("all the data of this business"),
    goes: [msg("Every order, parcel, ad spend, import, expense, product, creative and campaign"), msg("Money and stock copied from MDM, and the sync history")],
    stays: [msg("Members and roles, settings, exchange rates and status mappings"), msg("Your choices of what to bring from MDM, and the audit log")],
    stopLabel: msg("Also remove my MDM key and Meta tokens, so syncs stop"),
  },
};

/**
 * Settings > Your data: how much of each kind of data the business has, and a button to delete
 * each kind, or everything. The owner types DELETE to confirm; nothing here can be undone.
 */
export function DataTab() {
  const { t, tx, locale } = useT();
  const trpc = useTRPC();
  const canDelete = useCan("data.delete");
  const summary = useQuery({ ...trpc.data.summary.queryOptions(), enabled: canDelete });
  const [deleting, setDeleting] = React.useState<Target | null>(null);

  if (!canDelete) {
    return <Card><EmptyState icon={<Lock className="size-6" />} title={t("Only the owner can delete data")} description={t("Ask the owner of this business if something should be deleted.")} /></Card>;
  }
  if (summary.error) return <ErrorState message={errorMessage(summary.error)} />;
  const s = summary.data;
  if (!s) return <Loading />;

  const count = (v: number, one: string, many: string) => plural(t, v, one, many);
  const imported = ([
    [s.imports.orders, msg("1 order"), msg("{n} orders")],
    [s.imports.adSpend, msg("1 ad spend row"), msg("{n} ad spend rows")],
    [s.imports.expenses, msg("1 expense"), msg("{n} expenses")],
    [s.imports.bankRows, msg("1 bank row"), msg("{n} bank rows")],
  ] as [number, string, string][])
    .filter(([v]) => v)
    .map(([v, one, many]) => count(v, one, many))
    .join(locale === "ar" ? "، " : ", ");
  const mdmParts = { orders: count(s.mdm.orders, msg("1 order"), msg("{n} orders")), parcels: count(s.mdm.parcels, msg("1 parcel"), msg("{n} parcels")), syncs: count(s.mdm.syncs, msg("1 sync"), msg("{n} syncs")) };
  const rows: { target: Exclude<Target, "everything">; icon: LucideIcon; title: string; what: string; count: number; note?: React.ReactNode; busy?: string }[] = [
    {
      target: "mdm",
      icon: Truck,
      title: t("From MDM Express"),
      count: s.mdm.orders + s.mdm.parcels + s.mdm.syncs + (s.mdm.money ? 1 : 0),
      what: s.mdm.money ? t("{orders}, {parcels}, money and stock, {syncs} in the history", mdmParts) : t("{orders}, {parcels}, {syncs} in the history", mdmParts),
      note: s.mdm.keySaved ? t("The next sync brings back what MDM still has.") : undefined,
      busy: s.mdm.busy ? t("An MDM sync is running. You can delete once it has finished.") : undefined,
    },
    {
      target: "meta",
      icon: Megaphone,
      title: t("From Meta ads"),
      count: s.meta.spendRows,
      what: s.meta.spendRows
        ? t("{days} of spend for {ads}, {from} to {to}", { days: count(s.meta.spendRows, msg("1 day"), msg("{n} days")), ads: count(s.meta.ads, msg("1 ad"), msg("{n} ads")), from: s.meta.from ?? "", to: s.meta.to ?? "" })
        : t("No ad spend read from Meta"),
      note: s.meta.tokens ? t("The next spend sync reads the last 180 days again.") : undefined,
      busy: s.meta.busy ? t("A spend sync is running. You can delete once it has finished.") : undefined,
    },
    {
      target: "imports",
      icon: FileUp,
      title: t("Imported files"),
      count: s.imports.files,
      what: s.imports.files
        ? s.imports.files === 1
          ? t("1 file: {list}", { list: imported || t("nothing imported") })
          : t("{n} files: {list}", { n: n(s.imports.files), list: imported || t("nothing imported") })
        : t("No imported files"),
      note: s.imports.files ? tx("To delete one file only, open {imports} and use its history.", { imports: <Link href="/imports" className="font-semibold text-brand-strong hover:underline">{t("Imports")}</Link> }) : undefined,
    },
    {
      target: "expenses",
      icon: Receipt,
      title: t("Expenses you added"),
      count: s.expenses.expenses + s.expenses.recurring + s.expenses.categories,
      what: t("{expenses}, {recurring}, {categories} of your own", {
        expenses: count(s.expenses.expenses, msg("1 expense"), msg("{n} expenses")),
        recurring: count(s.expenses.recurring, msg("1 repeating expense"), msg("{n} repeating expenses")),
        categories: count(s.expenses.categories, msg("1 category"), msg("{n} categories")),
      }),
    },
    {
      target: "products",
      icon: Package,
      title: t("Products and costs"),
      count: s.products.products,
      what: t("{products} with {versions}", { products: count(s.products.products, msg("1 product"), msg("{n} products")), versions: count(s.products.costVersions, msg("1 price and cost version"), msg("{n} price and cost versions")) }),
    },
  ];
  const anything = rows.some((r) => r.count > 0) || s.everything.orders > 0 || s.everything.creatives > 0;

  return (
    <div className="flex flex-col gap-6">
      <Card role="region" aria-labelledby="your-data-title">
        <CardHeader
          title={<span id="your-data-title">{t("Your data")}</span>}
          description={t("What the app keeps for this business, by where it came from. Delete any kind when you want; it can't be undone. Members, settings and the audit log always stay.")}
        />
        <ul className="flex flex-col divide-y divide-border px-5 pb-3">
          {rows.map((r) => (
            <li key={r.target} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
              <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand-strong"><r.icon className="size-5" aria-hidden="true" /></span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{r.title}</p>
                <p className="text-sm text-muted">{r.what}</p>
                {r.busy ? <p className="mt-0.5 text-xs text-warning">{r.busy}</p> : r.note ? <p className="mt-0.5 text-xs text-subtle">{r.note}</p> : null}
              </div>
              <Button variant="danger" size="sm" className="self-start sm:self-center" disabled={!r.count || !!r.busy} onClick={() => setDeleting(r.target)} aria-label={t("Delete {what}", { what: r.title })}>
                <Trash2 /> {t("Delete")}
              </Button>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="border-negative/30">
        <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-negative">{t("Delete everything")}</p>
            <p className="text-sm text-muted">{t("Start this business over: every order, parcel, ad spend, import, expense, product and creative goes. Members and settings stay.")}</p>
            {s.mdm.busy || s.meta.busy ? <p className="mt-0.5 text-xs text-warning">{t("A sync is running. You can delete once it has finished.")}</p> : null}
          </div>
          <Button variant="danger" className="self-start sm:self-center" disabled={!anything || s.mdm.busy || s.meta.busy} onClick={() => setDeleting("everything")}>
            <Trash2 /> {t("Delete everything")}
          </Button>
        </CardBody>
      </Card>

      {deleting ? <ConfirmDelete target={deleting} keysSaved={{ mdm: s.mdm.keySaved, meta: s.meta.tokens > 0 }} onClose={() => setDeleting(null)} /> : null}
    </div>
  );
}

function ConfirmDelete({ target, keysSaved, onClose }: { target: Target; keysSaved: { mdm: boolean; meta: boolean }; onClose: () => void }) {
  const { t } = useT();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const router = useRouter();
  const toast = useToast();
  const [typed, setTyped] = React.useState("");
  const [stopSyncs, setStopSyncs] = React.useState(false);
  const d = DETAILS[target];
  // The word to type stays DELETE in every language.
  const ready = typed.trim().toUpperCase() === "DELETE";
  // The key option only shows when there is a key or token to remove.
  const canStop = !!d.stopLabel && (target === "mdm" ? keysSaved.mdm : target === "meta" ? keysSaved.meta : keysSaved.mdm || keysSaved.meta);
  const del = useMutation(
    trpc.data.delete.mutationOptions({
      onSuccess: async () => {
        onClose();
        toast("success", t("Deleted {what}", { what: t(d.title) }));
        // Every page's numbers change: refetch everything, and the server-drawn parts too.
        await qc.invalidateQueries();
        router.refresh();
      },
      onError: (e) => toast("error", errorMessage(e)),
    }),
  );
  return (
    <Dialog open onOpenChange={(o) => !o && !del.isPending && onClose()}>
      <DialogContent title={t("Delete {what}?", { what: t(d.title) })} description={t("This can't be undone.")}>
        <div className="flex flex-col gap-4 text-sm">
          <div>
            <p className="font-semibold text-negative">{t("Deleted")}</p>
            <ul className="mt-1 flex list-disc flex-col gap-1 ps-5 text-muted">{d.goes.map((g) => <li key={g}>{t(g)}</li>)}</ul>
          </div>
          <div>
            <p className="font-semibold">{t("Kept")}</p>
            <ul className="mt-1 flex list-disc flex-col gap-1 ps-5 text-muted">{d.stays.map((g) => <li key={g}>{t(g)}</li>)}</ul>
          </div>
          {canStop && d.stopLabel ? (
            <label className="flex items-start gap-2 rounded-2xl bg-surface-2 p-3">
              <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[#e1182c]" checked={stopSyncs} onChange={(e) => setStopSyncs(e.target.checked)} />
              <span>{t(d.stopLabel)}<span className="block text-xs text-subtle">{t("You can add it again later in Settings.")}</span></span>
            </label>
          ) : null}
          <label className="flex flex-col gap-1.5">
            <span className="font-semibold">{t("Type DELETE to confirm")}</span>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} aria-label={t("Type DELETE to confirm")} className={cn(ready && "border-negative/50")} />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={del.isPending} onClick={onClose}>{t("Cancel")}</Button>
            <Button variant="danger" disabled={!ready || del.isPending} onClick={() => del.mutate({ target, stopSyncs: canStop && stopSyncs, confirm: "DELETE" })}>
              <Trash2 /> {del.isPending ? t("Deleting…") : t("Delete")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
