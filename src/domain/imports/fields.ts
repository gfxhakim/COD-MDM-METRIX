import type { ImportKind } from "@prisma/client";

export type FieldDef = { key: string; label: string; required?: boolean; synonyms: string[]; hint?: string };

const f = (key: string, label: string, synonyms: string[], extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, synonyms, ...extra });

export const IMPORT_FIELDS: Record<ImportKind, FieldDef[]> = {
  ORDERS: [
    f("orderNumber", "Order number", ["name", "order number", "order #", "order no", "order", "order_number", "numero de commande", "numéro de commande", "commande", "n° commande", "reference", "référence"], { required: true }),
    f("externalOrderId", "Order ID", ["id", "order id", "order_id", "shopify id", "easysell id"], { hint: "Stable ID from the store. Defaults to the order number." }),
    f("placedAt", "Created date", ["created at", "created_at", "date", "order date", "date de commande", "created", "placed at"], { required: true }),
    f("sku", "SKU", ["lineitem sku", "sku", "product sku", "variant sku", "référence produit"]),
    f("productName", "Product", ["lineitem name", "product", "product name", "produit", "item", "title"]),
    f("quantity", "Quantity", ["lineitem quantity", "quantity", "qty", "quantité", "qte"]),
    f("unitPrice", "Unit sale price", ["lineitem price", "price", "unit price", "prix", "prix unitaire"]),
    f("total", "Order total (COD)", ["total", "order total", "cod", "cod amount", "montant", "total price", "amount"], { hint: "Defaults to quantity × unit price." }),
    f("currency", "Currency", ["currency", "devise"]),
    f("status", "Order status", ["status", "order status", "statut", "confirmation status", "état"], { hint: "confirmed / pending / canceled (FR accepted)." }),
    f("customerId", "Customer identifier", ["customer id", "customer", "client id", "customer email"], { hint: "Hashed before storage." }),
    f("phone", "Phone", ["phone", "billing phone", "shipping phone", "téléphone", "telephone", "tel", "mobile"], { hint: "Stored only as a salted hash and a mask." }),
    f("wilaya", "Wilaya / state", ["wilaya", "shipping province", "province", "state", "billing province", "region", "shipping province name"]),
    f("city", "City", ["city", "shipping city", "commune", "ville", "billing city"]),
    f("utmSource", "UTM source", ["utm_source", "utm source"]),
    f("utmMedium", "UTM medium", ["utm_medium", "utm medium"]),
    f("utmCampaign", "UTM campaign", ["utm_campaign", "utm campaign", "campaign"]),
    f("utmContent", "UTM content (creative ID)", ["utm_content", "utm content", "ad id", "creative id"]),
    f("landingUrl", "Landing URL", ["landing site", "landing url", "landing page", "referring site", "url"], { hint: "UTM parameters are read from it when the UTM columns are empty." }),
    f("tags", "Tags", ["tags", "order tags", "étiquettes"]),
    f("notes", "Notes / attributes", ["notes", "note", "note attributes", "comment", "commentaire"]),
    f("callAttempts", "Call attempts", ["call attempts", "attempts", "tentatives", "calls"]),
  ],
  AD_SPEND: [
    f("date", "Date", ["day", "date", "reporting starts", "reporting start", "date start"], { required: true }),
    f("campaignName", "Campaign name", ["campaign name", "campaign"]),
    f("campaignId", "Campaign ID", ["campaign id"]),
    f("adsetName", "Ad set name", ["ad set name", "adset name", "ad set"]),
    f("adsetId", "Ad set ID", ["ad set id", "adset id"]),
    f("adName", "Ad name", ["ad name", "ad"]),
    f("adId", "Ad ID", ["ad id"]),
    f("creativeId", "Creative / content ID", ["creative id", "ad creative id", "content id", "utm_content", "creative"], { hint: "Must match the utm_content on your orders. Falls back to ad ID, then ad name." }),
    f("spend", "Amount spent", ["amount spent", "amount spent (usd)", "amount spent (dzd)", "amount spent (eur)", "spend", "cost", "dépenses", "montant dépensé"], { required: true }),
    f("currency", "Currency", ["currency", "devise"]),
    f("impressions", "Impressions", ["impressions"]),
    f("clicks", "Clicks", ["link clicks", "clicks (all)", "clicks", "clics"]),
  ],
  EXPENSES: [
    f("date", "Date", ["date", "day", "paid at", "payment date"], { required: true }),
    f("category", "Category", ["category", "catégorie", "type"], { required: true }),
    f("amount", "Amount", ["amount", "montant", "cost", "total"], { required: true }),
    f("currency", "Currency", ["currency", "devise"]),
    f("description", "Description", ["description", "label", "libellé", "memo", "note"]),
    f("productSku", "Product SKU (product-specific)", ["sku", "product sku", "product"], { hint: "Leave empty for global expenses." }),
    f("costType", "Fixed / variable", ["cost type", "fixed/variable", "nature"]),
  ],
  BANK: [
    f("date", "Date", ["date", "booking date", "value date", "date opération", "date operation"], { required: true }),
    f("description", "Description", ["description", "label", "libellé", "details", "narrative"]),
    f("amount", "Amount (signed)", ["amount", "montant"], { hint: "Or map debit and credit separately." }),
    f("debit", "Debit", ["debit", "débit", "withdrawal"]),
    f("credit", "Credit", ["credit", "crédit", "deposit"]),
    f("currency", "Currency", ["currency", "devise"]),
    f("reference", "Reference", ["reference", "référence", "transaction id", "id"]),
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
  if (kind === "BANK" && !mapping.amount && !(mapping.debit || mapping.credit)) missing.push("Amount or Debit/Credit");
  return missing;
}
