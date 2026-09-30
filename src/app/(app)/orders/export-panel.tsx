"use client";

import type { NormalizedStatus, OrderSource, OrderStatus } from "@prisma/client";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { ChevronDown, Download, FileSpreadsheet, FileText, Printer, X } from "lucide-react";
import { createPortal } from "react-dom";
import * as React from "react";
import { useCurrencyView } from "@/components/app/currency";
import { useCan } from "@/components/app/use-can";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import {
  COLUMN_PRESETS,
  EXPORT_COLUMNS,
  exportFileName,
  isCustomerColumn,
  STATUS_GROUPS,
  statusGroupOf,
  type ExportColumnKey,
  type ExportFormat,
  type StatusGroupKey,
} from "@/domain/orderExport";
import { errorMessage, useTRPC } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import type { AppRouter } from "@/server/trpc/root";

export type PrintData = Extract<inferRouterOutputs<AppRouter>["orders"]["export"], { kind: "print" }>;

/** The Orders page filters, carried into the export. */
export type PageFilters = {
  search?: string;
  status?: OrderStatus;
  parcelStatus?: NormalizedStatus;
  wilaya?: string;
  productId?: string;
  productName?: string;
  creativeId?: string;
  creativeName?: string;
  source?: OrderSource;
};

const RANGES = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "month", label: "This month" },
  { key: "lastMonth", label: "Last month" },
  { key: "all", label: "All dates" },
  { key: "custom", label: "Custom" },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

const FORMATS: { key: ExportFormat; label: string; hint: string; icon: React.ReactNode }[] = [
  { key: "xlsx", label: "Excel", hint: ".xlsx, ready to sort and filter", icon: <FileSpreadsheet /> },
  { key: "csv", label: "CSV", hint: "For Google Sheets or other tools", icon: <FileText /> },
  { key: "print", label: "Print or PDF", hint: "A printable page to save as PDF", icon: <Printer /> },
];

type Saved = {
  range: RangeKey;
  from: string;
  to: string;
  dateField: "placed" | "status";
  scope: "mdm" | "all";
  offGroups: StatusGroupKey[];
  offStatuses: string[];
  format: ExportFormat;
  csvDelimiter: "," | ";";
  preset: string;
  columns: ExportColumnKey[];
  layout: "orders" | "lines";
  currency: string | null;
  totals: boolean;
};

const DEFAULTS: Saved = {
  range: "30d",
  from: "",
  to: "",
  dateField: "placed",
  scope: "mdm",
  offGroups: [],
  offStatuses: [],
  format: "xlsx",
  csvDelimiter: ",",
  preset: "essentials",
  columns: COLUMN_PRESETS[0].columns,
  layout: "orders",
  currency: null,
  totals: true,
};

const storageKey = (workspaceId: string) => `cft.orderExport.v1.${workspaceId}`;

function load(workspaceId: string): Saved {
  try {
    const raw = localStorage.getItem(storageKey(workspaceId));
    if (!raw) return DEFAULTS;
    const v = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Saved>) };
    const known = new Set<string>(EXPORT_COLUMNS.map((c) => c.key));
    return { ...v, columns: v.columns.filter((c) => known.has(c)) };
  } catch {
    return DEFAULTS;
  }
}

function save(workspaceId: string, v: Saved) {
  try {
    localStorage.setItem(storageKey(workspaceId), JSON.stringify(v));
  } catch {
    // Blocked storage: the panel starts from the defaults next time.
  }
}

