/**
 * Which MDM orders the sync brings in, by the MDM products in them. Each MDM product is brought
 * in or not, from a day on or from the start; products nobody picked yet follow the workspace's
 * choice for new products. Orders already in the app keep updating whatever the choice.
 */
export type ProductRule = { bring: boolean; since: Date | null };
export type ProductChoices = { bringNew: boolean; rules: Map<string, ProductRule> };

/** An MDM order line's product: the product a variant belongs to, else the line's own product ID. */
export const mdmProductIdOf = (l: { ref: string | null; variantOf: string | null }) => (l.variantOf ?? l.ref)?.trim().slice(0, 100) || null;

export const ruleFor = (c: ProductChoices, mdmProductId: string): ProductRule => c.rules.get(mdmProductId) ?? { bring: c.bringNew, since: null };

/** Every order is brought in: nothing was turned off and no product starts from a later day. */
export const bringsEverything = (c: ProductChoices) => c.bringNew && [...c.rules.values()].every((r) => r.bring && !r.since);

/**
 * An order is brought in when one of its MDM products is, and the order was placed on or after
 * that product's first day. An order without MDM product IDs always is: there is nothing to pick by.
 */
export function orderBrought(c: ProductChoices, mdmProductIds: (string | null)[], placedAt: Date): boolean {
  const ids = mdmProductIds.filter((id): id is string => !!id);
  if (!ids.length) return true;
  return ids.some((id) => {
    const r = ruleFor(c, id);
    return r.bring && (!r.since || placedAt.getTime() >= r.since.getTime());
  });
}

/** Going from `before` to `after` brings in orders the sync skipped so far (so they must be read again). */
export function widens(before: ProductRule, after: ProductRule): boolean {
  if (!after.bring) return false;
  if (!before.bring) return true;
  return !!before.since && (!after.since || after.since.getTime() < before.since.getTime());
}
