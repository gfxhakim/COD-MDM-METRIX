import { createHash } from "node:crypto";
import type { ImportKind, ImportStatus, OrderSource, Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { InputError } from "@/server/errors";
import { assertCan, NotFoundError, type WorkspaceContext } from "@/server/tenancy";
import { hashCustomerRef, hashPhone, maskPhone } from "@/lib/pii";
import { normalizeCreativeKey, normalizeReference } from "@/lib/normalize";
import { toCsv } from "@/lib/csv";
import { CsvError, parseCsv, type ParsedCsv } from "@/domain/imports/csv";
import { detectDateFormat, type DateFormat } from "@/domain/imports/dates";
import { IMPORT_FIELDS, missingRequired } from "@/domain/imports/fields";
import type { Mapping, RowIssue } from "@/domain/imports/common";
import { validateOrders, type ImportedOrder } from "@/domain/imports/orders";
import { validateSpend, type ImportedSpend } from "@/domain/imports/spend";
import { validateBank, validateExpenses, type ImportedBankRow, type ImportedExpense } from "@/domain/imports/finance";
import { parseExchangeRates } from "@/domain/settings";
import { supersedeCsvSpend } from "@/server/meta/supersede";

export { InputError as ImportInputError };

export type ImportOptions = {
  dateFormat: DateFormat;
  /** Orders only. */
  source?: Extract<OrderSource, "SHOPIFY" | "EASYSELL" | "OTHER">;
  /** Ad spend only: units of workspace currency per 1 unit of the export currency. */
  fxRate?: number | null;
  /** Ad spend only: create creatives for IDs seen for the first time (default true). */
  createCreatives?: boolean;
  /** Ad spend only: product assigned to newly created creatives. */
  productId?: string | null;
};

export type ImportRequest = { kind: ImportKind; fileName: string; csvText: string; mapping: Mapping; options: ImportOptions };

const SPEND_SOURCE = "META_CSV";
const CHUNK = 200;
const PREVIEW_ROWS = 25;
const MAX_STORED_ERRORS = 2000;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const errorOf = (e: unknown) => (e instanceof CsvError ? new InputError(e.message) : e);

function parse(text: string): ParsedCsv {
  try {
    return parseCsv(text);
  } catch (e) {
    throw errorOf(e);
  }
}

function cleanMapping(kind: ImportKind, mapping: Mapping, headers: readonly string[]): Mapping {
  const allowed = new Set(IMPORT_FIELDS[kind].map((f) => f.key));
  const out: Mapping = {};
  for (const [k, v] of Object.entries(mapping)) {
    if (!allowed.has(k) || !v) continue;
    if (!headers.includes(v)) throw new InputError(`Column "${v}" is not in the file`);
    out[k] = v;
  }
  const missing = missingRequired(kind, out);
  if (missing.length) throw new InputError(`Map the required fields: ${missing.join(", ")}`);
  return out;
}

function resolvedDateFormat(csv: ParsedCsv, mapping: Mapping, kind: ImportKind, fmt: DateFormat): Exclude<DateFormat, "AUTO"> {
  if (fmt !== "AUTO") return fmt;
  const col = mapping[kind === "ORDERS" ? "placedAt" : "date"];
  return detectDateFormat(csv.rows.slice(0, 500).map((r) => (col ? r.values[col] ?? "" : "")));
}

type Validated =
  | { kind: "ORDERS"; items: ImportedOrder[] }
  | { kind: "AD_SPEND"; items: ImportedSpend[] }
  | { kind: "EXPENSES"; items: ImportedExpense[] }
  | { kind: "BANK"; items: ImportedBankRow[] };

async function validate(ctx: WorkspaceContext, req: ImportRequest) {
  const csv = parse(req.csvText);
  if (!csv.rows.length) throw new InputError("The file has a header row but no data rows");
  const mapping = cleanMapping(req.kind, req.mapping, csv.headers);
  const dateFormat = resolvedDateFormat(csv, mapping, req.kind, req.options.dateFormat);
  const products = (
    await db.product.findMany({
      where: { workspaceId: ctx.workspaceId },
      select: { id: true, sku: true, name: true, costVersions: { orderBy: { effectiveFrom: "desc" }, take: 1, select: { salePrice: true } } },
    })
  ).map((p) => ({ id: p.id, sku: p.sku, name: p.name, salePrice: p.costVersions[0]?.salePrice ?? null }));
  let validated: Validated;
  let issues: RowIssue[];
  let warnings: RowIssue[];
  let skipped = 0;
  switch (req.kind) {
    case "ORDERS": {
      const r = validateOrders(csv, mapping, { dateFormat, currency: ctx.currency, products });
      validated = { kind: "ORDERS", items: r.orders };
      ({ issues, warnings } = r);
      break;
    }
    case "AD_SPEND": {
      const r = validateSpend(csv, mapping, { dateFormat, workspaceCurrency: ctx.currency, fxRate: req.options.fxRate });
      validated = { kind: "AD_SPEND", items: r.items };
      ({ issues, warnings } = r);
      skipped = r.skippedZero;
      break;
    }
    case "EXPENSES": {
      const ws = await db.workspace.findUniqueOrThrow({ where: { id: ctx.workspaceId }, select: { exchangeRates: true } });
      const r = validateExpenses(csv, mapping, { dateFormat, currency: ctx.currency, products, rates: parseExchangeRates(ws.exchangeRates) });
      validated = { kind: "EXPENSES", items: r.items };
      ({ issues, warnings } = r);
      break;
    }
    case "BANK": {
      const r = validateBank(csv, mapping, { dateFormat, currency: ctx.currency });
      validated = { kind: "BANK", items: r.items };
      ({ issues, warnings } = r);
      break;
    }
  }
  return { csv, mapping, dateFormat, validated, issues, warnings, skipped };
}

/** Keys already in the database for this workspace, so the preview and commit agree on duplicates. */
type Existing = Map<string, { id: string; spend?: number; synced?: boolean }>;

async function existingKeys(ctx: WorkspaceContext, v: Validated, source: string): Promise<Existing> {
  const ws = ctx.workspaceId;
  const out: Existing = new Map();
  for (let i = 0; i < v.items.length; i += 500) {
    switch (v.kind) {
      case "ORDERS": {
        const chunk = v.items.slice(i, i + 500);
        const rows = await db.order.findMany({ where: { workspaceId: ws, source: source as OrderSource, externalOrderId: { in: chunk.map((o) => o.externalOrderId) } }, select: { id: true, externalOrderId: true } });
        rows.forEach((r) => out.set(r.externalOrderId, { id: r.id }));
        // Orders the MDM sync already brought in are the same orders: never imported twice.
        const refsOf = (o: ImportedOrder) => [...new Set([o.normalizedOrderNumber, normalizeReference(o.externalOrderId)].filter(Boolean))];
        const synced = await db.order.findMany({ where: { workspaceId: ws, source: "MDM_EXPRESS", normalizedOrderNumber: { in: [...new Set(chunk.flatMap(refsOf))] } }, select: { id: true, normalizedOrderNumber: true } });
        for (const o of chunk) {
          if (out.has(o.externalOrderId)) continue;
          const refs = refsOf(o);
          const hits = synced.filter((r) => refs.includes(r.normalizedOrderNumber));
          if (hits.length === 1) out.set(o.externalOrderId, { id: hits[0].id, synced: true });
        }
        break;
      }
      case "AD_SPEND": {
        const hashes = v.items.slice(i, i + 500).map((s) => sha(s.identity));
        const rows = await db.adSpend.findMany({ where: { workspaceId: ws, source: SPEND_SOURCE, sourceRowHash: { in: hashes } }, select: { id: true, sourceRowHash: true, spend: true } });
        rows.forEach((r) => out.set(r.sourceRowHash, { id: r.id, spend: r.spend }));
        break;
      }
      case "EXPENSES": {
        const hashes = v.items.slice(i, i + 500).map((e) => sha(`expense|${e.identity}`));
        const rows = await db.expense.findMany({ where: { workspaceId: ws, sourceRowHash: { in: hashes } }, select: { id: true, sourceRowHash: true } });
        rows.forEach((r) => out.set(r.sourceRowHash!, { id: r.id }));
        break;
      }
      case "BANK": {
        const hashes = v.items.slice(i, i + 500).map((b) => sha(`bank|${b.identity}`));
        const rows = await db.bankTransaction.findMany({ where: { workspaceId: ws, rowHash: { in: hashes } }, select: { id: true, rowHash: true } });
        rows.forEach((r) => out.set(r.rowHash, { id: r.id }));
        break;
      }
    }
  }
  return out;
}

function keyOf(v: Validated["kind"], item: ImportedOrder | ImportedSpend | ImportedExpense | ImportedBankRow): string {
  switch (v) {
    case "ORDERS":
      return (item as ImportedOrder).externalOrderId;
    case "AD_SPEND":
      return sha((item as ImportedSpend).identity);
    case "EXPENSES":
      return sha(`expense|${(item as ImportedExpense).identity}`);
    case "BANK":
      return sha(`bank|${(item as ImportedBankRow).identity}`);
  }
}

function classify(v: Validated, existing: Existing) {
  let fresh = 0;
  let duplicate = 0;
  let update = 0;
  const status = v.items.map((item) => {
    const hit = existing.get(keyOf(v.kind, item));
    if (!hit) {
      fresh++;
      return "NEW" as const;
    }
    if (v.kind === "AD_SPEND" && hit.spend !== (item as ImportedSpend).spend) {
      update++;
      return "UPDATE" as const;
    }
    duplicate++;
    return "DUPLICATE" as const;
  });
  return { fresh, duplicate, update, status };
}

/** Only mapped columns are kept for error review, and phone numbers are masked. */
function reviewRow(row: ParsedCsv["rows"][number] | undefined, mapping: Mapping): Record<string, string> {
  if (!row) return {};
  const out: Record<string, string> = {};
  for (const [field, col] of Object.entries(mapping)) {
    if (!col) continue;
    const v = row.values[col] ?? "";
    out[col] = field === "phone" ? maskPhone(v) ?? "" : field === "customerId" ? (v ? "(hidden)" : "") : v.slice(0, 500);
  }
  return out;
}

function previewRow(kind: ImportKind, item: ImportedOrder | ImportedSpend | ImportedExpense | ImportedBankRow): Record<string, unknown> {
  switch (kind) {
    case "ORDERS": {
      const o = item as ImportedOrder;
      return { orderNumber: o.orderNumber, placedAt: o.placedAt, status: o.status, codAmount: o.codAmount, items: o.items.map((l) => `${l.quantity}× ${l.sku ?? l.productName ?? "?"}`).join(", "), unknownProduct: o.items.some((l) => !l.productId), utmContent: o.utmContent, wilaya: o.wilaya, phone: o.phone ? maskPhone(o.phone) : null };
    }
    case "AD_SPEND": {
      const s = item as ImportedSpend;
      return { date: s.date, campaignName: s.campaignName, adsetName: s.adsetName, adName: s.adName, creativeId: s.externalCreativeId, spend: s.spend, originalSpend: s.originalSpend, originalCurrency: s.originalCurrency, impressions: s.impressions, clicks: s.clicks };
    }
    case "EXPENSES": {
      const e = item as ImportedExpense;
      return { date: e.date, category: e.category, amount: e.amount, originalAmount: e.originalAmount, originalCurrency: e.originalCurrency, description: e.description, productId: e.productId, costType: e.costType };
    }
    case "BANK": {
      const b = item as ImportedBankRow;
      return { date: b.date, description: b.description, amount: b.amount, reference: b.reference };
    }
  }
}

export async function previewImport(ctx: WorkspaceContext, req: ImportRequest) {
  assertCan(ctx, "imports.write");
  const { csv, mapping, dateFormat, validated, issues, warnings, skipped } = await validate(ctx, req);
  const source = req.kind === "ORDERS" ? req.options.source ?? "OTHER" : SPEND_SOURCE;
  const existing = await existingKeys(ctx, validated, source);
  const c = classify(validated, existing);
  let unmatchedCreatives: string[] = [];
  if (validated.kind === "AD_SPEND") {
    const keys = [...new Set(validated.items.map((s) => s.creativeKey).filter((k): k is string => !!k))];
    const known = new Set((await db.creative.findMany({ where: { workspaceId: ctx.workspaceId, normalizedKey: { in: keys } }, select: { normalizedKey: true } })).map((c) => c.normalizedKey));
    unmatchedCreatives = keys.filter((k) => !known.has(k));
  }
  const rowsByLine = new Map(csv.rows.map((r) => [r.line, r]));
  return {
    kind: req.kind,
    dateFormat,
    totalRows: csv.rows.length,
    truncated: csv.truncated,
    counts: { valid: validated.items.length, new: c.fresh, duplicate: c.duplicate, update: c.update, errorRows: new Set(issues.map((i) => i.line)).size, warnings: warnings.length, skipped },
    preview: validated.items.slice(0, PREVIEW_ROWS).map((item, i) => ({ line: item.line, state: c.status[i], ...previewRow(req.kind, item) })),
    issues: issues.slice(0, 200).map((i) => ({ ...i, raw: reviewRow(rowsByLine.get(i.line), mapping) })),
    warnings: warnings.slice(0, 200),
    unmatchedCreatives: unmatchedCreatives.slice(0, 100),
    unmatchedCreativeCount: unmatchedCreatives.length,
  };
}

export async function commitImport(ctx: WorkspaceContext, req: ImportRequest & { fileSize: number }) {
  assertCan(ctx, "imports.write");
  const { csv, mapping, dateFormat, validated, issues, warnings, skipped } = await validate(ctx, req);
  if (req.options.productId) {
    const p = await db.product.findFirst({ where: { id: req.options.productId, workspaceId: ctx.workspaceId }, select: { id: true } });
    if (!p) throw new NotFoundError("Product not found");
  }
  const source = req.kind === "ORDERS" ? req.options.source ?? "OTHER" : SPEND_SOURCE;
  const existing = await existingKeys(ctx, validated, source);
  const c = classify(validated, existing);

  const batch = await db.importBatch.create({
    data: {
      workspaceId: ctx.workspaceId,
      kind: req.kind,
      source,
      fileName: req.fileName.slice(0, 200),
      fileSize: req.fileSize,
      totalRows: csv.rows.length,
      columnMapping: mapping as Prisma.InputJsonValue,
      options: { ...req.options, dateFormat } as Prisma.InputJsonValue,
      createdById: ctx.userId,
    },
  });

  const rowsByLine = new Map(csv.rows.map((r) => [r.line, r]));
  const errorData = issues.slice(0, MAX_STORED_ERRORS).map((i) => ({ workspaceId: ctx.workspaceId, batchId: batch.id, rowNumber: i.line, field: i.field ?? null, message: i.message, rawRow: reviewRow(rowsByLine.get(i.line), mapping) }));
  for (let i = 0; i < errorData.length; i += 500) await db.importRowError.createMany({ data: errorData.slice(i, i + 500) });

  let imported = 0;
  let updated = 0;
  let createdCreatives = 0;
  let superseded = 0;
  try {
    switch (validated.kind) {
      case "ORDERS":
        imported = await writeOrders(ctx, batch.id, source as OrderSource, validated.items.filter((_, i) => c.status[i] === "NEW"));
        updated = await fillSyncedOrders(ctx, validated.items.filter((o, i) => c.status[i] === "DUPLICATE" && existing.get(o.externalOrderId)?.synced), existing);
        break;
      case "AD_SPEND": {
        const r = await writeSpend(ctx, batch.id, validated.items, c.status, req.options);
        imported = r.imported;
        updated = r.updated;
        createdCreatives = r.createdCreatives;
        // Days and ads the Meta connection already synced keep Meta's numbers; these rows don't count twice.
        const days = validated.items.map((x) => x.date.getTime());
        if (days.length) superseded = await supersedeCsvSpend(ctx.workspaceId, { from: new Date(days.reduce((a, b) => Math.min(a, b))), to: new Date(days.reduce((a, b) => Math.max(a, b))) });
        break;
      }
      case "EXPENSES":
        imported = await writeExpenses(ctx, batch.id, validated.items.filter((_, i) => c.status[i] === "NEW"));
        break;
      case "BANK":
        imported = await writeBank(ctx, batch.id, validated.items.filter((_, i) => c.status[i] === "NEW"));
        break;
    }
  } catch (e) {
    await db.importBatch.update({ where: { id: batch.id }, data: { status: "FAILED", importedRows: imported, finishedAt: new Date(), summary: { failure: "The import stopped part-way; rows already written are kept and a retry will skip them as duplicates." } } });
    throw e;
  }

  const relinked = req.kind === "ORDERS" || req.kind === "AD_SPEND" ? await relinkAttribution(ctx) : { attributions: 0, spend: 0 };
  const errorRows = new Set(issues.map((i) => i.line)).size;
  const status: ImportStatus = errorRows === 0 ? "COMMITTED" : imported + updated + c.duplicate > 0 ? "PARTIAL" : "FAILED";
  const summary = { dateFormat, warnings: warnings.slice(0, 200), warningCount: warnings.length, skippedZeroRows: skipped, createdCreatives, supersededByMeta: superseded, relinked, truncated: csv.truncated, storedErrors: errorData.length };
  const done = await db.importBatch.update({
    where: { id: batch.id },
    data: { status, importedRows: imported, updatedRows: updated, duplicateRows: c.duplicate, errorRows, summary: summary as Prisma.InputJsonValue, finishedAt: new Date() },
  });
  await audit(ctx, "import.committed", { type: "ImportBatch", id: batch.id }, { kind: req.kind, source, fileName: done.fileName, imported, updated, duplicates: c.duplicate, errorRows });
  return done;
}

async function writeOrders(ctx: WorkspaceContext, batchId: string, source: OrderSource, orders: ImportedOrder[]): Promise<number> {
  const keys = [...new Set(orders.map((o) => o.creativeKey).filter((k): k is string => !!k))];
  const creatives = new Map((await db.creative.findMany({ where: { workspaceId: ctx.workspaceId, normalizedKey: { in: keys } }, select: { id: true, normalizedKey: true } })).map((c) => [c.normalizedKey, c.id]));
  let n = 0;
  for (let i = 0; i < orders.length; i += CHUNK) {
    const chunk = orders.slice(i, i + CHUNK);
    await db.$transaction(async (tx) => {
      for (const o of chunk) {
        const creativeId = o.creativeKey ? creatives.get(o.creativeKey) ?? null : null;
        await tx.order.create({
          data: {
            workspaceId: ctx.workspaceId,
            source,
            externalOrderId: o.externalOrderId,
            orderNumber: o.orderNumber,
            normalizedOrderNumber: o.normalizedOrderNumber,
            placedAt: o.placedAt,
            status: o.status,
            confirmedAt: o.status === "CONFIRMED" ? o.placedAt : null,
            canceledAt: o.status === "CANCELED" ? o.placedAt : null,
            callAttempts: o.callAttempts,
            phoneHash: o.phone ? hashPhone(o.phone, ctx.workspaceId) : null,
            phoneMasked: o.phone ? maskPhone(o.phone) : null,
            customerRef: o.customerRef ? hashCustomerRef(o.customerRef, ctx.workspaceId) : null,
            wilaya: o.wilaya,
            city: o.city,
            codAmount: o.codAmount,
            currency: o.currency,
            utmSource: o.utmSource,
            utmMedium: o.utmMedium,
            utmCampaign: o.utmCampaign,
            utmContent: o.utmContent,
            tags: o.tags,
            notes: o.notes,
            importBatchId: batchId,
            lines: { create: o.items.map((l) => ({ workspaceId: ctx.workspaceId, productId: l.productId, sku: l.sku, productName: l.productName, quantity: l.quantity, unitPrice: l.unitPrice, currency: o.currency })) },
            attribution: {
              create: {
                workspaceId: ctx.workspaceId,
                orderPlacedAt: o.placedAt,
                rawUtmContent: o.utmContent,
                normalizedCreativeKey: o.creativeKey,
                creativeId,
                method: creativeId ? "UTM_CONTENT" : "NONE",
                confidence: creativeId ? 1 : 0,
              },
            },
          },
        });
        n++;
      }
    });
  }
  return n;
}

/**
 * Rows for orders the MDM sync already brought in: the file's content ID fills in orders
 * MDM had none for. Nothing else changes, and attributions set by hand are kept.
 */
async function fillSyncedOrders(ctx: WorkspaceContext, rows: ImportedOrder[], existing: Existing): Promise<number> {
  const withUtm = rows.filter((o) => o.utmContent);
  if (!withUtm.length) return 0;
  const creatives = new Map((await db.creative.findMany({ where: { workspaceId: ctx.workspaceId }, select: { id: true, normalizedKey: true } })).map((c) => [c.normalizedKey, c.id]));
  let n = 0;
  for (const o of withUtm) {
    const id = existing.get(o.externalOrderId)!.id;
    await db.$transaction(async (tx) => {
      const order = await tx.order.findFirst({ where: { id, workspaceId: ctx.workspaceId, utmContent: null }, include: { attribution: true } });
      if (!order) return;
      await tx.order.update({ where: { id }, data: { utmSource: o.utmSource, utmMedium: o.utmMedium, utmCampaign: o.utmCampaign, utmContent: o.utmContent } });
      if (order.attribution?.method !== "MANUAL") {
        const creativeId = o.creativeKey ? creatives.get(o.creativeKey) ?? null : null;
        const a = { rawUtmContent: o.utmContent, normalizedCreativeKey: o.creativeKey, creativeId, method: creativeId ? ("UTM_CONTENT" as const) : ("NONE" as const), confidence: creativeId ? 1 : 0 };
        await tx.attribution.upsert({ where: { orderId: id }, create: { workspaceId: ctx.workspaceId, orderId: id, orderPlacedAt: order.placedAt, ...a }, update: a });
      }
      n++;
    });
  }
  return n;
}

async function writeSpend(ctx: WorkspaceContext, batchId: string, items: ImportedSpend[], status: ReturnType<typeof classify>["status"], opts: ImportOptions) {
  const ws = ctx.workspaceId;
  const keys = [...new Set(items.map((s) => s.creativeKey).filter((k): k is string => !!k))];
  const creatives = new Map((await db.creative.findMany({ where: { workspaceId: ws, normalizedKey: { in: keys } }, select: { id: true, normalizedKey: true } })).map((c) => [c.normalizedKey, c.id]));
  let createdCreatives = 0;
  if (opts.createCreatives ?? true) {
    for (const key of keys) {
      if (creatives.has(key)) continue;
      const first = items.find((s) => s.creativeKey === key)!;
      const c = await db.creative.upsert({
        where: { workspaceId_platform_externalCreativeId: { workspaceId: ws, platform: "META", externalCreativeId: first.externalCreativeId! } },
        create: { workspaceId: ws, platform: "META", externalCreativeId: first.externalCreativeId!, normalizedKey: key, name: first.adName, campaignId: first.campaignId, campaignName: first.campaignName, adsetName: first.adsetName, productId: opts.productId ?? null },
        update: {},
      });
      creatives.set(key, c.id);
      createdCreatives++;
    }
  }
  let imported = 0;
  let updated = 0;
  for (let i = 0; i < items.length; i += CHUNK) {
    await db.$transaction(async (tx) => {
      for (let j = i; j < Math.min(i + CHUNK, items.length); j++) {
        const s = items[j];
        const hash = sha(s.identity);
        const money = { spend: s.spend, currency: s.currency, originalSpend: s.originalSpend, originalCurrency: s.originalCurrency, fxRate: s.fxRate, impressions: s.impressions, clicks: s.clicks };
        if (status[j] === "UPDATE") {
          await tx.adSpend.update({ where: { workspaceId_source_sourceRowHash: { workspaceId: ws, source: SPEND_SOURCE, sourceRowHash: hash } }, data: money });
          updated++;
        } else if (status[j] === "NEW") {
          await tx.adSpend.create({
            data: {
              workspaceId: ws,
              platform: "META",
              source: SPEND_SOURCE,
              date: s.date,
              campaignId: s.campaignId,
              campaignName: s.campaignName,
              adsetId: s.adsetId,
              adsetName: s.adsetName,
              adId: s.adId,
              adName: s.adName,
              externalCreativeId: s.externalCreativeId,
              creativeId: s.creativeKey ? creatives.get(s.creativeKey) ?? null : null,
              sourceRowHash: hash,
              importBatchId: batchId,
              ...money,
            },
          });
          imported++;
        }
      }
    });
  }
  return { imported, updated, createdCreatives };
}

async function writeExpenses(ctx: WorkspaceContext, batchId: string, items: ImportedExpense[]): Promise<number> {
  for (let i = 0; i < items.length; i += 500) {
    await db.expense.createMany({
      data: items.slice(i, i + 500).map((e) => ({
        workspaceId: ctx.workspaceId,
        date: e.date,
        category: e.category,
        amount: e.amount,
        currency: ctx.currency,
        originalAmount: e.originalAmount,
        originalCurrency: e.originalCurrency,
        fxRate: e.fxRate,
        description: e.description,
        allocation: e.productId ? ("PRODUCT" as const) : ("GLOBAL" as const),
        productId: e.productId,
        costType: e.costType,
        importBatchId: batchId,
        sourceRowHash: sha(`expense|${e.identity}`),
        createdById: ctx.userId,
      })),
    });
  }
  return items.length;
}

async function writeBank(ctx: WorkspaceContext, batchId: string, items: ImportedBankRow[]): Promise<number> {
  for (let i = 0; i < items.length; i += 500) {
    await db.bankTransaction.createMany({
      data: items.slice(i, i + 500).map((b) => ({ workspaceId: ctx.workspaceId, date: b.date, description: b.description, amount: b.amount, currency: ctx.currency, reference: b.reference, rowHash: sha(`bank|${b.identity}`), importBatchId: batchId })),
    });
  }
  return items.length;
}

/**
 * Attribution normalization: orders whose utm_content arrived before the creative existed,
 * and spend rows whose creative was created later, get linked by normalized key.
 * Manual attributions are never touched.
 */
export async function relinkAttribution(ctx: Pick<WorkspaceContext, "workspaceId">, tx: Prisma.TransactionClient = db) {
  const ws = ctx.workspaceId;
  const creatives = await tx.creative.findMany({ where: { workspaceId: ws }, select: { id: true, normalizedKey: true } });
  const byKey = new Map(creatives.map((c) => [c.normalizedKey, c.id]));
  const pending = await tx.attribution.findMany({ where: { workspaceId: ws, creativeId: null, method: "NONE", normalizedCreativeKey: { not: null } }, select: { normalizedCreativeKey: true } });
  let attributions = 0;
  for (const key of new Set(pending.map((p) => p.normalizedCreativeKey!))) {
    const id = byKey.get(key);
    if (!id) continue;
    const r = await tx.attribution.updateMany({ where: { workspaceId: ws, creativeId: null, method: "NONE", normalizedCreativeKey: key }, data: { creativeId: id, method: "UTM_CONTENT", confidence: 1 } });
    attributions += r.count;
  }
  const orphanSpend = await tx.adSpend.findMany({ where: { workspaceId: ws, creativeId: null, externalCreativeId: { not: null } }, select: { externalCreativeId: true } });
  let spend = 0;
  for (const ext of new Set(orphanSpend.map((s) => s.externalCreativeId!))) {
    const id = byKey.get(normalizeCreativeKey(ext));
    if (!id) continue;
    const r = await tx.adSpend.updateMany({ where: { workspaceId: ws, creativeId: null, externalCreativeId: ext }, data: { creativeId: id } });
    spend += r.count;
  }
  return { attributions, spend };
}

export async function listBatches(ctx: WorkspaceContext, input: { kind?: ImportKind; limit: number }) {
  return db.importBatch.findMany({
    where: { workspaceId: ctx.workspaceId, kind: input.kind },
    orderBy: { createdAt: "desc" },
    take: input.limit,
    select: { id: true, kind: true, status: true, source: true, fileName: true, fileSize: true, totalRows: true, importedRows: true, updatedRows: true, duplicateRows: true, errorRows: true, createdAt: true, finishedAt: true, summary: true },
  });
}

export async function getBatch(ctx: WorkspaceContext, id: string) {
  const batch = await db.importBatch.findFirst({
    where: { id, workspaceId: ctx.workspaceId },
    include: { errors: { orderBy: { rowNumber: "asc" }, take: 500, select: { id: true, rowNumber: true, field: true, message: true, rawRow: true } }, _count: { select: { orders: true, adSpend: true, expenses: true, bankTransactions: true, errors: true } } },
  });
  if (!batch) throw new NotFoundError("Import not found");
  return batch;
}

export async function errorCsv(ctx: WorkspaceContext, id: string) {
  const batch = await db.importBatch.findFirst({ where: { id, workspaceId: ctx.workspaceId }, select: { id: true, fileName: true, columnMapping: true } });
  if (!batch) throw new NotFoundError("Import not found");
  const errors = await db.importRowError.findMany({ where: { batchId: batch.id, workspaceId: ctx.workspaceId }, orderBy: { rowNumber: "asc" } });
  const cols = [...new Set(errors.flatMap((e) => Object.keys((e.rawRow as Record<string, string>) ?? {})))];
  const content = toCsv(errors, [
    { header: "Line", value: (e) => e.rowNumber },
    { header: "Field", value: (e) => e.field ?? "" },
    { header: "Error", value: (e) => e.message },
    ...cols.map((c) => ({ header: c, value: (e: (typeof errors)[number]) => ((e.rawRow as Record<string, string>) ?? {})[c] ?? "" })),
  ]);
  const base = batch.fileName.replace(/\.csv$/i, "").replace(/[^\w.-]+/g, "_").slice(0, 80);
  return { filename: `${base}-errors.csv`, content };
}

/** Correction action: remove everything a batch created so a fixed file can be imported cleanly. */
export async function deleteBatch(ctx: WorkspaceContext, id: string) {
  assertCan(ctx, "imports.write");
  const batch = await db.importBatch.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!batch) throw new NotFoundError("Import not found");
  const ws = ctx.workspaceId;
  const removed = await db.$transaction(async (tx) => {
    const bankIds = (await tx.bankTransaction.findMany({ where: { workspaceId: ws, importBatchId: batch.id }, select: { id: true } })).map((b) => b.id);
    const bankExpenses = await tx.expense.deleteMany({ where: { workspaceId: ws, bankTransactionId: { in: bankIds } } });
    await tx.parcel.updateMany({ where: { workspaceId: ws, order: { importBatchId: batch.id } }, data: { orderId: null, matchMethod: "NONE", matchConfidence: 0 } });
    const orders = await tx.order.deleteMany({ where: { workspaceId: ws, importBatchId: batch.id } });
    const spend = await tx.adSpend.deleteMany({ where: { workspaceId: ws, importBatchId: batch.id } });
    const expenses = await tx.expense.deleteMany({ where: { workspaceId: ws, importBatchId: batch.id } });
    const bank = await tx.bankTransaction.deleteMany({ where: { workspaceId: ws, id: { in: bankIds } } });
    await tx.importBatch.delete({ where: { id: batch.id } });
    const r = { orders: orders.count, adSpend: spend.count, expenses: expenses.count + bankExpenses.count, bankTransactions: bank.count };
    await audit(ctx, "import.deleted", { type: "ImportBatch", id: batch.id }, { kind: batch.kind, fileName: batch.fileName, ...r }, tx);
    return r;
  });
  return removed;
}

export async function lastMapping(ctx: WorkspaceContext, kind: ImportKind) {
  const b = await db.importBatch.findFirst({ where: { workspaceId: ctx.workspaceId, kind, status: { in: ["COMMITTED", "PARTIAL"] } }, orderBy: { createdAt: "desc" }, select: { columnMapping: true, options: true } });
  return b ? { mapping: (b.columnMapping ?? {}) as Record<string, string>, options: (b.options ?? {}) as Record<string, unknown> } : null;
}