/** Today in the workspace's time zone, as YYYY-MM-DD. */
function todayIn(timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function rangeDays(key: RangeKey, today: string, custom: { from: string; to: string }): { from?: string; to?: string } {
  switch (key) {
    case "today": return { from: today, to: today };
    case "yesterday": return { from: addDays(today, -1), to: addDays(today, -1) };
    case "7d": return { from: addDays(today, -6), to: today };
    case "30d": return { from: addDays(today, -29), to: today };
    case "month": return { from: `${today.slice(0, 8)}01`, to: today };
    case "lastMonth": {
      const end = addDays(`${today.slice(0, 8)}01`, -1);
      return { from: `${end.slice(0, 8)}01`, to: end };
    }
    case "all": return {};
    case "custom": return { from: custom.from || undefined, to: custom.to || undefined };
  }
}

const shortDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Status groups the page's own status filters point at. */
function groupsFromPage(f: PageFilters): StatusGroupKey[] | null {
  if (f.parcelStatus) return [statusGroupOf(f.parcelStatus)];
  if (f.status === "PENDING") return ["not_confirmed"];
  if (f.status === "CANCELED") return ["cancelled"];
  if (f.status === "CONFIRMED") return ["confirmed", "carrier", "delivered", "returns", "other"];
  return null;
}

function download(filename: string, mime: string, base64: string) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Some browsers read the file after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function Chip({ active, children, className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "press h-8 whitespace-nowrap rounded-full border px-3.5 text-xs font-medium transition-colors",
        active ? "border-transparent bg-brand glow" : "border-border-strong bg-surface text-muted hover:bg-surface-2 hover:text-fg",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-bold tracking-tight">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Check3({ state, label, disabled, onChange }: { state: "on" | "off" | "some"; label: string; disabled?: boolean; onChange: () => void }) {
  const ref = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "some";
  }, [state]);
  return <input ref={ref} type="checkbox" aria-label={label} className="size-4 shrink-0 accent-[#e1182c] disabled:opacity-40" checked={state === "on"} disabled={disabled} onChange={onChange} />;
}

