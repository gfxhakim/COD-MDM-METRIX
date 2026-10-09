"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, Play, X } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Check3, Chip, Section } from "@/components/ui/choice";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Select, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { CUSTOM_SYNC_MAX_ORDERS, describeCustomSync, parseOrderIds, type CustomSyncChoices } from "@/domain/customSync";
import { STATUS_GROUPS, type StatusGroupKey } from "@/domain/orderExport";
import { wilayaLabel } from "@/domain/wilayas";
import { addDays, RANGES, rangeDays, shortDay, todayIn, type RangeKey } from "@/lib/dateRanges";
import { errorMessage, useTRPC } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

type Saved = {
  range: RangeKey;
  from: string;
  to: string;
  dateField: "placed" | "status";
  offGroups: StatusGroupKey[];
  offStatuses: string[];
  wilayas: string[];
  stores: string[];
  products: string[];
  deliveryType: "" | "HOME" | "STOP_DESK";
  ad: "any" | "with" | "without";
  parcels: boolean;
};

const DEFAULTS: Saved = { range: "7d", from: "", to: "", dateField: "placed", offGroups: [], offStatuses: [], wilayas: [], stores: [], products: [], deliveryType: "", ad: "any", parcels: true };

const storageKey = (workspaceId: string) => `cft.customSync.v1.${workspaceId}`;

function load(workspaceId: string): Saved {
  try {
    const raw = localStorage.getItem(storageKey(workspaceId));
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Saved>) } : DEFAULTS;
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[5rem_minmax(0,1fr)] sm:items-start sm:gap-2">
      <span className="text-xs text-muted sm:leading-8">{label}</span>
      <div className="flex min-w-0 flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

