"use client";

import { useQuery } from "@tanstack/react-query";
import { Megaphone, Search, X } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Chip, Section } from "@/components/ui/choice";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/states";
import { HelpTip } from "@/components/ui/tooltip";
import { adFilterActive, adFilterSchema, type AdFilter } from "@/domain/adFilter";
import { useT } from "@/i18n/client";
import { englishT, msg, type TFunction } from "@/i18n/core";
import { useTRPC } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

/**
 * The Meta ads picked in the filter: Business Managers, ad accounts or campaigns. The pick follows
 * this browser to every page (dashboard, Profit tracker, orders, creatives, campaigns) until cleared.
 */
const storageKey = (workspaceId: string) => `cft:ads-filter:${workspaceId}`;
const PICKED_EVENT = "cft:ads-filter";
/** Used when browser storage is blocked (private mode): the pick lasts until the page reloads. */
const memory = new Map<string, string>();

function readPick(workspaceId: string): string | null {
  try {
    return localStorage.getItem(storageKey(workspaceId));
  } catch {
    return memory.get(workspaceId) ?? null;
  }
}

function writePick(workspaceId: string, f: AdFilter | null) {
  const raw = adFilterActive(f) ? JSON.stringify(f) : null;
  if (raw) memory.set(workspaceId, raw);
  else memory.delete(workspaceId);
  try {
    if (raw) localStorage.setItem(storageKey(workspaceId), raw);
    else localStorage.removeItem(storageKey(workspaceId));
  } catch {
    // Blocked storage: `memory` holds the pick.
  }
  window.dispatchEvent(new Event(PICKED_EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(PICKED_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(PICKED_EVENT, onChange);
  };
}

/** The ads picked for this workspace, or undefined for every ad. Pass `filter` as `ads` to the reports. */
export function useAdsFilter() {
  const trpc = useTRPC();
  const ws = useQuery(trpc.workspace.getCurrent.queryOptions());
  const workspaceId = ws.data?.id ?? null;
  const raw = React.useSyncExternalStore(subscribe, () => (workspaceId ? readPick(workspaceId) : null), () => null);
  const filter = React.useMemo(() => {
    if (!raw) return undefined;
    try {
      const parsed = adFilterSchema.safeParse(JSON.parse(raw));
      return parsed.success && adFilterActive(parsed.data) ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }, [raw]);
  const setFilter = React.useCallback((f: AdFilter | null) => workspaceId && writePick(workspaceId, f), [workspaceId]);
  return { filter, setFilter, active: !!filter };
}

/**
 * What the filter counts, in the picked language: "All ads", "3 campaigns", "1 Business Manager"
 * (adFilterLabel's words). `spelled` writes one as a word: "one campaign".
 */
export function adFilterText(f: AdFilter | null | undefined, t: TFunction = englishT, spelled = false): string {
  const n = (count: number, one: string, oneWord: string, many: string) => (count === 1 ? t(spelled ? oneWord : one) : t(many, { n: count }));
  if (!adFilterActive(f)) return t("All ads");
  if (f.campaignIds?.length) return n(f.campaignIds.length, msg("1 campaign"), msg("one campaign"), msg("{n} campaigns"));
  if (f.adAccountIds?.length) return n(f.adAccountIds.length, msg("1 ad account"), msg("one ad account"), msg("{n} ad accounts"));
  return n(f.tokenIds!.length, msg("1 Business Manager"), msg("one Business Manager"), msg("{n} Business Managers"));
}

// ─────────────────────────── The picker ───────────────────────────

const toggle = (list: string[] | undefined, v: string) => (list?.includes(v) ? list.filter((x) => x !== v) : [...(list ?? []), v]);

function Row({ checked, onChange, title, detail, aside }: { checked: boolean; onChange: () => void; title: string; detail?: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <label className={cn("flex cursor-pointer items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors", checked ? "bg-brand-soft" : "hover:bg-surface-2")}>
      <input type="checkbox" className="size-4 shrink-0 accent-[#e1182c]" checked={checked} onChange={onChange} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-semibold">{title}</span>
        {detail ? <span className="truncate text-[11px] text-muted">{detail}</span> : null}
      </span>
      {aside}
    </label>
  );
}

function Panel({ initial, onApply, onClose }: { initial: AdFilter | undefined; onApply: (f: AdFilter | null) => void; onClose: () => void }) {
  const trpc = useTRPC();
  const { t } = useT();
  const options = useQuery(trpc.campaigns.filterOptions.queryOptions());
  const [draft, setDraft] = React.useState<AdFilter>(initial ?? {});
  const [search, setSearch] = React.useState("");
  const [runningOnly, setRunningOnly] = React.useState(false);
  const o = options.data;

  const tokenName = new Map(o?.tokens.map((tk) => [tk.id, tk.label]) ?? []);
  const accountName = new Map(o?.accounts.map((a) => [a.externalId, a.name ?? a.externalId]) ?? []);
  const pickedTokens = draft.tokenIds ?? [];
  const pickedAccounts = draft.adAccountIds ?? [];
  const pickedCampaigns = draft.campaignIds ?? [];
  // Each level lists what the level above it allows.
  const accounts = (o?.accounts ?? []).filter((a) => !pickedTokens.length || (a.tokenId !== null && pickedTokens.includes(a.tokenId)));
  const accountIds = new Set(accounts.map((a) => a.externalId));
  const allowedAccounts = pickedAccounts.length ? new Set(pickedAccounts) : pickedTokens.length ? accountIds : null;
  const q = search.trim().toLowerCase();
  const campaigns = (o?.campaigns ?? []).filter(
    (c) =>
      (!allowedAccounts || (c.adAccountId !== null && allowedAccounts.has(c.adAccountId))) &&
      (!runningOnly || c.running || pickedCampaigns.includes(c.externalId)) &&
      (!q || (c.name ?? "").toLowerCase().includes(q) || c.externalId.includes(q)),
  );
  const groups = new Map<string, typeof campaigns>();
  for (const c of [...campaigns].sort((x, y) => Number(y.running) - Number(x.running))) {
    const k = c.adAccountId ?? "";
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }

  const setTokens = (tokenIds: string[]) => {
    // Ad accounts and campaigns outside the Business Managers picked are let go.
    const keep = new Set((o?.accounts ?? []).filter((a) => !tokenIds.length || (a.tokenId !== null && tokenIds.includes(a.tokenId))).map((a) => a.externalId));
    const campaignAccount = new Map(o?.campaigns.map((c) => [c.externalId, c.adAccountId]) ?? []);
    setDraft({ tokenIds, adAccountIds: pickedAccounts.filter((a) => keep.has(a)), campaignIds: pickedCampaigns.filter((c) => keep.has(campaignAccount.get(c) ?? "")) });
  };
  const setAccounts = (adAccountIds: string[]) => {
    const campaignAccount = new Map(o?.campaigns.map((c) => [c.externalId, c.adAccountId]) ?? []);
    setDraft({ ...draft, adAccountIds, campaignIds: adAccountIds.length ? pickedCampaigns.filter((c) => adAccountIds.includes(campaignAccount.get(c) ?? "")) : pickedCampaigns });
  };
  const summary = adFilterActive(draft) ? t("Counts {what}.", { what: adFilterText(draft, t, true) }) : t("Counts every ad, and orders without an ad.");

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent side="right" title={t("Filter by Meta ads")} description={t("Pick Business Managers, ad accounts, or campaigns from any ad accounts. The pick follows you to the dashboard, Profit tracker, orders, creatives and campaigns.")}>
        {!o ? (
          <div className="flex flex-col gap-3"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-40" /></div>
        ) : o.accounts.length === 0 && o.campaigns.length === 0 ? (
          <p className="text-sm text-muted">{t("No ad accounts or campaigns yet. Connect Meta in Settings → Meta ads, or import an Ads Manager export, and they show up here.")}</p>
        ) : (
          <div className="flex flex-col gap-6 pb-24">
            <p className="rounded-2xl bg-surface-2 px-4 py-3 text-xs leading-relaxed text-muted">{t("Campaigns you pick count on their own. Without campaigns, the ad accounts you pick count, or else every ad account of the Business Managers you pick.")}</p>
            {o.tokens.length ? (
              <Section title={t("Business Managers")} help={t("One for each Meta token saved in Settings > Meta ads. Picking one counts every ad account that token can read.")} aside={pickedTokens.length ? <button type="button" className="text-xs font-semibold text-brand-strong" onClick={() => setTokens([])}>{t("Clear")}</button> : null}>
                <div className="flex flex-wrap gap-2">
                  {o.tokens.map((tk) => (
                    <Chip key={tk.id} active={pickedTokens.includes(tk.id)} onClick={() => setTokens(toggle(pickedTokens, tk.id))}>{tk.label}</Chip>
                  ))}
                </div>
              </Section>
            ) : null}
            <Section title={pickedAccounts.length ? t("Ad accounts · {n} picked", { n: pickedAccounts.length }) : t("Ad accounts")} help={t("Tick ad accounts to count only their ads. An account marked from imported spend comes from an Ads Manager export, not from a token.")} aside={pickedAccounts.length ? <button type="button" className="text-xs font-semibold text-brand-strong" onClick={() => setAccounts([])}>{t("Clear")}</button> : null}>
              <div className="flex flex-col gap-0.5">
                {accounts.map((a) => (
                  <Row
                    key={a.externalId}
                    checked={pickedAccounts.includes(a.externalId)}
                    onChange={() => setAccounts(toggle(pickedAccounts, a.externalId))}
                    title={a.name ?? a.externalId}
                    detail={<>{a.externalId}{a.tokenId ? ` · ${tokenName.get(a.tokenId) ?? ""}` : ` · ${t("from imported spend")}`}</>}
                  />
                ))}
                {accounts.length === 0 ? <p className="px-3 text-sm text-muted">{t("No ad account in these Business Managers yet.")}</p> : null}
              </div>
            </Section>
            <Section title={pickedCampaigns.length ? t("Campaigns · {n} picked", { n: pickedCampaigns.length }) : t("Campaigns")} help={t("Tick campaigns to count only their ads, in any ad account. Running means on in Meta now; Running only hides paused and off ones, except those you ticked.")} aside={pickedCampaigns.length ? <button type="button" className="text-xs font-semibold text-brand-strong" onClick={() => setDraft({ ...draft, campaignIds: [] })}>{t("Clear")}</button> : null}>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
                  <Input aria-label={t("Search campaigns")} type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("Search campaigns")} className="ps-9" />
                </div>
                <Chip active={runningOnly} onClick={() => setRunningOnly((v) => !v)}>{t("Running only")}</Chip>
              </div>
              <div className="flex flex-col gap-3">
                {[...groups].map(([account, list]) => (
                  <div key={account} className="flex flex-col gap-0.5">
                    <span className="px-3 text-[11px] font-bold uppercase tracking-wide text-subtle">{account ? accountName.get(account) ?? account : t("No ad account (imported)")}</span>
                    {list.map((c) => (
                      <Row
                        key={c.externalId}
                        checked={pickedCampaigns.includes(c.externalId)}
                        onChange={() => setDraft({ ...draft, campaignIds: toggle(pickedCampaigns, c.externalId) })}
                        title={c.name ?? c.externalId}
                        detail={c.externalId}
                        aside={c.running ? <Badge tone="positive">{t("Running")}</Badge> : c.status === "PAUSED" ? <Badge>{t("Paused")}</Badge> : c.status ? <Badge>{t("Off")}</Badge> : null}
                      />
                    ))}
                  </div>
                ))}
                {campaigns.length === 0 ? <p className="px-3 text-sm text-muted">{t("No campaign matches.")}</p> : null}
              </div>
            </Section>
          </div>
        )}
        <div className="sticky bottom-0 -mx-5 -mb-5 mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface/95 px-5 py-4 backdrop-blur">
          <span className="text-sm font-semibold">{summary}</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => { onApply(null); onClose(); }}>{t("Show all ads")}</Button>
            <Button variant="primary" onClick={() => { onApply(adFilterActive(draft) ? draft : null); onClose(); }}>{t("Show results")}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The button that opens the Meta ads filter, with what is picked. Every page that counts ads shows it
 * and passes `useAdsFilter().filter` to its queries.
 */
export function AdsFilter({ className }: { className?: string }) {
  const { t } = useT();
  const { filter, setFilter } = useAdsFilter();
  const [open, setOpen] = React.useState(false);
  const active = !!filter;
  return (
    <>
      <div className={cn("flex items-center gap-1", className)}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t("Meta ads: {ads}", { ads: adFilterText(filter, t) })}
          className={cn(
            "press flex h-10 min-w-0 items-center gap-2 rounded-full px-4 text-sm font-semibold shadow-card transition-colors",
            active ? "bg-brand glow" : "bg-surface text-fg hover:bg-surface-2",
          )}
        >
          <Megaphone className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{adFilterText(filter, t)}</span>
        </button>
        {active ? (
          <button type="button" onClick={() => setFilter(null)} aria-label={t("Show all ads")} className="press grid size-8 shrink-0 place-items-center rounded-full bg-surface text-muted shadow-card hover:text-fg">
            <X className="size-3.5" />
          </button>
        ) : null}
        <HelpTip label={t("Filter by Meta ads")} className="ms-0.5">{t("Narrows the numbers to the Meta ads you pick: only their orders, their ad spend and their share of expenses. All ads also counts orders without an ad.")}</HelpTip>
      </div>
      {open ? <Panel initial={filter} onApply={setFilter} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
