/**
 * Offers: how many pieces one order sends. A product's sale price is the price of one whole order,
 * so with "buy 1, get 1 free" the customer pays the price once and two pieces leave the stock.
 */
import { englishT, msg, type TFunction } from "@/i18n/core";

export const MAX_PIECES_PER_ORDER = 20;

/** The offers to pick from. `pieces` is what one order sends. */
export const OFFER_PRESETS = [
  { pieces: 1, label: msg("No offer"), detail: msg("1 piece per order") },
  { pieces: 2, label: msg("Buy 1, get 1 free"), detail: msg("2 pieces per order") },
  { pieces: 3, label: msg("Buy 2, get 1 free"), detail: msg("3 pieces per order") },
  { pieces: 4, label: msg("Buy 2, get 2 free"), detail: msg("4 pieces per order") },
] as const;

/** A short name for an offer: the preset's, else the number of pieces. `t` translates it. */
export function offerLabel(pieces: number, t: TFunction = englishT): string {
  const preset = OFFER_PRESETS.find((p) => p.pieces === pieces);
  return preset ? t(preset.label) : t("{n} pieces per order", { n: pieces });
}

/**
 * Pieces an order line really sends. Stores and MDM don't always list the free pieces: when the
 * line lists fewer pieces than the offer sends, the offer's count is used; when it lists as many
 * or more (the free ones included, or several offers), the line's own count is.
 */
export function piecesSent(quantity: number, piecesPerOrder: number): number {
  return Math.max(quantity, piecesPerOrder);
}

/**
 * An order's lines with each product's free pieces added: a product's lines are counted together
 * (a free piece can come as its own line), and what the offer adds goes on its first line.
 */
export function linesWithOffers<L extends { productId: string | null; quantity: number }>(lines: readonly L[], piecesOf: (productId: string) => number): L[] {
  const listed = new Map<string, number>();
  for (const l of lines) if (l.productId) listed.set(l.productId, (listed.get(l.productId) ?? 0) + l.quantity);
  const done = new Set<string>();
  return lines.map((l) => {
    if (!l.productId || done.has(l.productId)) return l;
    done.add(l.productId);
    const total = listed.get(l.productId)!;
    const extra = piecesSent(total, piecesOf(l.productId)) - total;
    return extra > 0 ? { ...l, quantity: l.quantity + extra } : l;
  });
}
