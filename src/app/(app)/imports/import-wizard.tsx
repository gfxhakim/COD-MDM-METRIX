"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, CheckCircle2, Download, FileUp, Upload } from "lucide-react";
import * as React from "react";
import { Money } from "@/components/app/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import type { RowIssue } from "@/domain/imports/common";
import { CsvError, MAX_IMPORT_BYTES, parseCsv, type ParsedCsv } from "@/domain/imports/csv";
import { IMPORT_FIELDS, missingRequired, suggestMapping } from "@/domain/imports/fields";
import { useT } from "@/i18n/client";
import { msg, type TFunction } from "@/i18n/core";
import { categoryLabel } from "@/lib/labels";
import { errorMessage, useTRPC } from "@/lib/trpc/client";
import { humanize } from "@/lib/utils";
import { downloadText, KIND_META, type Kind } from "./download";

type Step = "upload" | "map" | "preview" | "done";
type DateFormat = "AUTO" | "ISO" | "DMY" | "MDY";
type FileState = { name: string; size: number; text: string; csv: ParsedCsv };

const STEPS: [Step, string][] = [["upload", msg("Upload")], ["map", msg("Map columns")], ["preview", msg("Preview & validate")], ["done", msg("Summary")]];
const DATES_READ: Record<string, string> = { DMY: msg("Dates read as day/month/year."), MDY: msg("Dates read as month/day/year."), ISO: msg("Dates read as year-month-day.") };
const ORDER_STATUS: Record<string, string> = { CONFIRMED: msg("Confirmed"), PENDING: msg("Pending"), CANCELED: msg("Canceled") };
const COST_TYPE: Record<string, string> = { FIXED: msg("Fixed"), VARIABLE: msg("Variable") };

/** A field's name for the person: the column key in English as before, its label in another language. */
function fieldName(kind: Kind, key: string, t: TFunction, english: boolean) {
  const label = IMPORT_FIELDS[kind].find((f) => f.key === key)?.label;
  return english || !label ? key : t(label);
}

/** A row issue in the picked language. Issues stored before `text` existed show their English. */
export function issueMessage(i: Pick<RowIssue, "message" | "text" | "vars">, kind: Kind, t: TFunction, english: boolean) {
  if (!i.text) return t(i.message);
  const vars = i.vars?.field ? { ...i.vars, field: fieldName(kind, String(i.vars.field), t, english) } : i.vars;
  return t(i.text, vars);
}

function Stepper({ step }: { step: Step }) {
  const { t } = useT();
  const idx = STEPS.findIndex(([s]) => s === step);
  return (
    <ol className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label={t("Import steps")}>
      {STEPS.map(([s, label], i) => (
        <li key={s} className={i === idx ? "font-medium text-fg" : i < idx ? "text-positive" : "text-subtle"} aria-current={i === idx ? "step" : undefined}>
          {i + 1}. {t(label)}
        </li>
      ))}
    </ol>
  );
}

