import { normalizeCreativeKey } from "@/lib/normalize";
import { currencyExponent } from "@/lib/money";
import type { ParsedCsv } from "./csv";
import { cell, currencyOf, int, money, occurrenceKeys, RowError, type Mapping, type RowIssue } from "./common";
import { parseDate, type DateFormat } from "./dates";

export type ImportedSpend = {
  line: number;
  date: Date;
  campaignId: string | null;
  campaignName: string | null;
  adsetId: string | null;
  adsetName: string | null;
  adId: string | null;
  adName: string | null;
  externalCreativeId: string | null;
  creativeKey: string | null;
  spend: number;
  currency: string;
  originalSpend: number | null;
  originalCurrency: string | null;
  fxRate: number | null;
  impressions: number | null;
  clicks: number | null;
  /** Identity (date + campaign + ad set + ad + creative + occurrence). Spend is excluded so re-exports update amounts. */
  identity: string;
};

/** "Amount spent (USD)" → USD */
export function currencyFromHeader(header: string | null | undefined): string | null {
  const m = header ? /\(([A-Z]{3})\)/.exec(header) : null;
  return m ? m[1] : null;
}

export function convert(minor: number, from: string, to: string, rate: number): number {
  const shift = currencyExponent(to) - currencyExponent(from);
  return Math.round(minor * rate * 10 ** shift);
}

export function validateSpend(
  csv: ParsedCsv,
  mapping: Mapping,
  opts: { dateFormat: Exclude<DateFormat, "AUTO">; workspaceCurrency: string; fxRate?: number | null },
): { items: ImportedSpend[]; issues: RowIssue[]; warnings: RowIssue[]; skippedZero: number } {
  const headerCurrency = currencyFromHeader(mapping.spend);
  const issues: RowIssue[] = [];
  const warnings: RowIssue[] = [];
  const pending: Omit<ImportedSpend, "identity">[] = [];
  const ids: string[] = [];
  let skippedZero = 0;
  for (const row of csv.rows) {
    try {
      const dateRaw = cell(row, mapping, "date");
      const date = parseDate(dateRaw, opts.dateFormat);
      if (!date) throw new RowError("date", dateRaw ? `Invalid date "${dateRaw}"` : "Missing date");
      const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
      const currency = currencyOf(cell(row, mapping, "currency"), headerCurrency ?? opts.workspaceCurrency);
      const spendRaw = cell(row, mapping, "spend");
      if (!spendRaw) throw new RowError("spend", "Missing amount spent");
      const original = money(spendRaw, currency, "spend");
      const impressionsRaw = cell(row, mapping, "impressions");
      const clicksRaw = cell(row, mapping, "clicks");
      const impressions = impressionsRaw ? int(impressionsRaw, "impressions") : null;
      const clicks = clicksRaw ? int(clicksRaw, "clicks") : null;
      if (original === 0 && !impressions) {
        skippedZero++;
        continue;
      }
      let spend = original;
      let fx: number | null = null;
      if (currency !== opts.workspaceCurrency) {
        if (!opts.fxRate || opts.fxRate <= 0) throw new RowError("currency", `Spend is in ${currency}; enter an exchange rate to ${opts.workspaceCurrency}`);
        fx = opts.fxRate;
        spend = convert(original, currency, opts.workspaceCurrency, fx);
      }
      const externalCreativeId = cell(row, mapping, "creativeId") || cell(row, mapping, "adId") || cell(row, mapping, "adName") || null;
      const creativeKey = normalizeCreativeKey(externalCreativeId) || null;
      if (!creativeKey) warnings.push({ line: row.line, field: "creativeId", message: "No creative, ad ID or ad name: kept as unmatched spend" });
      const item = {
        line: row.line,
        date: day,
        campaignId: cell(row, mapping, "campaignId") || null,
        campaignName: cell(row, mapping, "campaignName") || null,
        adsetId: cell(row, mapping, "adsetId") || null,
        adsetName: cell(row, mapping, "adsetName") || null,
        adId: cell(row, mapping, "adId") || null,
        adName: cell(row, mapping, "adName") || null,
        externalCreativeId,
        creativeKey,
        spend,
        currency: opts.workspaceCurrency,
        originalSpend: fx ? original : null,
        originalCurrency: fx ? currency : null,
        fxRate: fx,
        impressions,
        clicks,
      };
      pending.push(item);
      ids.push([day.toISOString().slice(0, 10), item.campaignId ?? item.campaignName, item.adsetId ?? item.adsetName, item.adId ?? item.adName, creativeKey].map((x) => x ?? "").join("|"));
    } catch (e) {
      if (e instanceof RowError) issues.push({ line: row.line, field: e.field, message: e.message });
      else throw e;
    }
  }
  const keys = occurrenceKeys(ids);
  return { items: pending.map((p, i) => ({ ...p, identity: keys[i] })), issues, warnings, skippedZero };
}