/** Pick several names from a list: a native select to add one, removable pills for those picked. */
function MultiPick({ label, all, picked, onChange, placeholder, show = (v) => v }: { label: string; all: string[]; picked: string[]; onChange: (v: string[]) => void; placeholder: string; show?: (v: string) => string }) {
  const left = all.filter((v) => !picked.includes(v));
  return (
    <Row label={label}>
      <div className="flex w-full min-w-0 flex-col gap-1.5">
        <Select aria-label={`Add a ${label.toLowerCase()}`} value="" disabled={!left.length} onChange={(e) => e.target.value && onChange([...picked, e.target.value])} className="h-8 text-[13px]">
          <option value="">{picked.length ? `Add another (${picked.length} picked)` : placeholder}</option>
          {left.map((v) => <option key={v} value={v}>{show(v)}</option>)}
        </Select>
        {picked.length ? (
          <div className="flex flex-wrap gap-1.5">
            {picked.map((v) => (
              <span key={v} className="inline-flex max-w-full items-center gap-1 rounded-full bg-brand-soft py-1 pl-3 pr-1 text-xs font-medium text-brand-strong animate-rise">
                <span className="truncate">{v}</span>
                <button type="button" aria-label={`Remove ${v}`} className="rounded-full p-0.5 hover:bg-brand/15" onClick={() => onChange(picked.filter((p) => p !== v))}><X className="size-3.5" /></button>
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </Row>
  );
}

export function CustomSyncPanel({ workspaceId, timezone, demo, onClose, onStarted }: { workspaceId: string; timezone: string; demo: boolean; onClose: () => void; onStarted: () => void }) {
  const trpc = useTRPC();
  const toast = useToast();
  const options = useQuery(trpc.sync.customOptions.queryOptions());
  const [s, setS] = React.useState<Saved>(() => load(workspaceId));
  const set = <K extends keyof Saved>(k: K, v: Saved[K]) => setS((p) => ({ ...p, [k]: v }));
  const [orderText, setOrderText] = React.useState("");
  const [openGroups, setOpenGroups] = React.useState<StatusGroupKey[]>([]);

  const today = todayIn(timezone);
  const days = rangeDays(s.range, today, { from: s.from, to: s.to });
  const badRange = !!(days.from && days.to && days.from > days.to);
  const orderIds = parseOrderIds(orderText);
  const tooManyOrders = orderIds.length > CUSTOM_SYNC_MAX_ORDERS;

  const groups = options.data?.groups ?? STATUS_GROUPS.map((g) => ({ key: g.key, label: g.label, hint: g.hint, statuses: [] as { key: string; label: string }[] }));
  const groupOn = (g: StatusGroupKey) => !s.offGroups.includes(g);
  const statusOn = (g: StatusGroupKey, key: string) => groupOn(g) && !s.offStatuses.includes(key);
  const groupState = (g: (typeof groups)[number]): "on" | "off" | "some" => (!groupOn(g.key) ? "off" : g.statuses.some((st) => s.offStatuses.includes(st.key)) ? "some" : "on");
  const allOn = !s.offGroups.length && !groups.some((g) => groupState(g) === "some");
  const noneOn = groups.every((g) => groupState(g) === "off");
  const toggleGroup = (g: (typeof groups)[number]) => {
    const keys = g.statuses.map((st) => st.key);
    setS((p) => ({ ...p, offGroups: groupState(g) === "off" ? p.offGroups.filter((k) => k !== g.key) : [...p.offGroups, g.key], offStatuses: p.offStatuses.filter((k) => !keys.includes(k)) }));
  };
  const toggleStatus = (g: (typeof groups)[number], key: string) => {
    setS((p) => {
      if (p.offGroups.includes(g.key)) return { ...p, offGroups: p.offGroups.filter((k) => k !== g.key), offStatuses: [...p.offStatuses, ...g.statuses.map((st) => st.key).filter((k) => k !== key)] };
      const off = p.offStatuses.includes(key) ? p.offStatuses.filter((k) => k !== key) : [...p.offStatuses, key];
      return g.statuses.every((st) => off.includes(st.key))
        ? { ...p, offGroups: [...p.offGroups, g.key], offStatuses: off.filter((k) => !g.statuses.some((st) => st.key === k)) }
        : { ...p, offStatuses: off };
    });
  };

  const choices: CustomSyncChoices = {
    ...days,
    dateField: s.dateField,
    // Every status on: send none, so statuses MDM adds later are synced too.
    groups: allOn ? undefined : groups.filter((g) => groupState(g) === "on").map((g) => g.key),
    statuses: allOn ? undefined : groups.filter((g) => groupState(g) === "some").flatMap((g) => g.statuses.filter((st) => statusOn(g.key, st.key)).map((st) => st.key)),
    wilayas: s.wilayas.length ? s.wilayas : undefined,
    stores: s.stores.length ? s.stores : undefined,
    products: s.products.length ? s.products : undefined,
    deliveryType: s.deliveryType || undefined,
    ad: s.ad,
    orderIds: orderIds.length ? orderIds : undefined,
    parcels: s.parcels,
  };
  const summary = describeCustomSync(choices);
  const everything = !days.from && !days.to && allOn && summary.length === 1;

  const start = useMutation(
    trpc.sync.startCustom.mutationOptions({
      onSuccess: (r) => {
        if (r.alreadyRunning) {
          toast("error", "A sync is already running. Start this one when it finishes.");
          return;
        }
        save(workspaceId, s);
        toast("success", "Custom sync started");
        onStarted();
        onClose();
      },
      onError: (e) => toast("error", errorMessage(e)),
    }),
  );
  // Wait for the status list, so a group picked partly is sent as the statuses it holds.
  const blocked = demo || !options.data || badRange || noneOn || tooManyOrders;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Custom sync" description="Bring in only the MDM orders you pick, and their parcels. Matching orders are added or updated; nothing is deleted, and the regular sync carries on as usual." className="max-w-2xl">
        <div className="flex flex-col gap-6">
          {demo ? <p className="rounded-xl bg-info-soft px-3 py-2 text-xs text-info">The demo workspace&apos;s simulated MDM has parcels but no orders, so there is nothing to pick here. Custom sync works with a real MDM account.</p> : null}
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

          <Section
            title="Statuses"
            aside={(
              <span className="flex gap-3 text-xs font-medium">
                <button type="button" className="text-brand-strong hover:underline" onClick={() => setS((p) => ({ ...p, offGroups: [], offStatuses: [] }))}>All</button>
                <button type="button" className="text-muted hover:text-fg hover:underline" onClick={() => setS((p) => ({ ...p, offGroups: STATUS_GROUPS.map((g) => g.key), offStatuses: [] }))}>None</button>
              </span>
            )}
          >
            <p className="-mt-1 text-xs text-muted">An order is picked when MDM shows it in one of these statuses now, or the app still does, so orders stuck in a status get refreshed.</p>
            <ul className={cn("divide-y divide-border overflow-hidden rounded-2xl border border-border transition-opacity", options.isLoading && "opacity-60")}>
              {groups.map((g) => {
                const open = openGroups.includes(g.key);
                return (
                  <li key={g.key}>
                    <div className="flex items-center gap-3 px-3 py-2.5">
                      <Check3 state={groupState(g)} label={g.label} onChange={toggleGroup.bind(null, g)} />
                      <button type="button" disabled={!g.statuses.length} aria-expanded={open} onClick={() => setOpenGroups((p) => (open ? p.filter((k) => k !== g.key) : [...p, g.key]))} className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default">
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">{g.label}</span>
                          <span className="block truncate text-[11px] text-subtle">{g.hint}</span>
                        </span>
                        {g.statuses.length ? <span className="num text-xs text-muted">{g.statuses.filter((st) => statusOn(g.key, st.key)).length}/{g.statuses.length}</span> : null}
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
                            </label>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Section>

          <Section title="More filters">
            <div className="flex flex-col gap-3 rounded-2xl border border-border p-3">
              <MultiPick label="Wilaya" all={options.data?.wilayas ?? []} picked={s.wilayas} onChange={(v) => set("wilayas", v)} placeholder="Every wilaya" show={wilayaLabel} />
              <Row label="Delivery">
                <Chip active={!s.deliveryType} onClick={() => set("deliveryType", "")}>Any</Chip>
                <Chip active={s.deliveryType === "HOME"} onClick={() => set("deliveryType", "HOME")}>Home</Chip>
                <Chip active={s.deliveryType === "STOP_DESK"} onClick={() => set("deliveryType", "STOP_DESK")}>Stop desk</Chip>
              </Row>
              <Row label="Ad ID">
                <Chip active={s.ad === "any"} onClick={() => set("ad", "any")}>Any</Chip>
                <Chip active={s.ad === "with"} onClick={() => set("ad", "with")}>With an ad ID</Chip>
                <Chip active={s.ad === "without"} onClick={() => set("ad", "without")}>Without</Chip>
              </Row>
              {options.data?.stores.length ? <MultiPick label="Store" all={options.data.stores} picked={s.stores} onChange={(v) => set("stores", v)} placeholder="Every store" /> : null}
              {options.data?.products.length ? <MultiPick label="Product" all={options.data.products} picked={s.products} onChange={(v) => set("products", v)} placeholder="Every product" /> : null}
            </div>
          </Section>

          <Section title="Specific orders" aside={orderIds.length ? <span className={cn("num text-xs", tooManyOrders ? "text-negative" : "text-muted")}>{orderIds.length} of {CUSTOM_SYNC_MAX_ORDERS} max</span> : null}>
            <Textarea value={orderText} onChange={(e) => setOrderText(e.target.value)} placeholder="Optional: MDM order IDs or store order numbers, separated by commas or one per line" aria-invalid={tooManyOrders} className="min-h-16 font-mono text-[13px]" />
            {orderIds.length && s.range !== "all" ? (
              <p className="text-xs text-muted">The dates above still apply. <button type="button" className="font-semibold text-brand-strong hover:underline" onClick={() => set("range", "all")}>Use all dates</button> to sync these orders whatever their date.</p>
            ) : null}
          </Section>

          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-border p-3 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-[#e1182c]" checked={s.parcels} onChange={(e) => set("parcels", e.target.checked)} />
            <span>
              <span className="block font-medium">Also update their parcels</span>
              <span className="block text-xs text-muted">Delivery status, COD amount and fees of the picked orders&apos; parcels.</span>
            </span>
          </label>

          <div className="sticky -bottom-5 -mx-5 -mb-5 flex flex-col gap-3 border-t border-border bg-surface/95 px-5 py-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 text-xs text-muted">
              <p className="font-semibold text-fg" aria-live="polite">{summary.join(" · ")}</p>
              <p className={cn(blocked && "text-negative")}>{demo ? "Not available in the demo workspace." : badRange ? "The start date is after the end date." : noneOn ? "Pick at least one status." : tooManyOrders ? `Up to ${CUSTOM_SYNC_MAX_ORDERS} orders at a time.` : everything ? "Reads every MDM order, like a full resync." : "Only the orders matching all of these are synced."}</p>
            </div>
            <Button variant="primary" onClick={() => start.mutate(choices)} disabled={blocked || start.isPending} className="shrink-0">
              {start.isPending ? <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <Play />}
              {start.isPending ? "Starting…" : "Start custom sync"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
