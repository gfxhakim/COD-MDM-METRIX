"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Eye, History, Trash2 } from "lucide-react";
import * as React from "react";
import { useCan } from "@/components/app/use-can";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyState, ErrorState, Loading } from "@/components/ui/states";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import type { RowIssue } from "@/domain/imports/common";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/core";
import { errorMessage, useTRPC } from "@/lib/trpc/client";
import { downloadText, KIND_META, type Kind } from "./download";
import { IssueTable, issueMessage } from "./import-wizard";

const STATUS: Record<string, { label: string; tone: "positive" | "warning" | "negative" | "neutral" }> = {
  COMMITTED: { label: msg("Imported"), tone: "positive" },
  PARTIAL: { label: msg("Partial"), tone: "warning" },
  FAILED: { label: msg("Failed"), tone: "negative" },
  PREVIEW: { label: msg("Preview"), tone: "neutral" },
};

/** What deleting an import removes, said in full for each kind. */
const DELETE_NOTE: Partial<Record<Kind, string>> = {
  BANK: msg("This removes the {n} records this file created, including expenses created from its bank rows. Use it to undo a wrong import, then import a corrected file. The deletion is recorded in the audit log."),
  ORDERS: msg("This removes the {n} records this file created, including their line items and attribution. Parcels already matched to these orders become unmatched. Use it to undo a wrong import, then import a corrected file. The deletion is recorded in the audit log."),
};

