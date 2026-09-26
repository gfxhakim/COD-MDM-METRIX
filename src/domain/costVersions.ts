/** Pure helpers for immutable product cost versions. */

export type CostVersionLike = {
  id: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
};

/** The version in effect at `at`: effectiveFrom <= at < effectiveTo (open-ended when effectiveTo is null). */
export function selectCostVersion<T extends CostVersionLike>(versions: readonly T[], at: Date): T | null {
  let best: T | null = null;
  for (const v of versions) {
    if (v.effectiveFrom <= at && (v.effectiveTo === null || at < v.effectiveTo)) {
      if (!best || v.effectiveFrom > best.effectiveFrom) best = v;
    }
  }
  return best;
}

export class CostVersionError extends Error {}

/**
 * Validate adding a version starting at `effectiveFrom`. History is append-only:
 * the new version must start after the latest existing one, which is then closed.
 * Returns the id of the version to close (if any).
 */
export function planNewCostVersion(versions: readonly CostVersionLike[], effectiveFrom: Date): { closeId: string | null } {
  if (versions.length === 0) return { closeId: null };
  const latest = versions.reduce((a, b) => (b.effectiveFrom > a.effectiveFrom ? b : a));
  if (effectiveFrom <= latest.effectiveFrom) {
    throw new CostVersionError(
      `New cost version must start after ${latest.effectiveFrom.toISOString().slice(0, 10)} (the latest version). Historical versions are never overwritten.`,
    );
  }
  return { closeId: latest.id };
}
