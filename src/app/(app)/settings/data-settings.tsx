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
import { errorMessage, useTRPC } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

type Target = "mdm" | "meta" | "imports" | "expenses" | "products" | "everything";

const n = (v: number) => v.toLocaleString("en-US");
const plural = (v: number, one: string, many = `${one}s`) => `${n(v)} ${v === 1 ? one : many}`;

/** What the dialog says goes, and what stays, for each kind. */
const DETAILS: Record<Target, { title: string; goes: string[]; stays: string[]; stopLabel?: string }> = {
  mdm: {
    title: "everything from MDM",
    goes: ["Orders and parcels read from MDM, with their status history", "Money and stock copied from MDM, and the sync history", "Customer details MDM added to imported orders"],
    stays: ["Your MDM key and your choices of what to bring from MDM", "Your products and their costs", "The next sync brings back what MDM still has"],
    stopLabel: "Also remove my MDM key, so syncs stop",
  },
  meta: {
    title: "the ad spend from Meta",
    goes: ["Every day of spend, impressions and clicks read from Meta"],
    stays: ["Your Meta tokens, ad accounts and the campaigns linked to products", "Ad spend from imported files, which counts again", "The next spend sync reads the last 180 days again"],
    stopLabel: "Also remove my Meta tokens, so spend syncs stop",
  },
  imports: {
    title: "every imported file",
    goes: ["Every file in Imports, with the orders, ad spend, expenses and bank rows it added"],
    stays: ["Everything synced from MDM and Meta, and what you typed in"],
  },
  expenses: {
    title: "the expenses you added",
    goes: ["Every expense you typed in, your pay included", "Every repeating expense", "Your own categories that nothing uses any more"],
    stays: ["Expenses from imported files"],
  },
  products: {
    title: "your products and costs",
    goes: ["Every product, with its prices, costs and saved Profit tracker numbers", "Links between campaigns and products"],
    stays: ["Orders, without a product: profit has no costs until you add products again", "Products MDM sends come back with the next sync, marked Needs details"],
  },
  everything: {
    title: "all the data of this business",
    goes: ["Every order, parcel, ad spend, import, expense, product, creative and campaign", "Money and stock copied from MDM, and the sync history"],
    stays: ["Members and roles, settings, exchange rates and status mappings", "Your choices of what to bring from MDM, and the audit log"],
    stopLabel: "Also remove my MDM key and Meta tokens, so syncs stop",
  },
};

/**
 * Settings > Your data: how much of each kind of data the business has, and a button to delete
 * each kind, or everything. The owner types DELETE to confirm; nothing here can be undone.
 */
export function DataTab() {
  const trpc = useTRPC();
  const canDelete = useCan("data.delete");
  const summary = useQuery({ ...trpc.data.summary.queryOptions(), enabled: canDelete });
  const [deleting, setDeleting] = React.useState<Target | null>(null);

  if (!canDelete) {
    return <Card><EmptyState icon={<Lock className="size-6" />} title="Only the owner can delete data" description="Ask the owner of this business if something should be deleted." /></Card>;
  }
  if (summary.error) return <ErrorState message={errorMessage(summary.error)} />;
  const s = summary.data;
  if (!s) return <Loading />;

  const rows: { target: Exclude<Target, "everything">; icon: LucideIcon; title: string; what: string; count: number; note?: React.ReactNode; busy?: string }[] = [
    {
      target: "mdm",
      icon: Truck,
      title: "From MDM Express",
      count: s.mdm.orders + s.mdm.parcels + s.mdm.syncs + (s.mdm.money ? 1 : 0),
      what: `${plural(s.mdm.orders, "order")}, ${plural(s.mdm.parcels, "parcel")}${s.mdm.money ? ", money and stock" : ""}, ${plural(s.mdm.syncs, "sync")} in the history`,
      note: s.mdm.keySaved ? "The next sync brings back what MDM still has." : undefined,
      busy: s.mdm.busy ? "An MDM sync is running. You can delete once it has finished." : undefined,
    },
    {
      target: "meta",
      icon: Megaphone,
      title: "From Meta ads",
      count: s.meta.spendRows,
      what: s.meta.spendRows ? `${plural(s.meta.spendRows, "day")} of spend for ${plural(s.meta.ads, "ad")}, ${s.meta.from} to ${s.meta.to}` : "No ad spend read from Meta",
      note: s.meta.tokens ? "The next spend sync reads the last 180 days again." : undefined,
      busy: s.meta.busy ? "A spend sync is running. You can delete once it has finished." : undefined,
    },
    {
      target: "imports",
      icon: FileUp,
      title: "Imported files",
      count: s.imports.files,
      what: s.imports.files
        ? `${plural(s.imports.files, "file")}: ${[[s.imports.orders, "order"], [s.imports.adSpend, "ad spend row"], [s.imports.expenses, "expense"], [s.imports.bankRows, "bank row"]].filter(([v]) => v).map(([v, w]) => plural(v as number, w as string)).join(", ") || "nothing imported"}`
        : "No imported files",
      note: s.imports.files ? <>To delete one file only, open <Link href="/imports" className="font-semibold text-brand-strong hover:underline">Imports</Link> and use its history.</> : undefined,
    },
    {
      target: "expenses",
      icon: Receipt,
      title: "Expenses you added",
      count: s.expenses.expenses + s.expenses.recurring + s.expenses.categories,
      what: `${plural(s.expenses.expenses, "expense")}, ${plural(s.expenses.recurring, "repeating expense")}, ${plural(s.expenses.categories, "category", "categories")} of your own`,
    },
    {
      target: "products",
      icon: Package,
      title: "Products and costs",
      count: s.products.products,
      what: `${plural(s.products.products, "product")} with ${plural(s.products.costVersions, "price and cost version")}`,
    },
  ];
  const anything = rows.some((r) => r.count > 0) || s.everything.orders > 0 || s.everything.creatives > 0;

  return (
    <div className="flex flex-col gap-6">
      <Card role="region" aria-labelledby="your-data-title">
        <CardHeader
          title={<span id="your-data-title">Your data</span>}
          description="What the app keeps for this business, by where it came from. Delete any kind when you want; it can't be undone. Members, settings and the audit log always stay."
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
              <Button variant="danger" size="sm" className="self-start sm:self-center" disabled={!r.count || !!r.busy} onClick={() => setDeleting(r.target)} aria-label={`Delete ${r.title}`}>
                <Trash2 /> Delete
              </Button>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="border-negative/30">
        <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-negative">Delete everything</p>
            <p className="text-sm text-muted">Start this business over: every order, parcel, ad spend, import, expense, product and creative goes. Members and settings stay.</p>
            {s.mdm.busy || s.meta.busy ? <p className="mt-0.5 text-xs text-warning">A sync is running. You can delete once it has finished.</p> : null}
          </div>
          <Button variant="danger" className="self-start sm:self-center" disabled={!anything || s.mdm.busy || s.meta.busy} onClick={() => setDeleting("everything")}>
            <Trash2 /> Delete everything
          </Button>
        </CardBody>
      </Card>

      {deleting ? <ConfirmDelete target={deleting} keysSaved={{ mdm: s.mdm.keySaved, meta: s.meta.tokens > 0 }} onClose={() => setDeleting(null)} /> : null}
    </div>
  );
}

