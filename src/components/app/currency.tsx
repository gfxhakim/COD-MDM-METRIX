"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Select } from "@/components/ui/form";
import { convertWithRates, formatMoney } from "@/lib/money";
import { useTRPC } from "@/lib/trpc/client";

/**
 * Which currency amounts are shown in. Stored amounts never change: each keeps its own
 * currency, and is converted for display with the workspace's rates (Settings > Economics &
 * currencies). The workspace sets a default (Settings > Workspace); each viewer can pick
 * another one in the header, remembered in this browser only.
 */
type CurrencyView = {
  ready: boolean;
  /** Currency stored amounts are kept in. */
  book: string;
  /** The workspace's report currency. */
  report: string;
  /** What this browser shows. */
  view: string;
  /** The workspace's own currency plus every one with a saved rate. */
  available: string[];
  rates: Partial<Record<string, number>>;
  setView: (currency: string) => void;
};

const FALLBACK: CurrencyView = { ready: false, book: "DZD", report: "DZD", view: "DZD", available: ["DZD"], rates: {}, setView: () => {} };
const Ctx = React.createContext<CurrencyView>(FALLBACK);
const storageKey = (workspaceId: string) => `cft:view-currency:${workspaceId}`;
const PICKED_EVENT = "cft:view-currency";

/** Used when browser storage is blocked (private mode): the pick lasts until the page reloads. */
const memory = new Map<string, string>();

/** This browser's pick, if any. */
function readPick(workspaceId: string): string | null {
  try {
    return localStorage.getItem(storageKey(workspaceId));
  } catch {
    return memory.get(workspaceId) ?? null;
  }
}

function writePick(workspaceId: string, currency: string | null) {
  if (currency) memory.set(workspaceId, currency);
  else memory.delete(workspaceId);
  try {
    if (currency) localStorage.setItem(storageKey(workspaceId), currency);
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

export function CurrencyProvider({ workspaceId, children }: { workspaceId: string; children: React.ReactNode }) {
  const trpc = useTRPC();
  const ws = useQuery(trpc.workspace.getCurrent.queryOptions());
  const picked = React.useSyncExternalStore(subscribe, () => readPick(workspaceId), () => null);

  const value = React.useMemo<CurrencyView>(() => {
    if (!ws.data) return FALLBACK;
    const { currency: book, reportCurrency: report, exchangeRates: rates } = ws.data;
    const available = [book, ...Object.keys(rates).filter((c) => c !== book).sort()];
    // A pick whose rate was removed since falls back to the workspace default.
    const view = picked && available.includes(picked) ? picked : available.includes(report) ? report : book;
    const setView = (currency: string) => writePick(workspaceId, currency === report ? null : currency);
    return { ready: true, book, report, view, available, rates, setView };
  }, [ws.data, picked, workspaceId]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCurrencyView() {
  return React.useContext(Ctx);
}

/** Formats amounts in the currency being viewed. Amounts without a rate stay in their own currency. */
export function useMoney() {
  const v = useCurrencyView();
  return React.useMemo(() => {
    const convert = (minor: number, currency: string) => {
      const out = v.ready ? convertWithRates(minor, currency, v.view, v.book, v.rates) : null;
      return out === null ? { minor, currency, converted: false } : { minor: out, currency: v.view, converted: currency !== v.view };
    };
    /** "1 USD = 250 DZD": the Settings rate a conversion between these two used. */
    const rateNote = (from: string) => {
      const foreign = from === v.book ? v.view : from;
      const rate = v.rates[foreign];
      return rate ? `1 ${foreign} = ${rate} ${v.book}` : "";
    };
    const fmt = (minor: number, currency: string, opts?: { decimals?: boolean }) => {
      const c = convert(minor, currency);
      return formatMoney(c.minor, c.currency, opts);
    };
    return { ...v, convert, fmt, rateNote };
  }, [v]);
}

/** Header picker: show every amount in another currency, for this browser only. */
export function CurrencyPicker() {
  const router = useRouter();
  const v = useCurrencyView();
  if (!v.ready) return null;
  const title = v.view === v.book ? `Amounts are kept in ${v.book}.` : `Converted from ${v.book} at your Settings rate: 1 ${v.view} = ${v.rates[v.view]} ${v.book}. Stored amounts don't change.`;
  return (
    <label className="flex items-center gap-2 text-xs text-muted" title={title}>
      <span className="hidden sm:inline">Show in</span>
      <Select
        aria-label="Show amounts in"
        value={v.view}
        onChange={(e) => (e.target.value === "__add" ? router.push("/settings?tab=economics") : v.setView(e.target.value))}
        className={v.view !== v.report ? "h-8 w-24 border-info/50 text-info" : "h-8 w-24"}
      >
        {v.available.map((c) => <option key={c} value={c}>{c}</option>)}
        <option value="__add">Add a rate…</option>
      </Select>
    </label>
  );
}