export function ImportWizard({ kind, currency }: { kind: Kind; currency: string }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const { t, tx, locale } = useT();
  const meta = KIND_META[kind];
  const fields = IMPORT_FIELDS[kind];
  const last = useQuery(trpc.imports.lastMapping.queryOptions({ kind }));
  const products = useQuery({ ...trpc.products.list.queryOptions({ includeInactive: false }), enabled: kind === "AD_SPEND" });
  const ws = useQuery(trpc.workspace.getCurrent.queryOptions());

  const [step, setStep] = React.useState<Step>("upload");
  const [file, setFile] = React.useState<FileState | null>(null);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const [mapping, setMapping] = React.useState<Record<string, string | null>>({});
  const [dateFormat, setDateFormat] = React.useState<DateFormat>("AUTO");
  const [source, setSource] = React.useState<"SHOPIFY" | "EASYSELL" | "OTHER">("SHOPIFY");
  const [fxRate, setFxRate] = React.useState("");
  const [createCreatives, setCreateCreatives] = React.useState(true);
  const [productId, setProductId] = React.useState("");
  const [dragging, setDragging] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const request = () => ({
    kind,
    fileName: file!.name,
    csvText: file!.text,
    mapping,
    options: {
      dateFormat,
      ...(kind === "ORDERS" ? { source } : {}),
      ...(kind === "AD_SPEND" ? { fxRate: fxRate ? Number(fxRate) : settingsRate ?? null, createCreatives, productId: productId || null } : {}),
    },
  });

  const preview = useMutation(trpc.imports.preview.mutationOptions({ onSuccess: () => setStep("preview"), onError: (e) => toast("error", errorMessage(e)) }));
  const commit = useMutation(
    trpc.imports.commit.mutationOptions({
      onSuccess: () => {
        setStep("done");
        qc.invalidateQueries({ queryKey: trpc.imports.pathKey() });
        qc.invalidateQueries({ queryKey: trpc.bank.pathKey() });
        qc.invalidateQueries({ queryKey: trpc.spendReview.pathKey() });
        qc.invalidateQueries({ queryKey: trpc.orders.pathKey() });
        qc.invalidateQueries({ queryKey: trpc.expenses.pathKey() });
        qc.invalidateQueries({ queryKey: trpc.reports.pathKey() });
        qc.invalidateQueries({ queryKey: trpc.creatives.pathKey() });
      },
      onError: (e) => toast("error", errorMessage(e)),
    }),
  );
  const errorCsv = useMutation(trpc.imports.errorCsv.mutationOptions({ onSuccess: ({ filename, content }) => downloadText(filename, content), onError: (e) => toast("error", errorMessage(e)) }));

  async function accept(f: File | undefined) {
    setFileError(null);
    if (!f) return;
    if (!/\.(csv|txt|tsv)$/i.test(f.name)) return setFileError(t("Upload a .csv file. Excel users: File → Save As → CSV UTF-8."));
    if (f.size > MAX_IMPORT_BYTES) return setFileError(t("This file is larger than 5 MB. Split it by date range and import each part."));
    if (f.size === 0) return setFileError(t("This file is empty."));
    try {
      const text = await f.text();
      const csv = parseCsv(text);
      if (!csv.rows.length) return setFileError(t("The file has a header row but no data rows."));
      const saved = last.data?.mapping;
      const reuse = saved && Object.values(saved).every((c) => !c || csv.headers.includes(c)) && missingRequired(kind, saved).length === 0;
      setMapping(reuse ? saved : suggestMapping(kind, csv.headers));
      const opts = last.data?.options;
      if (reuse && opts) {
        if (typeof opts.source === "string") setSource(opts.source as typeof source);
        if (typeof opts.fxRate === "number") setFxRate(String(opts.fxRate));
      }
      setFile({ name: f.name, size: f.size, text, csv });
      setStep("map");
    } catch (e) {
      setFileError(e instanceof CsvError ? t(e.message) : t("Could not read this file."));
    }
  }

  function reset() {
    setFile(null);
    setStep("upload");
    preview.reset();
    commit.reset();
    if (inputRef.current) inputRef.current.value = "";
  }

  const missing = missingRequired(kind, mapping);
  const headerCurrency = kind === "AD_SPEND" && mapping.spend ? /\(([A-Z]{3})\)/.exec(mapping.spend)?.[1] : undefined;
  const needsFx = !!headerCurrency && headerCurrency !== currency;
  // An empty rate field falls back to the rate saved in Settings.
  const settingsRate = needsFx ? (ws.data?.exchangeRates as Partial<Record<string, number>> | undefined)?.[headerCurrency!] : undefined;
  const p = preview.data;
  const done = commit.data;
  const english = locale === "en";

  return (
    <Card>
      <CardHeader
        title={t(meta.title)}
        description={t(meta.blurb)}
        actions={<Button size="sm" variant="ghost" onClick={() => downloadText(`${kind.toLowerCase()}-template.csv`, meta.template)}><Download /> {t("Template")}</Button>}
      />
      <CardBody className="flex flex-col gap-5">
        <Stepper step={step} />

        {step === "upload" ? (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); void accept(e.dataTransfer.files[0]); }}
            className={`flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center ${dragging ? "border-positive bg-positive-soft" : "border-border-strong bg-surface-2"}`}
          >
            <FileUp className="size-6 text-muted" />
            <div>
              <p className="text-sm font-medium">{t("Drop a CSV file here")}</p>
              <p className="mt-1 text-xs text-muted">{t("Comma, semicolon or tab separated, UTF-8, up to 5 MB and 50,000 rows.")}</p>
            </div>
            <input ref={inputRef} id={`file-${kind}`} type="file" accept=".csv,.tsv,.txt,text/csv" className="sr-only" onChange={(e) => void accept(e.target.files?.[0])} />
            <Button variant="outline" onClick={() => inputRef.current?.click()}><Upload /> {t("Choose file")}</Button>
            {fileError ? <p className="text-sm text-negative" role="alert">{fileError}</p> : null}
          </div>
        ) : null}

        {step === "map" && file ? (
          <div className="flex flex-col gap-5">
            <p className="text-sm text-muted">
              {tx("{file} · {rows} rows · {columns} columns detected", { file: <span className="text-fg">{file.name}</span>, rows: file.csv.rows.length.toLocaleString(), columns: file.csv.headers.length })}
              {file.csv.truncated ? <span className="text-warning"> · {t("only the first 50,000 rows will be read")}</span> : null}
            </p>
            <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
              {fields.map((fd) => (
                <Field key={fd.key} label={`${t(fd.label)}${fd.required ? " *" : ""}`} htmlFor={`m-${kind}-${fd.key}`} hint={fd.hint ? t(fd.hint) : undefined}>
                  <Select id={`m-${kind}-${fd.key}`} value={mapping[fd.key] ?? ""} onChange={(e) => setMapping({ ...mapping, [fd.key]: e.target.value || null })}>
                    <option value="">{t("— Not in file —")}</option>
                    {file.csv.headers.map((h) => <option key={h} value={h}>{h}{file.csv.rows[0]?.values[h] ? ` ${t("(e.g. {value})", { value: file.csv.rows[0].values[h].slice(0, 24) })}` : ""}</option>)}
                  </Select>
                </Field>
              ))}
            </div>
            <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2 xl:grid-cols-3">
              <Field label={t("Date format")} htmlFor={`df-${kind}`} hint={t("Auto detects day-first vs month-first from the file.")}>
                <Select id={`df-${kind}`} value={dateFormat} onChange={(e) => setDateFormat(e.target.value as DateFormat)}>
                  <option value="AUTO">{t("Auto-detect")}</option><option value="DMY">{t("Day/Month/Year")}</option><option value="MDY">{t("Month/Day/Year")}</option><option value="ISO">{t("Year-Month-Day")}</option>
                </Select>
              </Field>
              {kind === "ORDERS" ? (
                <Field label={t("Source")} htmlFor="src" hint={t("Duplicates are detected per source and order ID.")}>
                  <Select id="src" value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
                    <option value="SHOPIFY">Shopify</option><option value="EASYSELL">EasySell</option><option value="OTHER">{t("Other")}</option>
                  </Select>
                </Field>
              ) : null}
              {kind === "AD_SPEND" ? (
                <>
                  <Field
                    label={t("Exchange rate to {currency}", { currency })}
                    htmlFor="fx"
                    hint={needsFx
                      ? settingsRate
                        ? t("This export is in {from}. Enter how many {to} one {from} cost you, or leave it empty to use {rate} from Settings.", { from: headerCurrency!, to: currency, rate: settingsRate })
                        : t("This export is in {from}. Enter how many {to} one {from} cost you.", { from: headerCurrency!, to: currency })
                      : t("Only needed when the export is in another currency.")}
                  >
                    <Input id="fx" inputMode="decimal" value={fxRate} onChange={(e) => setFxRate(e.target.value.replace(/[^\d.]/g, ""))} placeholder={needsFx ? (settingsRate ? String(settingsRate) : t("e.g. 250")) : t("Not needed")} required={needsFx && !settingsRate} />
                  </Field>
                  <Field label={t("New creative IDs")} htmlFor="cc" hint={t("Off: spend for unknown IDs is kept as unmatched spend for review.")}>
                    <Select id="cc" value={createCreatives ? "1" : "0"} onChange={(e) => setCreateCreatives(e.target.value === "1")}>
                      <option value="1">{t("Create creatives automatically")}</option><option value="0">{t("Keep as unmatched spend")}</option>
                    </Select>
                  </Field>
                  {createCreatives ? (
                    <Field label={t("Product for new creatives")} htmlFor="cp">
                      <Select id="cp" value={productId} onChange={(e) => setProductId(e.target.value)}>
                        <option value="">{t("Assign later")}</option>
                        {products.data?.map((pr) => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
                      </Select>
                    </Field>
                  ) : null}
                </>
              ) : null}
            </div>
            {missing.length ? <p className="text-sm text-warning" role="status">{t("Map the required fields: {fields}", { fields: missing.map((m) => t(m)).join(", ") })}</p> : null}
            <div className="flex flex-wrap justify-between gap-2">
              <Button variant="ghost" onClick={reset}><ArrowLeft /> {t("Choose another file")}</Button>
              <Button variant="primary" disabled={missing.length > 0 || (needsFx && !fxRate && !settingsRate) || preview.isPending} onClick={() => preview.mutate(request())}>
                {preview.isPending ? t("Validating…") : t("Validate & preview")}
              </Button>
            </div>
          </div>
        ) : null}

        {step === "preview" && p && file ? (
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {[
                [t("Rows in file"), p.totalRows, ""],
                [t("Ready to import"), p.counts.new, "text-positive"],
                ...(kind === "AD_SPEND" ? [[t("Amounts to update"), p.counts.update, "text-info"] as const] : []),
                [t("Already imported"), p.counts.duplicate, "text-muted"],
                [t("Rows with errors"), p.counts.errorRows, p.counts.errorRows ? "text-negative" : "text-muted"],
                [t("Warnings"), p.counts.warnings, p.counts.warnings ? "text-warning" : "text-muted"],
              ].map(([label, v, tone]) => (
                <div key={label as string} className="rounded-lg border border-border bg-surface-2 p-3">
                  <p className="text-xs text-muted">{label}</p>
                  <p className={`num mt-1 text-xl font-semibold ${tone}`}>{(v as number).toLocaleString()}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted">
              {t(DATES_READ[p.dateFormat] ?? DATES_READ.ISO)}
              {p.counts.skipped ? ` ${t("{n} rows with no spend and no impressions will be skipped.", { n: p.counts.skipped })}` : ""}
              {kind === "ORDERS" ? ` ${t("Orders are counted, not CSV lines: multi-line orders become one order.")}` : ""}
            </p>

            {p.unmatchedCreativeCount ? (
              <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <p>
                  {p.unmatchedCreativeCount > 1
                    ? t("{n} creative IDs are new to this workspace ({ids}).", { n: p.unmatchedCreativeCount, ids: `${p.unmatchedCreatives.slice(0, 5).join(", ")}${p.unmatchedCreativeCount > 5 ? "…" : ""}` })
                    : t("1 creative ID is new to this workspace ({ids}).", { ids: p.unmatchedCreatives.slice(0, 5).join(", ") })}{" "}
                  {createCreatives ? t("They will be created as creatives.") : t("Their spend will be kept as unmatched spend for review.")}
                </p>
              </div>
            ) : null}

            <div>
              <h3 className="mb-2 text-sm font-medium">{t(meta.previewOf, { n: p.preview.length })}</h3>
              {p.preview.length ? <PreviewTable kind={kind} rows={p.preview} currency={currency} /> : <p className="text-sm text-muted">{t("No valid rows.")}</p>}
            </div>

            {p.issues.length ? (
              <div>
                <h3 className="mb-2 text-sm font-medium text-negative">{t("Row errors")} {p.issues.length < p.counts.errorRows ? t("(first {n})", { n: p.issues.length }) : ""}</h3>
                <IssueTable kind={kind} issues={p.issues} />
                <p className="mt-2 text-xs text-muted">{t("Rows with errors are skipped. After importing, download the error CSV, fix those rows in your file and import it again; rows already imported are skipped as duplicates.")}</p>
              </div>
            ) : null}
            {p.warnings.length ? (
              <details className="rounded-lg border border-border p-3 text-sm">
                <summary className="cursor-pointer text-warning">{p.counts.warnings > 1 ? t("{n} warnings (rows will still import)", { n: p.counts.warnings }) : t("1 warning (rows will still import)")}</summary>
                <ul className="mt-2 max-h-48 space-y-1 overflow-auto text-xs text-muted">
                  {p.warnings.map((w, i) => <li key={i}>{t("Line {line}: {message}", { line: w.line, message: issueMessage(w, kind, t, english) })}</li>)}
                </ul>
              </details>
            ) : null}

            <div className="flex flex-wrap justify-between gap-2">
              <Button variant="ghost" onClick={() => setStep("map")}><ArrowLeft /> {t("Back to mapping")}</Button>
              <Button variant="primary" disabled={commit.isPending || p.counts.new + p.counts.update === 0} onClick={() => commit.mutate({ ...request(), fileSize: file.size })}>
                {commit.isPending ? t("Importing…") : p.counts.new + p.counts.update === 0 ? t("Nothing new to import") : t(meta.importN, { n: (p.counts.new + p.counts.update).toLocaleString() })}
              </Button>
            </div>
          </div>
        ) : null}

        {step === "done" && done ? (
          <div className="flex flex-col items-start gap-4">
            <div className="flex items-center gap-2 text-sm">
              {done.errorRows ? <AlertTriangle className="size-5 text-warning" /> : <CheckCircle2 className="size-5 text-positive" />}
              <p>
                {tx(done.updatedRows ? msg("{imported}, {updated} updated, {duplicates} already imported, {errors} rows with errors.") : msg("{imported}, {duplicates} already imported, {errors} rows with errors."), {
                  imported: <span className="font-medium">{t("{n} imported", { n: done.importedRows.toLocaleString() })}</span>,
                  updated: done.updatedRows.toLocaleString(),
                  duplicates: done.duplicateRows.toLocaleString(),
                  errors: done.errorRows.toLocaleString(),
                })}
              </p>
            </div>
            {kind === "BANK" && done.importedRows ? <p className="text-sm text-muted">{t("New bank rows are waiting in the review queue below. They do not affect profit until reviewed.")}</p> : null}
            <div className="flex flex-wrap gap-2">
              {done.errorRows ? <Button variant="outline" onClick={() => errorCsv.mutate({ id: done.id })}><Download /> {t("Download error CSV")}</Button> : null}
              <Button variant="primary" onClick={reset}>{t("Import another file")}</Button>
            </div>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

type PreviewRow = { line: number; state: string } & Record<string, unknown>;

function PreviewTable({ kind, rows, currency }: { kind: Kind; rows: PreviewRow[]; currency: string }) {
  const { t, date, dateTime } = useT();
  const state = (s: string) => (s === "NEW" ? <Badge tone="positive">{t("New")}</Badge> : s === "UPDATE" ? <Badge tone="info">{t("Update")}</Badge> : <Badge>{t("Duplicate")}</Badge>);
  const str = (v: unknown) => (v == null || v === "" ? "—" : String(v));
  const word = (table: Record<string, string>, v: unknown) => (table[String(v)] ? t(table[String(v)]) : humanize(String(v)));
  const cols: [string, (r: PreviewRow) => React.ReactNode, string?][] =
    kind === "ORDERS"
      ? [[t("Order"), (r) => str(r.orderNumber)], [t("date::Placed"), (r) => dateTime(r.placedAt as Date)], [t("Status"), (r) => word(ORDER_STATUS, r.status)], [t("Items"), (r) => <span className={r.unknownProduct ? "text-warning" : ""}>{str(r.items)}</span>], ["COD", (r) => <Money value={r.codAmount as number} currency={currency} />, "text-end"], ["utm_content", (r) => str(r.utmContent)], [t("Wilaya"), (r) => str(r.wilaya)], [t("Phone"), (r) => str(r.phone)]]
      : kind === "AD_SPEND"
        ? [[t("Date"), (r) => date(r.date as Date)], [t("Campaign"), (r) => str(r.campaignName)], [t("Ad"), (r) => str(r.adName)], [t("Creative ID"), (r) => str(r.creativeId)], [t("Spend"), (r) => <><Money value={r.spend as number} currency={currency} />{r.originalCurrency ? <span className="block text-[11px] text-muted"><Money value={r.originalSpend as number} currency={String(r.originalCurrency)} asIs /></span> : null}</>, "text-end"], [t("Impr."), (r) => str(r.impressions), "text-end"]]
        : kind === "EXPENSES"
          ? [[t("Date"), (r) => date(r.date as Date)], [t("Category"), (r) => t(categoryLabel(String(r.category)))], [t("Description"), (r) => str(r.description)], [t("Scope"), (r) => (r.productId ? t("Product") : t("Global"))], [t("Type"), (r) => word(COST_TYPE, r.costType)], [t("Amount"), (r) => <><Money value={r.amount as number} currency={currency} />{r.originalCurrency ? <span className="block text-[11px] text-muted"><Money value={r.originalAmount as number} currency={String(r.originalCurrency)} asIs /></span> : null}</>, "text-end"]]
          : [[t("Date"), (r) => date(r.date as Date)], [t("Description"), (r) => str(r.description)], [t("Reference"), (r) => str(r.reference)], [t("Amount"), (r) => <Money value={r.amount as number} currency={currency} signed />, "text-end"]];
  return (
    <div className="max-h-96 overflow-auto rounded-lg border border-border">
      <Table>
        <THead><tr><Th>{t("Line")}</Th><Th>{t("State")}</Th>{cols.map(([h, , c]) => <Th key={h} className={c}>{h}</Th>)}</tr></THead>
        <tbody>
          {rows.map((r) => (
            <Tr key={r.line}>
              <Td className="num text-xs text-muted">{r.line}</Td>
              <Td>{state(r.state)}</Td>
              {cols.map(([h, fn, c]) => <Td key={h} className={`max-w-56 truncate ${c ?? ""}`}>{fn(r)}</Td>)}
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

export function IssueTable({ kind, issues }: { kind: Kind; issues: (Pick<RowIssue, "line" | "message" | "text" | "vars"> & { field?: string | null; raw?: unknown })[] }) {
  const { t, locale } = useT();
  const english = locale === "en";
  return (
    <div className="max-h-80 overflow-auto rounded-lg border border-negative/30">
      <Table>
        <THead><tr><Th>{t("Line")}</Th><Th>{t("Field")}</Th><Th>{t("Problem")}</Th><Th>{t("Row values")}</Th></tr></THead>
        <tbody>
          {issues.map((i, n) => (
            <Tr key={n}>
              <Td className="num text-xs text-muted">{i.line}</Td>
              <Td className="text-xs">{i.field != null ? fieldName(kind, i.field, t, english) : "—"}</Td>
              <Td className="text-negative">{issueMessage(i, kind, t, english)}</Td>
              <Td className="max-w-96 truncate text-xs text-muted" title={i.raw ? JSON.stringify(i.raw) : undefined}>
                {i.raw ? Object.entries(i.raw as Record<string, string>).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(" · ") : "—"}
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
