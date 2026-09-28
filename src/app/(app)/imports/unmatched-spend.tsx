"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2 } from "lucide-react";
import * as React from "react";
import { Money } from "@/components/app/format";
import { useCan } from "@/components/app/use-can";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { ErrorState, Loading } from "@/components/ui/states";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { errorMessage, useTRPC } from "@/lib/trpc/client";
import { formatDate } from "@/lib/utils";

type Group = { externalCreativeId: string | null; rows: number; spend: number; from: Date | null; to: Date | null; adName: string | null; campaignName: string | null };

function ResolveDialog({ group, currency, onClose }: { group: Group & { externalCreativeId: string }; currency: string; onClose: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const creatives = useQuery(trpc.creatives.list.queryOptions());
  const products = useQuery(trpc.products.list.queryOptions({ includeInactive: false }));
  const [mode, setMode] = React.useState<"create" | "link">("create");
  const [name, setName] = React.useState(group.adName ?? group.externalCreativeId);
  const [productId, setProductId] = React.useState("");
  const [creativeId, setCreativeId] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const m = useMutation(
    trpc.spendReview.resolve.mutationOptions({
      onSuccess: (r) => {
        for (const key of [trpc.spendReview, trpc.creatives, trpc.reports]) qc.invalidateQueries({ queryKey: key.pathKey() });
        toast("success", `${r.rows} spend rows matched${r.relinkedOrders ? `, ${r.relinkedOrders} orders linked` : ""}`);
        onClose();
      },
      onError: (e) => setError(errorMessage(e)),
    }),
  );
  const options = creatives.data ?? [];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Match unmatched spend" description={<>ID <span className="font-mono">{group.externalCreativeId}</span> · <Money value={group.spend} currency={currency} /> across {group.rows} rows</>}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            m.mutate(mode === "create" ? { externalCreativeId: group.externalCreativeId, create: { name, productId: productId || null } } : { externalCreativeId: group.externalCreativeId, creativeId });
          }}
        >
          <Field label="Action" htmlFor="um"><Select id="um" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}><option value="create">Create a creative for this ID</option><option value="link">Link to an existing creative</option></Select></Field>
          {mode === "create" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" htmlFor="un"><Input id="un" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} /></Field>
              <Field label="Product" htmlFor="up"><Select id="up" value={productId} onChange={(e) => setProductId(e.target.value)}><option value="">Assign later</option>{products.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
            </div>
          ) : (
            <Field label="Creative" htmlFor="uc" hint="Use this when the ad was renamed or the ID differs from the utm_content on orders.">
              <Select id="uc" required value={creativeId} onChange={(e) => setCreativeId(e.target.value)}>
                <option value="">Choose creative…</option>
                {options.map((c) => <option key={c.id} value={c.id}>{c.name ?? c.externalCreativeId} ({c.externalCreativeId})</option>)}
              </Select>
            </Field>
          )}
          {error ? <p className="text-sm text-negative" role="alert">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={m.isPending}>Match spend</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function UnmatchedSpend({ currency }: { currency: string }) {
  const trpc = useTRPC();
  const canWrite = useCan("catalog.write");
  const q = useQuery(trpc.spendReview.unmatched.queryOptions());
  const [resolving, setResolving] = React.useState<(Group & { externalCreativeId: string }) | null>(null);
  if (q.error) return <Card><ErrorState message={errorMessage(q.error)} /></Card>;
  if (q.isLoading) return <Card><Loading /></Card>;
  const groups = q.data ?? [];
  if (!groups.length) return null;
  const total = groups.reduce((a, g) => a + g.spend, 0);
  return (
    <Card>
      <CardHeader
        title="Unmatched spend"
        description={<>Spend whose creative ID matches no creative. It still counts against business profit, but not against any creative. Total: <Money value={total} currency={currency} className="text-warning" /></>}
      />
      <div className="overflow-x-auto">
        <Table>
          <THead><tr><Th>Creative / ad ID</Th><Th>Ad</Th><Th>Campaign</Th><Th>Dates</Th><Th className="text-right">Rows</Th><Th className="text-right">Spend</Th><Th><span className="sr-only">Actions</span></Th></tr></THead>
          <tbody>
            {groups.map((g) => (
              <Tr key={g.externalCreativeId ?? "none"}>
                <Td className="font-mono text-xs">{g.externalCreativeId ?? <span className="text-muted">No ID in export</span>}</Td>
                <Td className="max-w-48 truncate">{g.adName ?? "—"}</Td>
                <Td className="max-w-48 truncate text-muted">{g.campaignName ?? "—"}</Td>
                <Td className="whitespace-nowrap text-xs text-muted">{formatDate(g.from)} – {formatDate(g.to)}</Td>
                <Td className="num text-right">{g.rows}</Td>
                <Td className="text-right"><Money value={g.spend} currency={currency} /></Td>
                <Td>
                  {canWrite && g.externalCreativeId ? (
                    <div className="flex justify-end"><Button size="sm" variant="outline" onClick={() => setResolving(g as Group & { externalCreativeId: string })}><Link2 /> Match</Button></div>
                  ) : null}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </div>
      {resolving ? <ResolveDialog group={resolving} currency={currency} onClose={() => setResolving(null)} /> : null}
    </Card>
  );
}
