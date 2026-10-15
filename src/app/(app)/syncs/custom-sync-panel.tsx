"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, Play, X } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Check3, Chip, Section } from "@/components/ui/choice";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Select, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { HelpTip } from "@/components/ui/tooltip";
import { CUSTOM_SYNC_MAX_ORDERS, describeCustomSync, parseOrderIds, type CustomSyncChoices } from "@/domain/customSync";
import { STATUS_GROUPS, type StatusGroupKey } from "@/domain/orderExport";
import { wilayaLabel } from "@/domain/wilayas";
import { useT } from "@/i18n/client";
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

function Row({ label, help, children }: { label: string; help?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[5rem_minmax(0,1fr)] sm:items-start sm:gap-2">
      <span className="text-xs text-muted sm:leading-8">{label}{help ? <HelpTip label={label} className="ms-1 align-middle">{help}</HelpTip> : null}</span>
      <div className="flex min-w-0 flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

/** Pick several names from a list: a native select to add one, removable pills for those picked. */
function MultiPick({ label, help, addLabel, all, picked, onChange, placeholder, show = (v) => v }: { label: string; help?: React.ReactNode; addLabel: string; all: string[]; picked: string[]; onChange: (v: string[]) => void; placeholder: string; show?: (v: string) => string }) {
  const { t } = useT();
  const left = all.filter((v) => !picked.includes(v));
  return (
    <Row label={label} help={help}>
      <div className="flex w-full min-w-0 flex-col gap-1.5">
        <Select aria-label={addLabel} value="" disabled={!left.length} onChange={(e) => e.target.value && onChange([...picked, e.target.value])} className="h-8 text-[13px]">
          <option value="">{picked.length ? t("Add another ({n} picked)", { n: picked.length }) : placeholder}</option>
          {left.map((v) => <option key={v} value={v}>{show(v)}</option>)}
        </Select>
        {picked.length ? (
          <div className="flex flex-wrap gap-1.5">
            {picked.map((v) => (
              <span key={v} className="inline-flex max-w-full items-center gap-1 rounded-full bg-brand-soft py-1 ps-3 pe-1 text-xs font-medium text-brand-strong animate-rise">
                <span className="truncate">{v}</span>
                <button type="button" aria-label={t("Remove {name}", { name: v })} className="rounded-full p-0.5 hover:bg-brand/15" onClick={() => onChange(picked.filter((p) => p !== v))}><X className="size-3.5" /></button>
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </Row>
  );
}

export function CustomSyncPanel({ workspaceId, timezone, demo, onClose, onStarted }: { workspaceId: string; timezone: string; demo: boolean; onClose: () => void; onStarted: () => void }) {
  const { t, tx } = useT();
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
  const summary = describeCustomSync(choices, t);
  const everything = !days.from && !days.to && allOn && summary.length === 1;

  const start = useMutation(
    trpc.sync.startCustom.mutationOptions({
      onSuccess: (r) => {
        if (r.alreadyRunning) {
          toast("error", t("A sync is already running. Start this one when it finishes."));
          return;
        }
        save(workspaceId, s);
        toast("success", t("Custom sync started"));
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
      <DialogContent title={t("Custom sync")} description={t("Bring in only the MDM orders you pick, and their parcels. Matching orders are added or updated; nothing is deleted, and the regular sync carries on as usual.")} className="max-w-2xl">
        <div className="flex flex-col gap-6">
          {demo ? <p className="rounded-xl bg-info-soft px-3 py-2 text-xs text-info">{t("The demo workspace's simulated MDM has parcels but no orders, so there is nothing to pick here. Custom sync works with a real MDM account.")}</p> : null}
          <Section title={t("Dates")} help={t("The days to sync, counted in the workspace's time zone, first and last day included. Pick Custom to type your own first and last day.")}>
            <div className="flex flex-wrap gap-1.5">
              {RANGES.map((r) => (
                <Chip key={r.key} active={s.range === r.key} onClick={() => setS((p) => ({ ...p, range: r.key, from: p.from || days.from || addDays(today, -29), to: p.to || days.to || today }))}>{t(r.label)}</Chip>
              ))}
            </div>
            {s.range === "custom" ? (
              <div className="grid grid-cols-2 gap-2 sm:max-w-sm">
                <label className="flex flex-col gap-1 text-xs text-muted">{t("From")}<Input type="date" value={s.from} max={s.to || today} onChange={(e) => set("from", e.target.value)} aria-invalid={badRange} /></label>
                <label className="flex flex-col gap-1 text-xs text-muted">{t("To")}<Input type="date" value={s.to} min={s.from || undefined} onChange={(e) => set("to", e.target.value)} aria-invalid={badRange} /></label>
              </div>
            ) : null}
            <p className="num text-xs text-muted">
              {badRange ? <span className="text-negative">{t("The start date is after the end date.")}</span> : days.from || days.to ? t("{from} to {to}", { from: days.from ? shortDay(days.from, t) : t("The start"), to: days.to ? shortDay(days.to, t) : t("today") }) : t("Every order, whatever its date")}
            </p>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <span>{t("Dates of")} <HelpTip label={t("Dates of")} className="align-middle">{t("Order date picks orders placed on those days. Latest status change picks orders whose MDM status last changed on those days, e.g. delivered last week.")}</HelpTip></span>
              <div className="flex gap-1.5">
                <Chip active={s.dateField === "placed"} onClick={() => set("dateField", "placed")}>{t("Order date")}</Chip>
                <Chip active={s.dateField === "status"} onClick={() => set("dateField", "status")}>{t("Latest status change")}</Chip>
              </div>
            </div>
          </Section>

          <Section
            title={t("Statuses")}
            help={t("Tick a group for all its MDM statuses, or open it to pick single ones. With every status ticked, statuses MDM adds later are synced too.")}
            aside={(
              <span className="flex gap-3 text-xs font-medium">
                <button type="button" className="text-brand-strong hover:underline" onClick={() => setS((p) => ({ ...p, offGroups: [], offStatuses: [] }))}>{t("All")}</button>
                <button type="button" className="text-muted hover:text-fg hover:underline" onClick={() => setS((p) => ({ ...p, offGroups: STATUS_GROUPS.map((g) => g.key), offStatuses: [] }))}>{t("None")}</button>
              </span>
            )}
          >
            <p className="-mt-1 text-xs text-muted">{t("An order is picked when MDM shows it in one of these statuses now, or the app still does, so orders stuck in a status get refreshed.")}</p>
            <ul className={cn("divide-y divide-border overflow-hidden rounded-2xl border border-border transition-opacity", options.isLoading && "opacity-60")}>
              {groups.map((g) => {
                const open = openGroups.includes(g.key);
                return (
                  <li key={g.key}>
                    <div className="flex items-center gap-3 px-3 py-2.5">
                      <Check3 state={groupState(g)} label={t(g.label)} onChange={toggleGroup.bind(null, g)} />
                      <button type="button" disabled={!g.statuses.length} aria-expanded={open} onClick={() => setOpenGroups((p) => (open ? p.filter((k) => k !== g.key) : [...p, g.key]))} className="flex min-w-0 flex-1 items-center gap-2 text-start disabled:cursor-default">
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">{t(g.label)}</span>
                          <span className="block truncate text-[11px] text-subtle">{t(g.hint)}</span>
                        </span>
                        {g.statuses.length ? <span className="num text-xs text-muted">{g.statuses.filter((st) => statusOn(g.key, st.key)).length}/{g.statuses.length}</span> : null}
                        <ChevronDown className={cn("size-4 text-subtle transition-transform", open && "rotate-180", !g.statuses.length && "invisible")} />
                      </button>
                    </div>
                    {open ? (
                      <ul className="animate-rise bg-surface-2 py-1">
                        {g.statuses.map((st) => (
                          <li key={st.key}>
                            <label className="flex cursor-pointer items-center gap-3 py-1.5 ps-10 pe-9 text-sm">
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

          <Section title={t("More filters")} help={t("Each filter is optional. An order is synced only when it matches every filter you set here.")}>
            <div className="flex flex-col gap-3 rounded-2xl border border-border p-3">
              <MultiPick label={t("Wilaya")} help={t("Only orders going to the wilayas you add. Leave it empty for every wilaya.")} addLabel={t("Add a wilaya")} all={options.data?.wilayas ?? []} picked={s.wilayas} onChange={(v) => set("wilayas", v)} placeholder={t("Every wilaya")} show={wilayaLabel} />
              <Row label={t("Delivery")} help={t("Home: delivered to the customer's address. Stop desk: the customer collects the parcel at the carrier's desk. Any: both.")}>
                <Chip active={!s.deliveryType} onClick={() => set("deliveryType", "")}>{t("Any")}</Chip>
                <Chip active={s.deliveryType === "HOME"} onClick={() => set("deliveryType", "HOME")}>{t("Home")}</Chip>
                <Chip active={s.deliveryType === "STOP_DESK"} onClick={() => set("deliveryType", "STOP_DESK")}>{t("Stop desk")}</Chip>
              </Row>
              <Row label={t("Ad ID")} help={t("With an ad ID: orders whose link carried a Meta ad ID (utm_content). Without: orders with none. Any: both.")}>
                <Chip active={s.ad === "any"} onClick={() => set("ad", "any")}>{t("Any")}</Chip>
                <Chip active={s.ad === "with"} onClick={() => set("ad", "with")}>{t("With an ad ID")}</Chip>
                <Chip active={s.ad === "without"} onClick={() => set("ad", "without")}>{t("Without")}</Chip>
              </Row>
              {options.data?.stores.length ? <MultiPick label={t("Store")} help={t("Only orders from the stores you add, as MDM names them. Leave it empty for every store.")} addLabel={t("Add a store")} all={options.data.stores} picked={s.stores} onChange={(v) => set("stores", v)} placeholder={t("Every store")} /> : null}
              {options.data?.products.length ? <MultiPick label={t("Product")} help={t("Only orders holding at least one of the products you add, by their MDM name. Leave it empty for every product.")} addLabel={t("Add a product")} all={options.data.products} picked={s.products} onChange={(v) => set("products", v)} placeholder={t("Every product")} /> : null}
            </div>
          </Section>

          <Section title={t("Specific orders")} help={t("Paste up to {max} MDM order IDs or store order numbers to sync just those. Capitals and a leading # don't matter, e.g. #1043 or 1043.", { max: CUSTOM_SYNC_MAX_ORDERS })} aside={orderIds.length ? <span className={cn("num text-xs", tooManyOrders ? "text-negative" : "text-muted")}>{t("{n} of {max} max", { n: orderIds.length, max: CUSTOM_SYNC_MAX_ORDERS })}</span> : null}>
            <Textarea value={orderText} onChange={(e) => setOrderText(e.target.value)} placeholder={t("Optional: MDM order IDs or store order numbers, separated by commas or one per line")} aria-invalid={tooManyOrders} className="min-h-16 font-mono text-[13px]" />
            {orderIds.length && s.range !== "all" ? (
              <p className="text-xs text-muted">{tx("The dates above still apply. {button} to sync these orders whatever their date.", { button: <button type="button" className="font-semibold text-brand-strong hover:underline" onClick={() => set("range", "all")}>{t("Use all dates")}</button> })}</p>
            ) : null}
          </Section>

          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-border p-3 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-[#e1182c]" checked={s.parcels} onChange={(e) => set("parcels", e.target.checked)} />
            <span>
              <span className="block font-medium">{t("Also update their parcels")} <HelpTip label={t("Also update their parcels")} className="align-middle">{t("On: after the orders, the sync re-reads their parcels too. Off: only the orders are updated, which is quicker when you only need order details.")}</HelpTip></span>
              <span className="block text-xs text-muted">{t("Delivery status, COD amount and fees of the picked orders' parcels.")}</span>
            </span>
          </label>

          <div className="sticky -bottom-5 -mx-5 -mb-5 flex flex-col gap-3 border-t border-border bg-surface/95 px-5 py-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 text-xs text-muted">
              <p className="font-semibold text-fg" aria-live="polite">{summary.join(" · ")}</p>
              <p className={cn(blocked && "text-negative")}>{demo ? t("Not available in the demo workspace.") : badRange ? t("The start date is after the end date.") : noneOn ? t("Pick at least one status.") : tooManyOrders ? t("Up to {n} orders at a time.", { n: CUSTOM_SYNC_MAX_ORDERS }) : everything ? t("Reads every MDM order, like a full resync.") : t("Only the orders matching all of these are synced.")}</p>
            </div>
            <Button variant="primary" onClick={() => start.mutate(choices)} disabled={blocked || start.isPending} className="shrink-0">
              {start.isPending ? <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <Play />}
              {start.isPending ? t("Starting…") : t("Start custom sync")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
