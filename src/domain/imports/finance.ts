import type { CostType, ExpenseCategory } from "@prisma/client";
import { convertMinor } from "@/lib/money";
import type { ParsedCsv } from "./csv";
import { cell, currencyOf, money, occurrenceKeys, RowError, type Mapping, type RowIssue } from "./common";
import { parseDate, type DateFormat } from "./dates";

const CATEGORY_WORDS: [RegExp, ExpenseCategory][] = [
  [/^(ai|ai tools?|outils? ia|ia|chatgpt|openai|midjourney)/i, "AI_TOOLS"],
  [/^(software|saas|logiciels?|subscriptions?|abonnements?|shopify|apps?)/i, "SOFTWARE"],
  [/^(office|bureau|rent|loyer|coworking)/i, "OFFICE"],
  [/^(domains?|proxy|proxies|domains?\s*\/\s*proxies|hosting|hébergement)/i, "DOMAINS_PROXIES"],
  [/^(bank|bank fees|frais bancaires?|frais)/i, "BANK_FEES"],
  [/^(call ?cent(er|re)|centre d'appels?|confirmation|confirmatrices?)/i, "CALL_CENTER"],
  [/^(packaging|emballages?|cartons?)/i, "PACKAGING"],
  [/^(warehouse|entrep[oô]ts?|stock(age)?|storage)/i, "WAREHOUSE"],
  [/^(my pay|owner('?s)?( pay| salary| draws?)?|drawings?|ma paie|mon salaire|g[ée]rant)/i, "OWNER_PAY"],
  [/^(salar(y|ies)|salaires?|wages?|payroll|staff|employ(ee|é)s?( pay)?)/i, "SALARIES"],
  [/^(other ads|tiktok|google ads|snapchat|influenc(er|eur)s?)/i, "OTHER_ADS"],
  [/^(content|contenus?|ugc|shooting|montage|video editing)/i, "CONTENT"],
  [/^(transport|fuel|carburant|essence|taxi)/i, "TRANSPORT"],
  [/^(tax(es)?|imp[oô]ts?|tva|vat)/i, "TAXES"],
  [/^(other|autres?|misc|divers)/i, "OTHER"],
];

export function parseCategory(raw: string): { category: ExpenseCategory; recognized: boolean } {
  const v = raw.trim().replace(/_/g, " ");
  const exact = v.toUpperCase().replace(/[\s/]+/g, "_");
  const direct = CATEGORY_WORDS.find(([, c]) => c === exact);
  if (direct) return { category: direct[1], recognized: true };
  const hit = CATEGORY_WORDS.find(([re]) => new RegExp(`${re.source}(?![a-z])`, "i").test(v));
  return hit ? { category: hit[1], recognized: true } : { category: "OTHER", recognized: false };
}

export function parseCostType(raw: string): CostType {
  return /^(var|variable)/i.test(raw.trim()) ? "VARIABLE" : "FIXED";
}

export type ImportedExpense = {
  line: number;
  date: Date;
  category: ExpenseCategory;
  /** In the workspace currency. */
  amount: number;
  /** Set when the row was in another currency, converted with the workspace's rate from Settings. */
  originalAmount: number | null;
  originalCurrency: string | null;
  fxRate: number | null;
  description: string | null;
  productId: string | null;
  costType: CostType;
  identity: string;
};

export function validateExpenses(
  csv: ParsedCsv,
  mapping: Mapping,
  opts: { dateFormat: Exclude<DateFormat, "AUTO">; currency: string; products: readonly { id: string; sku: string }[]; rates?: Partial<Record<string, number>> },
) {
  const bySku = new Map(opts.products.map((p) => [p.sku.toLowerCase(), p.id]));
  const issues: RowIssue[] = [];
  const warnings: RowIssue[] = [];
  const pending: Omit<ImportedExpense, "identity">[] = [];
  const ids: string[] = [];
  for (const row of csv.rows) {
    try {
      const dateRaw = cell(row, mapping, "date");
      const date = parseDate(dateRaw, opts.dateFormat);
      if (!date) throw new RowError("date", dateRaw ? `Invalid date "${dateRaw}"` : "Missing date");
      const currency = currencyOf(cell(row, mapping, "currency"), opts.currency);
      const fxRate = currency === opts.currency ? null : opts.rates?.[currency] ?? null;
      if (currency !== opts.currency && !fxRate) throw new RowError("currency", `Expense is in ${currency}; set a ${currency} exchange rate in Settings → Economics & currencies first`);
      const amountRaw = cell(row, mapping, "amount");
      if (!amountRaw) throw new RowError("amount", "Missing amount");
      const original = money(amountRaw, currency, "amount");
      if (original === 0) throw new RowError("amount", "Amount is zero");
      const amount = fxRate ? convertMinor(original, currency, opts.currency, fxRate) : original;
      const catRaw = cell(row, mapping, "category");
      const { category, recognized } = parseCategory(catRaw);
      if (!recognized) warnings.push({ line: row.line, field: "category", message: `Unknown category "${catRaw}" imported as Other` });
      const sku = cell(row, mapping, "productSku");
      const productId = sku ? bySku.get(sku.toLowerCase()) ?? null : null;
      if (sku && !productId) throw new RowError("productSku", `Unknown product SKU "${sku}"`);
      const description = cell(row, mapping, "description") || null;
      pending.push({
        line: row.line, date, category, amount, description, productId, costType: parseCostType(cell(row, mapping, "costType")),
        originalAmount: fxRate ? original : null, originalCurrency: fxRate ? currency : null, fxRate,
      });
      // Foreign rows are identified by what the file says, so a new rate doesn't make a re-import look new.
      ids.push([date.toISOString().slice(0, 10), category, fxRate ? `${original}${currency}` : amount, description ?? "", sku.toLowerCase()].join("|"));
    } catch (e) {
      if (e instanceof RowError) issues.push({ line: row.line, field: e.field, message: e.message });
      else throw e;
    }
  }
  const keys = occurrenceKeys(ids);
  return { items: pending.map((p, i) => ({ ...p, identity: keys[i] })), issues, warnings };
}

export type ImportedBankRow = { line: number; date: Date; description: string | null; amount: number; reference: string | null; identity: string };

export function validateBank(csv: ParsedCsv, mapping: Mapping, opts: { dateFormat: Exclude<DateFormat, "AUTO">; currency: string }) {
  const issues: RowIssue[] = [];
  const pending: Omit<ImportedBankRow, "identity">[] = [];
  const ids: string[] = [];
  for (const row of csv.rows) {
    try {
      const dateRaw = cell(row, mapping, "date");
      const date = parseDate(dateRaw, opts.dateFormat);
      if (!date) throw new RowError("date", dateRaw ? `Invalid date "${dateRaw}"` : "Missing date");
      const currency = currencyOf(cell(row, mapping, "currency"), opts.currency);
      if (currency !== opts.currency) throw new RowError("currency", `Row is in ${currency}; this workspace uses ${opts.currency}`);
      let amount: number;
      const amountRaw = cell(row, mapping, "amount");
      if (amountRaw) amount = money(amountRaw, currency, "amount", { allowNegative: true });
      else {
        const debit = cell(row, mapping, "debit");
        const credit = cell(row, mapping, "credit");
        if (!debit && !credit) throw new RowError("amount", "Missing amount");
        amount = (credit ? money(credit, currency, "credit", { allowNegative: true }) : 0) - (debit ? Math.abs(money(debit, currency, "debit", { allowNegative: true })) : 0);
      }
      if (amount === 0) throw new RowError("amount", "Amount is zero");
      const description = cell(row, mapping, "description") || null;
      const reference = cell(row, mapping, "reference") || null;
      pending.push({ line: row.line, date, description, amount, reference });
      ids.push([date.toISOString().slice(0, 10), amount, description ?? "", reference ?? ""].join("|"));
    } catch (e) {
      if (e instanceof RowError) issues.push({ line: row.line, field: e.field, message: e.message });
      else throw e;
    }
  }
  const keys = occurrenceKeys(ids);
  return { items: pending.map((p, i) => ({ ...p, identity: keys[i] })), issues, warnings: [] as RowIssue[] };
}
