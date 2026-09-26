/**
 * Reference normalization used for order ↔ parcel matching and creative keys.
 * Originals are always stored alongside the normalized value.
 */
export function normalizeReference(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/^(ORDER|ORD|CMD|COMMANDE|SHOPIFY|ES|EASYSELL)[\s\-_:#]*/i, "")
    .replace(/[\s#\-_.:/\\]+/g, "")
    .replace(/[^A-Z0-9]/g, "");
}

export function normalizeCreativeKey(input: string | null | undefined): string {
  if (!input) return "";
  return input.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9\-_]/g, "");
}