export function ExportPanel({ workspaceId, timezone, filters, onClose, onPrint }: { workspaceId: string; timezone: string; filters: PageFilters; onClose: () => void; onPrint: (data: PrintData, title: string) => void }) {
  const trpc = useTRPC();
  const toast = useToast();
  const money = useCurrencyView();
  const seeCustomers = useCan("customers.read");
  const [s, setS] = React.useState<Saved>(() => {
    const saved = load(workspaceId);
    const fromPage = groupsFromPage(filters);
    // The page's status filter wins over the last export's status picks.
    return fromPage ? { ...saved, offGroups: STATUS_GROUPS.map((g) => g.key).filter((k) => !fromPage.includes(k)), offStatuses: [] } : saved;
  });
  const set = <K extends keyof Saved>(k: K, v: Saved[K]) => setS((p) => ({ ...p, [k]: v }));
  const [carry, setCarry] = React.useState(filters);
  const [openGroups, setOpenGroups] = React.useState<StatusGroupKey[]>([]);

  const today = todayIn(timezone);
  const days = rangeDays(s.range, today, { from: s.from, to: s.to });
  const badRange = !!(days.from && days.to && days.from > days.to);
  const query = {
    ...days,
    dateField: s.dateField,
    scope: s.scope,
    search: carry.search || undefined,
    wilaya: carry.wilaya || undefined,
    productId: carry.productId || undefined,
    creativeId: carry.creativeId || undefined,
    source: carry.source || undefined,
  };
  const preview = useQuery({ ...trpc.orders.exportPreview.queryOptions(query), enabled: !badRange, placeholderData: keepPreviousData });

  const groups = preview.data?.groups ?? [];
  const groupOn = (g: StatusGroupKey) => !s.offGroups.includes(g);
  const statusOn = (g: StatusGroupKey, key: string) => groupOn(g) && !s.offStatuses.includes(key);
  const allOn = !s.offGroups.length && !s.offStatuses.length;
  const picked = groups.flatMap((g) => g.statuses.filter((st) => statusOn(g.key, st.key)));
  const pickedOrders = picked.reduce((a, st) => a + st.count, 0);
  const pickedRows = s.layout === "lines" ? picked.reduce((a, st) => a + st.lines, 0) : pickedOrders;

  const groupState = (g: (typeof groups)[number]): "on" | "off" | "some" =>
    !groupOn(g.key) ? "off" : g.statuses.some((st) => s.offStatuses.includes(st.key)) ? "some" : "on";
  const toggleGroup = (g: (typeof groups)[number]) => {
    const keys = g.statuses.map((st) => st.key);
    setS((p) => ({
      ...p,
      offGroups: groupState(g) === "off" ? p.offGroups.filter((k) => k !== g.key) : [...p.offGroups, g.key],
      offStatuses: p.offStatuses.filter((k) => !keys.includes(k)),
    }));
  };
  const toggleStatus = (g: (typeof groups)[number], key: string) => {
    setS((p) => {
      if (p.offGroups.includes(g.key)) {
        // Turning one status on in a group that is off: only that status.
        return { ...p, offGroups: p.offGroups.filter((k) => k !== g.key), offStatuses: [...p.offStatuses, ...g.statuses.map((st) => st.key).filter((k) => k !== key)] };
      }
      const off = p.offStatuses.includes(key) ? p.offStatuses.filter((k) => k !== key) : [...p.offStatuses, key];
      // Every status of the group off is the group off.
      return g.statuses.every((st) => off.includes(st.key))
        ? { ...p, offGroups: [...p.offGroups, g.key], offStatuses: off.filter((k) => !g.statuses.some((st) => st.key === k)) }
        : { ...p, offStatuses: off };
    });
  };

  const visibleColumns = EXPORT_COLUMNS.filter((c) => seeCustomers || !isCustomerColumn(c.key));
  const columns = visibleColumns.map((c) => c.key).filter((k) => s.columns.includes(k));
  const pickPreset = (key: string) => setS((p) => ({ ...p, preset: key, columns: COLUMN_PRESETS.find((x) => x.key === key)!.columns }));
  const toggleColumn = (key: ExportColumnKey) => setS((p) => ({ ...p, preset: "custom", columns: p.columns.includes(key) ? p.columns.filter((k) => k !== key) : [...p.columns, key] }));

  const currency = s.currency && money.available.includes(s.currency) ? s.currency : money.report;
  const filename = s.format === "print" ? null : exportFileName({ ...days, scope: s.scope, layout: s.layout, format: s.format }, today);

  const run = useMutation(
    trpc.orders.export.mutationOptions({
      onSuccess: (r) => {
        save(workspaceId, s);
        if (r.kind === "print") {
          onPrint(r, `Orders${days.from || days.to ? `, ${days.from ? shortDay(days.from) : "start"} to ${days.to ? shortDay(days.to) : "today"}` : ""}`);
          return;
        }
        download(r.filename, r.mime, r.base64);
        toast("success", `${r.orders.toLocaleString("en-US")} orders exported to ${r.filename}`);
        onClose();
      },
      onError: (e) => toast("error", errorMessage(e)),
    }),
  );
  const noStatus = !!preview.data && !preview.data.tooMany && preview.data.total > 0 && picked.length === 0;
  const blocked = badRange || !columns.length || noStatus || !!preview.data?.tooMany || preview.data?.total === 0;
  const submit = () =>
    run.mutate({
      ...query,
      // Every status on: send none, so statuses MDM adds later are exported too.
      statuses: allOn ? undefined : picked.map((st) => st.key),
      format: s.format,
      csvDelimiter: s.csvDelimiter,
      layout: s.layout,
      columns,
      currency,
      totals: s.totals,
    });

  const carried = [
    carry.search ? { key: "search" as const, label: `Search “${carry.search}”` } : null,
    carry.wilaya ? { key: "wilaya" as const, label: carry.wilaya } : null,
    carry.productId ? { key: "productId" as const, label: carry.productName ?? "One product" } : null,
    carry.creativeId ? { key: "creativeId" as const, label: `Ad ${carry.creativeName ?? ""}`.trim() } : null,
    carry.source ? { key: "source" as const, label: `Source: ${carry.source.toLowerCase()}` } : null,
  ].filter((c) => c !== null);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Export orders" description="Pick the orders, then how you want the file. Your choices are remembered on this device." className="max-w-2xl">
        <div className="flex flex-col gap-6">
          <Section title="Dates">
            <div className="flex flex-wrap gap-1.5">
              {RANGES.map((r) => (
                <Chip key={r.key} active={s.range === r.key} onClick={() => setS((p) => ({ ...p, range: r.key, from: p.from || days.from || addDays(today, -29), to: p.to || days.to || today }))}>{r.label}</Chip>
              ))}
            </div>
            {s.range === "custom" ? (
              <div className="grid grid-cols-2 gap-2 sm:max-w-sm">
                <label className="flex flex-col gap-1 text-xs text-muted">From<Input type="date" value={s.from} max={s.to || today} onChange={(e) => set("from", e.target.value)} aria-invalid={badRange} /></label>
                <label className="flex flex-col gap-1 text-xs text-muted">To<Input type="date" value={s.to} min={s.from || undefined} onChange={(e) => set("to", e.target.value)} aria-invalid={badRange} /></label>
              </div>
            ) : null}
            <p className="num text-xs text-muted">
              {badRange ? <span className="text-negative">The start date is after the end date.</span> : days.from || days.to ? `${days.from ? shortDay(days.from) : "The start"} to ${days.to ? shortDay(days.to) : "today"}` : "Every order, whatever its date"}
            </p>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <span>Dates of</span>
              <div className="flex gap-1.5">
                <Chip active={s.dateField === "placed"} onClick={() => set("dateField", "placed")}>Order date</Chip>
                <Chip active={s.dateField === "status"} onClick={() => set("dateField", "status")}>Latest status change</Chip>
              </div>
            </div>
          </Section>

          <Section title="Which orders">
            <div className="flex flex-wrap gap-1.5">
              <Chip active={s.scope === "mdm"} onClick={() => set("scope", "mdm")}>Synced from MDM</Chip>
              <Chip active={s.scope === "all"} onClick={() => set("scope", "all")}>All orders</Chip>
            </div>
            {carried.length ? (
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                <span>From the page filters:</span>
                {carried.map((c) => (
                  <span key={c.key} className="inline-flex max-w-full items-center gap-1 rounded-full bg-brand-soft py-1 pl-3 pr-1 font-medium text-brand-strong">
                    <span className="truncate">{c.label}</span>
                    <button type="button" aria-label={`Remove ${c.label}`} className="rounded-full p-0.5 hover:bg-brand/15" onClick={() => setCarry((p) => ({ ...p, [c.key]: undefined }))}><X className="size-3.5" /></button>
                  </span>
                ))}
              </div>
            ) : null}
          </Section>

          <Section
            title="Statuses"
            aside={groups.length ? (
              <span className="flex gap-3 text-xs font-medium">
                <button type="button" className="text-brand-strong hover:underline" onClick={() => setS((p) => ({ ...p, offGroups: [], offStatuses: [] }))}>All</button>
                <button type="button" className="text-muted hover:text-fg hover:underline" onClick={() => setS((p) => ({ ...p, offGroups: STATUS_GROUPS.map((g) => g.key), offStatuses: [] }))}>None</button>
              </span>
            ) : null}
          >
            {preview.data?.tooMany ? (
              <p className="rounded-xl bg-warning-soft px-3 py-2 text-xs text-warning">These dates hold more than 50,000 orders. Pick a shorter range to export.</p>
            ) : !preview.data ? (
              <div className="h-40 animate-pulse rounded-2xl bg-surface-2" aria-label="Counting orders" />
            ) : (
              <ul className={cn("divide-y divide-border overflow-hidden rounded-2xl border border-border transition-opacity", preview.isFetching && "opacity-60")}>
                {groups.map((g) => {
                  const open = openGroups.includes(g.key);
                  const state = groupState(g);
                  return (
                    <li key={g.key}>
                      <div className="flex items-center gap-3 px-3 py-2.5">
                        <Check3 state={state} label={g.label} disabled={!g.count} onChange={toggleGroup.bind(null, g)} />
                        <button type="button" disabled={!g.statuses.length} aria-expanded={open} onClick={() => setOpenGroups((p) => (open ? p.filter((k) => k !== g.key) : [...p, g.key]))} className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default">
                          <span className="min-w-0 flex-1">
                            <span className={cn("block text-sm font-medium", !g.count && "text-subtle")}>{g.label}</span>
                            <span className="block truncate text-[11px] text-subtle">{g.hint}</span>
                          </span>
                          <span className="num text-sm font-semibold">{g.count.toLocaleString("en-US")}</span>
                          <ChevronDown className={cn("size-4 text-subtle transition-transform", open && "rotate-180", !g.statuses.length && "invisible")} />
                        </button>
                      </div>
                      {open ? (
                        <ul className="animate-rise bg-surface-2 py-1">
                          {g.statuses.map((st) => (
                            <li key={st.key}>
                              <label className="flex cursor-pointer items-center gap-3 py-1.5 pl-10 pr-9 text-sm">
                                <input type="checkbox" className="size-4 accent-[#e1182c]" checked={statusOn(g.key, st.key)} onChange={() => toggleStatus(g, st.key)} />
                                <span className="flex-1">{st.label}</span>
                                <span className="num text-xs text-muted">{st.count.toLocaleString("en-US")}</span>
                              </label>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <Section title="Format">
            <div className="grid gap-2 sm:grid-cols-3">
              {FORMATS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={s.format === f.key}
                  onClick={() => set("format", f.key)}
                  className={cn(
                    "press flex items-center gap-3 rounded-2xl border p-3 text-left transition-colors sm:flex-col sm:items-start sm:gap-2",
                    s.format === f.key ? "border-brand bg-brand-soft/60 ring-2 ring-brand/15" : "border-border hover:bg-surface-2",
                  )}
                >
                  <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl [&_svg]:size-4", s.format === f.key ? "bg-brand glow" : "bg-surface-3 text-muted")}>{f.icon}</span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{f.label}</span>
                    <span className="block text-[11px] leading-snug text-muted">{f.hint}</span>
                  </span>
                </button>
              ))}
            </div>
            {s.format === "csv" ? (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <span>Separator</span>
                <Chip active={s.csvDelimiter === ","} onClick={() => set("csvDelimiter", ",")}>Comma</Chip>
                <Chip active={s.csvDelimiter === ";"} onClick={() => set("csvDelimiter", ";")}>Semicolon (French Excel)</Chip>
              </div>
            ) : null}
          </Section>

          <Section title="Columns" aside={<span className="num text-xs text-muted">{columns.length} of {visibleColumns.length}</span>}>
            <div className="flex flex-wrap gap-1.5">
              {COLUMN_PRESETS.map((p) => <Chip key={p.key} active={s.preset === p.key} onClick={() => pickPreset(p.key)}>{p.label}</Chip>)}
              {s.preset === "custom" ? <Chip active>Custom</Chip> : null}
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-2xl border border-border p-3 sm:grid-cols-3">
              {visibleColumns.map((c) => (
                <label key={c.key} className="flex min-w-0 cursor-pointer items-center gap-2 py-1 text-[13px]">
                  <input type="checkbox" className="size-4 shrink-0 accent-[#e1182c]" checked={s.columns.includes(c.key)} onChange={() => toggleColumn(c.key)} />
                  <span className="truncate">{c.label}</span>
                </label>
              ))}
            </div>
            {!seeCustomers ? <p className="text-xs text-subtle">Customer names, phones and addresses are left out of exports for view-only accounts.</p> : null}
          </Section>

          <Section title="Rows and amounts">
            <div className="flex flex-wrap gap-1.5">
              <Chip active={s.layout === "orders"} onClick={() => set("layout", "orders")}>One row per order</Chip>
              <Chip active={s.layout === "lines"} onClick={() => set("layout", "lines")}>One row per product</Chip>
            </div>
            <div className="grid grid-cols-2 items-center gap-3 sm:flex">
              <label className="flex items-center gap-2 text-xs text-muted">
                Amounts in
                <Select aria-label="Currency" value={currency} onChange={(e) => set("currency", e.target.value)} className="h-8 w-24">
                  {money.available.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-[13px]">
                <input type="checkbox" className="size-4 accent-[#e1182c]" checked={s.totals} onChange={(e) => set("totals", e.target.checked)} />
                Add totals by status
              </label>
            </div>
          </Section>

          <div className="sticky -bottom-5 -mx-5 -mb-5 flex flex-col gap-3 border-t border-border bg-surface/95 px-5 py-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 text-xs text-muted">
              <p className="num font-semibold text-fg" aria-live="polite">
                {preview.data && !preview.data.tooMany ? `${pickedOrders.toLocaleString("en-US")} orders${s.layout === "lines" ? ` · ${pickedRows.toLocaleString("en-US")} rows` : ""} · ${columns.length} columns` : " "}
              </p>
              <p className="truncate">{!columns.length ? "Pick at least one column." : noStatus ? "Pick at least one status." : filename ?? "Opens a printable page; choose Save as PDF there."}</p>
            </div>
            <Button variant="primary" onClick={submit} disabled={blocked || run.isPending} className="shrink-0">
              {run.isPending ? <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : s.format === "print" ? <Printer /> : <Download />}
              {run.isPending ? "Preparing…" : s.format === "print" ? "Open printable page" : `Download ${s.format === "xlsx" ? "Excel" : "CSV"}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The printable page: a full-screen sheet; the browser's print dialog saves it as PDF. */
export function PrintSheet({ data, title, onClose }: { data: PrintData; title: string; onClose: () => void }) {
  React.useEffect(() => {
    document.documentElement.classList.add("printing");
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => {
      document.documentElement.classList.remove("printing");
      window.removeEventListener("keydown", esc);
    };
  }, [onClose]);
  return createPortal(
    <div className="print-sheet fixed inset-0 z-[70] overflow-auto bg-surface-2 animate-fade" role="dialog" aria-modal="true" aria-label="Printable orders">
      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface/95 px-4 py-3 backdrop-blur">
        <p className="text-sm font-semibold">Printable page <span className="num font-normal text-muted">· {data.orders.toLocaleString("en-US")} orders</span></p>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}><X /> Close</Button>
          <Button variant="primary" size="sm" onClick={() => window.print()}><Printer /> Print or save as PDF</Button>
        </div>
      </div>
      <div className="mx-auto my-4 w-fit min-w-[min(100%,56rem)] rounded-2xl bg-surface p-6 shadow-card print:m-0 print:w-auto print:rounded-none print:p-0 print:shadow-none">
        <header className="mb-4 flex flex-wrap items-end justify-between gap-2 border-b-2 border-brand pb-3">
          <div>
            <h1 className="text-xl font-black tracking-tight">{title}</h1>
            <p className="text-xs text-muted">{data.workspace}</p>
          </div>
          <p className="num text-xs text-muted">Generated {new Date(data.generatedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</p>
        </header>
        <table className="print-table w-full border-collapse text-[11px]">
          <thead>
            <tr>{data.headers.map((h, i) => <th key={i} className={cn("border-b border-border-strong bg-surface-2 px-2 py-1.5 font-semibold", data.align[i] === "right" ? "text-right" : "text-left")}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={i} className="even:bg-surface-2/60">
                {r.map((v, j) => <td key={j} className={cn("border-b border-border px-2 py-1 align-top", data.align[j] === "right" && "num text-right whitespace-nowrap")}>{v}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {data.totals ? (
          <div className="mt-6 break-inside-avoid">
            <h2 className="mb-2 text-sm font-bold">Totals by status</h2>
            <table className="print-table border-collapse text-[11px]">
              <thead>
                <tr>{data.totals.headers.map((h, i) => <th key={i} className={cn("border-b border-border-strong bg-surface-2 px-2 py-1.5 font-semibold", i >= 2 ? "text-right" : "text-left")}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {data.totals.rows.map((r, i) => (
                  <tr key={i} className={cn(i === data.totals!.rows.length - 1 && "font-bold")}>
                    {r.map((v, j) => <td key={j} className={cn("border-b border-border px-2 py-1", j >= 2 && "num text-right")}>{v}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
      <p className="no-print px-4 pb-6 text-center text-xs text-muted">In the print window, pick “Save as PDF” as the printer to get a PDF file.</p>
    </div>,
    document.body,
  );
}
