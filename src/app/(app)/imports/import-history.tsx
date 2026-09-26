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
import { errorMessage, useTRPC } from "@/lib/trpc/client";
import { formatDateTime } from "@/lib/utils";
import { downloadText, KIND_META, type Kind } from "./download";
import { IssueTable } from "./import-wizard";

const STATUS: Record<string, { label: string; tone: "positive" | "warning" | "negative" | "neutral" }> = {
  COMMITTED: { label: "Imported", tone: "positive" },
  PARTIAL: { label: "Partial", tone: "warning" },
  FAILED: { label: "Failed", tone: "negative" },
  PREVIEW: { label: "Preview", tone: "neutral" },
};

function BatchDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const trpc = useTRPC();
  const q = useQuery(trpc.imports.get.queryOptions({ id }));
  const b = q.data;
  const summary = (b?.summary ?? {}) as { warnings?: { line: number; message: string }[]; warningCount?: number; createdCreatives?: number; relinked?: { attributions: number; spend: number }; failure?: string; storedErrors?: number };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={b ? b.fileName : "Import"} description={b ? `${KIND_META[b.kind as Kind].label} import · ${formatDateTime(b.createdAt)}` : undefined} className="max-w-4xl">
        {q.error ? <ErrorState message={errorMessage(q.error)} /> : !b ? <Loading /> : (
          <div className="flex flex-col gap-4 text-sm">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {[["Rows", b.totalRows], ["Imported", b.importedRows], ["Updated", b.updatedRows], ["Duplicates", b.duplicateRows], ["Errors", b.errorRows]].map(([l, v]) => (
                <div key={l} className="rounded-lg border border-border bg-surface-2 p-2"><p className="text-xs text-muted">{l}</p><p className="num text-lg font-semibold">{v}</p></div>
              ))}
            </div>
            {summary.failure ? <p className="text-negative">{summary.failure}</p> : null}
            {summary.createdCreatives ? <p className="text-muted">{summary.createdCreatives} creatives were created from new IDs.</p> : null}
            {summary.relinked?.attributions ? <p className="text-muted">{summary.relinked.attributions} earlier orders were linked to their creative.</p> : null}
            {b.errors.length ? (
              <div>
                <h3 className="mb-2 font-medium">Row errors{b._count.errors > b.errors.length ? ` (first ${b.errors.length} of ${b._count.errors})` : ""}</h3>
                <IssueTable issues={b.errors.map((e) => ({ line: e.rowNumber, field: e.field, message: e.message, raw: e.rawRow }))} />
                {summary.storedErrors && b.errorRows > summary.storedErrors ? <p className="mt-1 text-xs text-muted">Only the first {summary.storedErrors} errors are stored.</p> : null}
              </div>
            ) : <p className="text-muted">No row errors.</p>}
            {summary.warnings?.length ? (
              <details className="rounded-lg border border-border p-3">
                <summary className="cursor-pointer text-warning">{summary.warningCount} warnings</summary>
                <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-xs text-muted">{summary.warnings.map((w, i) => <li key={i}>Line {w.line}: {w.message}</li>)}</ul>
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
        toast("success", `Import removed (${r.orders + r.adSpend + r.expenses + r.bankTransactions} records)`);
      },
      onError: (e) => toast("error", errorMessage(e)),
    }),
  );

  return (
    <Card>
      <CardHeader title="History" description="Every file imported into this workspace, with what happened to each row." />
      {list.error ? <ErrorState message={errorMessage(list.error)} /> : list.isLoading ? <Loading /> : !list.data?.length ? (
        <EmptyState icon={<History />} title="No imports yet" description={`Imported ${KIND_META[kind].noun} will be listed here.`} />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <THead><tr><Th>When</Th><Th>File</Th><Th>Status</Th><Th className="text-right">Rows</Th><Th className="text-right">Imported</Th>{kind === "AD_SPEND" ? <Th className="text-right">Updated</Th> : null}<Th className="text-right">Duplicates</Th><Th className="text-right">Errors</Th><Th><span className="sr-only">Actions</span></Th></tr></THead>
            <tbody>
              {list.data.map((b) => (
                <Tr key={b.id}>
                  <Td className="whitespace-nowrap text-xs text-muted">{formatDateTime(b.createdAt)}</Td>
                  <Td className="max-w-56 truncate" title={b.fileName}>{b.fileName}{b.source && kind === "ORDERS" ? <span className="ml-1 text-xs text-muted">· {b.source.toLowerCase()}</span> : null}</Td>
                  <Td><Badge tone={STATUS[b.status].tone}>{STATUS[b.status].label}</Badge></Td>
                  <Td className="num text-right">{b.totalRows}</Td>
                  <Td className="num text-right">{b.importedRows}</Td>
                  {kind === "AD_SPEND" ? <Td className="num text-right">{b.updatedRows}</Td> : null}
                  <Td className="num text-right text-muted">{b.duplicateRows}</Td>
                  <Td className={`num text-right ${b.errorRows ? "text-negative" : "text-muted"}`}>{b.errorRows}</Td>
                  <Td>
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" aria-label="View details" onClick={() => setViewing(b.id)}><Eye /></Button>
                      {b.errorRows ? <Button size="icon" variant="ghost" aria-label="Download error CSV" onClick={() => errorCsv.mutate({ id: b.id })}><Download /></Button> : null}
                      {canWrite ? <Button size="icon" variant="ghost" aria-label="Delete import" onClick={() => setDeleting(b)}><Trash2 /></Button> : null}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
      {viewing ? <BatchDialog id={viewing} onClose={() => setViewing(null)} /> : null}
      {deleting ? (
        <Dialog open onOpenChange={(o) => !o && setDeleting(null)}>
          <DialogContent title="Delete this import?" description={deleting.fileName}>
            <p className="text-sm text-muted">
              This removes the {deleting.importedRows} records this file created
              {kind === "BANK" ? ", including expenses created from its bank rows" : ""}
              {kind === "ORDERS" ? ", including their line items and attribution. Parcels already matched to these orders become unmatched" : ""}.
              Use it to undo a wrong import, then import a corrected file. The deletion is recorded in the audit log.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDeleting(null)}>Cancel</Button>
              <Button variant="danger" disabled={del.isPending} onClick={() => del.mutate({ id: deleting.id })}>Delete import</Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </Card>
  );
}
