"use client";

import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { useCan } from "@/components/app/use-can";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTRPC } from "@/lib/trpc/client";
import { BankReview } from "./bank-review";
import { KIND_META, type Kind } from "./download";
import { ImportHistory } from "./import-history";
import { ImportWizard } from "./import-wizard";
import { UnmatchedSpend } from "./unmatched-spend";

const TABS: [string, Kind][] = [["orders", "ORDERS"], ["spend", "AD_SPEND"], ["expenses", "EXPENSES"], ["bank", "BANK"]];

export function ImportsView({ tab }: { tab: string }) {
  const trpc = useTRPC();
  const router = useRouter();
  const pathname = usePathname();
  const canImport = useCan("imports.write");
  const ws = useQuery(trpc.workspace.getCurrent.queryOptions());
  const pending = useQuery(trpc.bank.list.queryOptions({ status: "PENDING", limit: 1 }));
  const currency = ws.data?.currency ?? "DZD";
  const active = TABS.some(([t]) => t === tab) ? tab : "orders";
  const pendingCount = pending.data?.counts.PENDING?.count ?? 0;

  return (
    <>
      <PageHeader title="Imports" description="Add orders, Meta ad spend, expenses or bank statements from a file. Nothing is saved before you check it, and the same file never counts twice." />
      <Tabs value={active} onValueChange={(v) => router.replace(`${pathname}?tab=${v}`, { scroll: false })}>
        <TabsList className="mb-6">
          {TABS.map(([t, kind]) => (
            <TabsTrigger key={t} value={t}>
              {KIND_META[kind].label}
              {kind === "BANK" && pendingCount ? <span className="num ml-1.5 rounded bg-warning-soft px-1 text-[11px] text-warning">{pendingCount}</span> : null}
            </TabsTrigger>
          ))}
        </TabsList>
        {TABS.map(([t, kind]) => (
          <TabsContent key={t} value={t} className="flex flex-col gap-6">
            {canImport ? <ImportWizard kind={kind} currency={currency} /> : <p className="rounded-lg border border-border bg-surface-2 p-3 text-sm text-muted">Your role can view import history but not import files. Ask an owner or admin.</p>}
            {kind === "BANK" ? <BankReview /> : null}
            {kind === "AD_SPEND" ? <UnmatchedSpend currency={currency} /> : null}
            <ImportHistory kind={kind} />
          </TabsContent>
        ))}
      </Tabs>
    </>
  );
}