function ConfirmDelete({ target, keysSaved, onClose }: { target: Target; keysSaved: { mdm: boolean; meta: boolean }; onClose: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const router = useRouter();
  const toast = useToast();
  const [typed, setTyped] = React.useState("");
  const [stopSyncs, setStopSyncs] = React.useState(false);
  const d = DETAILS[target];
  const ready = typed.trim().toUpperCase() === "DELETE";
  // The key option only shows when there is a key or token to remove.
  const canStop = !!d.stopLabel && (target === "mdm" ? keysSaved.mdm : target === "meta" ? keysSaved.meta : keysSaved.mdm || keysSaved.meta);
  const del = useMutation(
    trpc.data.delete.mutationOptions({
      onSuccess: async () => {
        onClose();
        toast("success", `Deleted ${d.title}`);
        // Every page's numbers change: refetch everything, and the server-drawn parts too.
        await qc.invalidateQueries();
        router.refresh();
      },
      onError: (e) => toast("error", errorMessage(e)),
    }),
  );
  return (
    <Dialog open onOpenChange={(o) => !o && !del.isPending && onClose()}>
      <DialogContent title={`Delete ${d.title}?`} description="This can't be undone.">
        <div className="flex flex-col gap-4 text-sm">
          <div>
            <p className="font-semibold text-negative">Deleted</p>
            <ul className="mt-1 flex list-disc flex-col gap-1 ps-5 text-muted">{d.goes.map((g) => <li key={g}>{g}</li>)}</ul>
          </div>
          <div>
            <p className="font-semibold">Kept</p>
            <ul className="mt-1 flex list-disc flex-col gap-1 ps-5 text-muted">{d.stays.map((g) => <li key={g}>{g}</li>)}</ul>
          </div>
          {canStop ? (
            <label className="flex items-start gap-2 rounded-2xl bg-surface-2 p-3">
              <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[#e1182c]" checked={stopSyncs} onChange={(e) => setStopSyncs(e.target.checked)} />
              <span>{d.stopLabel}<span className="block text-xs text-subtle">You can add it again later in Settings.</span></span>
            </label>
          ) : null}
          <label className="flex flex-col gap-1.5">
            <span className="font-semibold">Type DELETE to confirm</span>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} aria-label="Type DELETE to confirm" className={cn(ready && "border-negative/50")} />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={del.isPending} onClick={onClose}>Cancel</Button>
            <Button variant="danger" disabled={!ready || del.isPending} onClick={() => del.mutate({ target, stopSyncs: canStop && stopSyncs, confirm: "DELETE" })}>
              <Trash2 /> {del.isPending ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