function BatchDialog({ id, kind, onClose }: { id: string; kind: Kind; onClose: () => void }) {
  const trpc = useTRPC();
  const { t, locale, dateTime } = useT();
  const q = useQuery(trpc.imports.get.queryOptions({ id }));
  const b = q.data;
  const summary = (b?.summary ?? {}) as { warnings?: Pick<RowIssue, "line" | "message" | "text" | "vars">[]; warningCount?: number; createdCreatives?: number; relinked?: { attributions: number; spend: number }; failure?: string; storedErrors?: number };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={b ? b.fileName : t("Import")} description={b ? t("{kind} import · {when}", { kind: t(KIND_META[b.kind as Kind].label), when: dateTime(b.createdAt) }) : undefined} className="max-w-4xl">
        {q.error ? <ErrorState message={errorMessage(q.error)} /> : !b ? <Loading /> : (
          <div className="flex flex-col gap-4 text-sm">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {[[t("Rows"), b.totalRows], [t("Imported"), b.importedRows], [t("Updated"), b.updatedRows], [t("Duplicates"), b.duplicateRows], [t("Errors"), b.errorRows]].map(([l, v]) => (
                <div key={l} className="rounded-lg border border-border bg-surface-2 p-2"><p className="text-xs text-muted">{l}</p><p className="num text-lg font-semibold">{v}</p></div>
              ))}
            </div>
            {summary.failure ? <p className="text-negative">{t(summary.failure)}</p> : null}
            {summary.createdCreatives ? <p className="text-muted">{t("{n} creatives were created from new IDs.", { n: summary.createdCreatives })}</p> : null}
            {summary.relinked?.attributions ? <p className="text-muted">{t("{n} earlier orders were linked to their creative.", { n: summary.relinked.attributions })}</p> : null}
            {b.errors.length ? (
              <div>
                <h3 className="mb-2 font-medium">{b._count.errors > b.errors.length ? t("Row errors (first {n} of {total})", { n: b.errors.length, total: b._count.errors }) : t("Row errors")}</h3>
                <IssueTable kind={kind} issues={b.errors.map((e) => ({ line: e.rowNumber, field: e.field, message: e.message, raw: e.rawRow }))} />
                {summary.storedErrors && b.errorRows > summary.storedErrors ? <p className="mt-1 text-xs text-muted">{t("Only the first {n} errors are stored.", { n: summary.storedErrors })}</p> : null}
              </div>
            ) : <p className="text-muted">{t("No row errors.")}</p>}
            {summary.warnings?.length ? (
              <details className="rounded-lg border border-border p-3">
                <summary className="cursor-pointer text-warning">{t("{n} warnings", { n: summary.warningCount ?? "" })}</summary>
                <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-xs text-muted">{summary.warnings.map((w, i) => <li key={i}>{t("Line {line}: {message}", { line: w.line, message: issueMessage(w, kind, t, locale === "en") })}</li>)}</ul>
              </details>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ImportHistory({ kind }: { kind: Kind }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const { t, dateTime } = useT();
  const canWrite = useCan("imports.write");
  const list = useQuery(trpc.imports.list.queryOptions({ kind, limit: 50 }));
  const [viewing, setViewing] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState<{ id: string; fileName: string; importedRows: number } | null>(null);
  const errorCsv = useMutation(trpc.imports.errorCsv.mutationOptions({ onSuccess: ({ filename, content }) => downloadText(filename, content), onError: (e) => toast("error", errorMessage(e)) }));
  const del = useMutation(
    trpc.imports.delete.mutationOptions({
      onSuccess: (r) => {
        setDeleting(null);
        for (const key of [trpc.imports, trpc.bank, trpc.spendReview, trpc.orders, trpc.expenses, trpc.reports, trpc.creatives]) qc.invalidateQueries({ queryKey: key.pathKey() });
        toast("success", t("Import removed ({n} records)", { n: r.orders + r.adSpend + r.expenses + r.bankTransactions }));
      },
      onError: (e) => toast("error", errorMessage(e)),
    }),
  );

  return (
    <Card>
      <CardHeader title={t("History")} description={t("Every file imported into this workspace, with what happened to each row.")} />
      {list.error ? <ErrorState message={errorMessage(list.error)} /> : list.isLoading ? <Loading /> : !list.data?.length ? (
        <EmptyState icon={<History />} title={t("No imports yet")} description={t(KIND_META[kind].empty)} />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <THead><tr><Th>{t("When")}</Th><Th>{t("File")}</Th><Th>{t("Status")}</Th><Th className="text-end">{t("Rows")}</Th><Th className="text-end">{t("Imported")}</Th>{kind === "AD_SPEND" ? <Th className="text-end">{t("Updated")}</Th> : null}<Th className="text-end">{t("Duplicates")}</Th><Th className="text-end">{t("Errors")}</Th><Th><span className="sr-only">{t("Actions")}</span></Th></tr></THead>
            <tbody>
              {list.data.map((b) => (
                <Tr key={b.id}>
                  <Td className="whitespace-nowrap text-xs text-muted">{dateTime(b.createdAt)}</Td>
                  <Td className="max-w-56 truncate" title={b.fileName}>{b.fileName}{b.source && kind === "ORDERS" ? <span className="ms-1 text-xs text-muted">· {b.source === "OTHER" ? t("other") : b.source.toLowerCase()}</span> : null}</Td>
                  <Td><Badge tone={STATUS[b.status].tone}>{t(STATUS[b.status].label)}</Badge></Td>
                  <Td className="num text-end">{b.totalRows}</Td>
                  <Td className="num text-end">{b.importedRows}</Td>
                  {kind === "AD_SPEND" ? <Td className="num text-end">{b.updatedRows}</Td> : null}
                  <Td className="num text-end text-muted">{b.duplicateRows}</Td>
                  <Td className={`num text-end ${b.errorRows ? "text-negative" : "text-muted"}`}>{b.errorRows}</Td>
                  <Td>
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" aria-label={t("View details")} onClick={() => setViewing(b.id)}><Eye /></Button>
                      {b.errorRows ? <Button size="icon" variant="ghost" aria-label={t("Download error CSV")} onClick={() => errorCsv.mutate({ id: b.id })}><Download /></Button> : null}
                      {canWrite ? <Button size="icon" variant="ghost" aria-label={t("Delete import")} onClick={() => setDeleting(b)}><Trash2 /></Button> : null}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
      {viewing ? <BatchDialog id={viewing} kind={kind} onClose={() => setViewing(null)} /> : null}
      {deleting ? (
        <Dialog open onOpenChange={(o) => !o && setDeleting(null)}>
          <DialogContent title={t("Delete this import?")} description={deleting.fileName}>
            <p className="text-sm text-muted">
              {t(DELETE_NOTE[kind] ?? msg("This removes the {n} records this file created. Use it to undo a wrong import, then import a corrected file. The deletion is recorded in the audit log."), { n: deleting.importedRows })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDeleting(null)}>{t("Cancel")}</Button>
              <Button variant="danger" disabled={del.isPending} onClick={() => del.mutate({ id: deleting.id })}>{t("Delete import")}</Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </Card>
  );
}
