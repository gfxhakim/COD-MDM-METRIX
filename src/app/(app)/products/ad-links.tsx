"use client";

import { useQuery } from "@tanstack/react-query";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/form";
import { Loading } from "@/components/ui/states";
import { useTRPC } from "@/lib/trpc/client";

export type AdLinks = { campaignIds: string[]; adAccountIds: string[] };

const STATUS: Record<string, string> = { ACTIVE: "Active", PAUSED: "Paused", IN_PROCESS: "Starting", WITH_ISSUES: "Has issues", NOT_LISTED: "Archived or deleted" };

/**
 * The ad accounts and campaigns whose spend counts for one product. `value` null = untouched
 * (the product's current links are shown and nothing is sent on save).
 */
export function AdLinksPicker({ productId, value, onChange, products }: { productId?: string; value: AdLinks | null; onChange: (v: AdLinks) => void; products: { id: string; name: string }[] }) {
  const trpc = useTRPC();
  const links = useQuery(trpc.campaigns.links.queryOptions());
  const [search, setSearch] = React.useState("");
  if (links.isLoading) return <Loading label="Loading ad accounts" />;
  const data = links.data;
  if (!data || (!data.accounts.length && !data.campaigns.length)) {
    return <p className="text-sm text-muted">No ad accounts or campaigns yet. Connect Meta in Settings or import ad spend, then link them here.</p>;
  }

  const current: AdLinks = value ?? {
    campaignIds: data.campaigns.filter((c) => productId && c.productId === productId).map((c) => c.id),
    adAccountIds: data.accounts.filter((a) => productId && a.defaultProductId === productId).map((a) => a.id),
  };
  const name = new Map(products.map((p) => [p.id, p.name]));
  const accountByExternal = new Map(data.accounts.map((a) => [a.externalId, a]));
  const toggle = (list: string[], id: string, on: boolean) => (on ? [...new Set([...list, id])] : list.filter((x) => x !== id));
  const elsewhere = (other: string | null) => (other && other !== productId ? <span className="text-[11px] text-warning">now {name.get(other) ?? "another product"}</span> : null);

  const s = search.trim().toLowerCase();
  const groups = new Map<string, typeof data.campaigns>();
  for (const c of data.campaigns) {
    if (s && !`${c.name} ${c.externalId}`.toLowerCase().includes(s)) continue;
    const k = c.adAccountId ?? "";
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  const accountLabel = (externalId: string) => {
    const a = accountByExternal.get(externalId);
    return a?.name ? `${a.name} (${externalId.replace("act_", "")})` : externalId || "Imported spend (no ad account)";
  };
  const viaAccount = (adAccountId: string | null) => {
    const a = adAccountId ? accountByExternal.get(adAccountId) : undefined;
    return !!a && current.adAccountIds.includes(a.id);
  };

  return (
    <div className="flex flex-col gap-3">
      {data.accounts.length ? (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-subtle">Whole ad accounts</legend>
          {data.accounts.map((a) => (
            <label key={a.id} className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[#b6f24a]" checked={current.adAccountIds.includes(a.id)} onChange={(e) => onChange({ ...current, adAccountIds: toggle(current.adAccountIds, a.id, e.target.checked) })} />
              <span className="flex min-w-0 flex-wrap items-center gap-x-2">
                <span className="break-words">Every campaign of {accountLabel(a.externalId)}</span>
                {elsewhere(a.defaultProductId)}
              </span>
            </label>
          ))}
          <p className="text-[11px] text-subtle">A campaign linked to its own product below still counts for that product.</p>
        </fieldset>
      ) : null}
      {data.campaigns.length ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-subtle">Campaigns</legend>
          {data.campaigns.length > 8 ? <Input aria-label="Search campaigns" placeholder="Search campaigns" value={search} onChange={(e) => setSearch(e.target.value)} className="h-8" /> : null}
          <div className="flex max-h-64 flex-col gap-3 overflow-y-auto rounded-lg border border-border p-2">
            {[...groups].map(([acct, list]) => (
              <div key={acct || "none"} className="flex flex-col gap-1.5">
                <span className="text-[11px] font-medium text-muted">{accountLabel(acct)}</span>
                {[...list].sort((x, y) => Number(y.running) - Number(x.running)).map((c) => (
                  <label key={c.id} className="flex items-start gap-2 pl-1 text-sm">
                    <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[#b6f24a]" checked={current.campaignIds.includes(c.id)} onChange={(e) => onChange({ ...current, campaignIds: toggle(current.campaignIds, c.id, e.target.checked) })} />
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="break-words">{c.name ?? c.externalId}</span>
                      {c.status ? <Badge tone={c.running ? "positive" : "neutral"}>{STATUS[c.status] ?? c.status}</Badge> : null}
                      {elsewhere(c.productId)}
                      {!current.campaignIds.includes(c.id) && !c.productId && viaAccount(c.adAccountId) ? <span className="text-[11px] text-subtle">included through its account</span> : null}
                    </span>
                  </label>
                ))}
              </div>
            ))}
            {!groups.size ? <p className="text-sm text-muted">No campaign matches.</p> : null}
          </div>
        </fieldset>
      ) : null}
    </div>
  );
}
