import type { ImportKind } from "@prisma/client";
import { msg } from "@/i18n/core";

/** `label` and `hint` are English shown through `t()`; `synonyms` are column names as they appear in files. */
export type FieldDef = { key: string; label: string; required?: boolean; synonyms: string[]; hint?: string };

const f = (key: string, label: string, synonyms: string[], extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, synonyms, ...extra });

export const IMPORT_FIELDS: Record<ImportKind, FieldDef[]> = {
  ORDERS: [
    f("orderNumber", msg("Order number"), ["name", "order number", "order #", "order no", "order", "order_number", "numero de commande", "numéro de commande", "commande", "n° commande", "reference", "référence"], { required: true }),
    f("externalOrderId", msg("Order ID"), ["id", "order id", "order_id", "shopify id", "easysell id"], { hint: msg("Stable ID from the store. Defaults to the order number.") }),
    f("placedAt", msg("Created date"), ["created at", "created_at", "date", "order date", "date de commande", "created", "placed at"], { required: true }),
    f("sku", msg("SKU"), ["lineitem sku", "sku", "product sku", "variant sku", "référence produit"]),
    f("productName", msg("Product"), ["lineitem name", "product", "product name", "produit", "item", "title"]),
    f("quantity", msg("Quantity"), ["lineitem quantity", "quantity", "qty", "quantité", "qte"]),
    f("unitPrice", msg("Unit sale price"), ["lineitem price", "price", "unit price", "prix", "prix unitaire"]),
    f("total", msg("Order total (COD)"), ["total", "order total", "cod", "cod amount", "montant", "total price", "amount"], { hint: msg("Defaults to quantity × unit price.") }),
    f("currency", msg("Currency"), ["currency", "devise"]),
    f("status", msg("Order status"), ["status", "order status", "statut", "confirmation status", "état"], { hint: msg("confirmed / pending / canceled (FR accepted).") }),
    f("customerId", msg("Customer identifier"), ["customer id", "customer", "client id", "customer email"], { hint: msg("Hashed before storage.") }),
    f("phone", msg("Phone"), ["phone", "billing phone", "shipping phone", "téléphone", "telephone", "tel", "mobile"], { hint: msg("Stored only as a salted hash and a mask.") }),
    f("wilaya", msg("Wilaya / state"), ["wilaya", "shipping province", "province", "state", "billing province", "region", "shipping province name"]),
    f("city", msg("City"), ["city", "shipping city", "commune", "ville", "billing city"]),
    f("utmSource", msg("UTM source"), ["utm_source", "utm source"]),
    f("utmMedium", msg("UTM medium"), ["utm_medium", "utm medium"]),
    f("utmCampaign", msg("UTM campaign"), ["utm_campaign", "utm campaign", "campaign"]),
    f("utmContent", msg("UTM content (creative ID)"), ["utm_content", "utm content", "ad id", "creative id"]),
    f("landingUrl", msg("Landing URL"), ["landing site", "landing url", "landing page", "referring site", "url"], { hint: msg("UTM parameters are read from it when the UTM columns are empty.") }),
    f("tags", msg("Tags"), ["tags", "order tags", "étiquettes"]),
    f("notes", msg("Notes / attributes"), ["notes", "note", "note attributes", "comment", "commentaire"]),
    f("callAttempts", msg("Call attempts"), ["call attempts", "attempts", "tentatives", "calls"]),
  ],
  AD_SPEND: [
    f("date", msg("Date"), ["day", "date", "reporting starts", "reporting start", "date start"], { required: true }),
    f("campaignName", msg("Campaign name"), ["campaign name", "campaign"]),
    f("campaignId", msg("Campaign ID"), ["campaign id"]),
    f("adsetName", msg("Ad set name"), ["ad set name", "adset name", "ad set"]),
    f("adsetId", msg("Ad set ID"), ["ad set id", "adset id"]),
    f("adName", msg("Ad name"), ["ad name", "ad"]),
    f("adId", msg("Ad ID"), ["ad id"]),
    f("creativeId", msg("Creative / content ID"), ["creative id", "ad creative id", "content id", "utm_content", "creative"], { hint: msg("Must match the utm_content on your orders. Falls back to ad ID, then ad name.") }),
    f("spend", msg("Amount spent"), ["amount spent", "amount spent (usd)", "amount spent (dzd)", "amount spent (eur)", "spend", "cost", "dépenses", "montant dépensé"], { required: true }),
    f("currency", msg("Currency"), ["currency", "devise"]),
    f("impressions", msg("Impressions"), ["impressions"]),
    f("clicks", msg("Clicks"), ["link clicks", "clicks (all)", "clicks", "clics"]),
  ],
  EXPENSES: [
    f("date", msg("Date"), ["date", "day", "paid at", "payment date"], { required: true }),
    f("category", msg("Category"), ["category", "catégorie", "type"], { required: true }),
    f("amount", msg("Amount"), ["amount", "montant", "cost", "total"], { required: true }),
    f("currency", msg("Currency"), ["currency", "devise"]),
    f("description", msg("Description"), ["description", "label", "libellé", "memo", "note"]),
    f("productSku", msg("Product SKU (product-specific)"), ["sku", "product sku", "product"], { hint: msg("Leave empty for global expenses.") }),
    f("costType", msg("Fixed / variable"), ["cost type", "fixed/variable", "nature"]),
  ],
  BANK: [
    f("date", msg("Date"), ["date", "booking date", "value date", "date opération", "date operation"], { required: true }),
    f("description", msg("Description"), ["description", "label", "libellé", "details", "narrative"]),
    f("amount", msg("Amount (signed)"), ["amount", "montant"], { hint: msg("Or map debit and credit separately.") }),
    f("debit", msg("Debit"), ["debit", "débit", "withdrawal"]),
    f("credit", msg("Credit"), ["credit", "crédit", "deposit"]),
    f("currency", msg("Currency"), ["currency", "devise"]),
    f("reference", msg("Reference"), ["reference", "référence", "transaction id", "id"]),
  ],
};

const canon = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim();

/** Suggest a column for each field: exact synonym match first, then prefix match. Each column is used once. */
export function suggestMapping(kind: ImportKind, headers: readonly string[]): Record<string, string | null> {
  const used = new Set<string>();
  const out: Record<string, string | null> = {};
  const byCanon = headers.map((h) => ({ h, c: canon(h) }));
  for (const field of IMPORT_FIELDS[kind]) {
    const syns = field.synonyms.map(canon);
    const exact = byCanon.find((x) => !used.has(x.h) && syns.includes(x.c));
    const loose = exact ?? byCanon.find((x) => !used.has(x.h) && syns.some((s) => s.length > 6 && x.c.startsWith(s)));
    out[field.key] = loose?.h ?? null;
    if (loose) used.add(loose.h);
  }
  return out;
}

export function missingRequired(kind: ImportKind, mapping: Record<string, string | null | undefined>): string[] {
  const missing = IMPORT_FIELDS[kind].filter((fd) => fd.required && !mapping[fd.key]).map((fd) => fd.label);
  if (kind === "BANK" && !mapping.amount && !(mapping.debit || mapping.credit)) missing.push(msg("Amount or Debit/Credit"));
  return missing;
}
