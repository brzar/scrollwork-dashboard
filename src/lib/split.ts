/**
 * Revenue-split engine.
 *
 * Each podcast is assigned a split mode (a reusable template) and may
 * override the creator share. For a given revenue R:
 *
 *   portalFee = R × mode.portalFeePct
 *   creator   = R × creatorShare        (podcast override, else mode default)
 *   remaining = R − portalFee − creator
 *   payouts   = each beneficiary gets remaining × their pct
 *
 * Beneficiary pcts are fractions of the remaining and should sum to 1.
 */

/** The owner — whose take the topline cards highlight. */
export const OWNER_NAME = "Jonathan";

export type Beneficiary = { name: string; pct: number };

export type SplitMode = {
  id: string;
  name: string;
  portal: string | null;
  portalFeePct: number;
  defaultCreatorSharePct: number;
  beneficiaries: Beneficiary[];
};

export type SplitResult = {
  portalFee: number;
  creator: number;
  remaining: number;
  /** name → amount */
  payouts: Record<string, number>;
};

/** Parse the jsonb beneficiaries column into a typed, validated array. */
export function parseBeneficiaries(raw: unknown): Beneficiary[] {
  if (!Array.isArray(raw)) return [];
  const out: Beneficiary[] = [];
  for (const b of raw) {
    if (
      b &&
      typeof b === "object" &&
      typeof (b as Beneficiary).name === "string" &&
      typeof (b as Beneficiary).pct === "number"
    ) {
      out.push({ name: (b as Beneficiary).name, pct: (b as Beneficiary).pct });
    }
  }
  return out;
}

/**
 * Compute the split for one revenue figure under a mode.
 *
 * `creatorShareOverride` is a fraction in [0,1] or null/undefined to use
 * the mode's default. Pass 0 explicitly for owned-and-operated shows.
 */
export function computeSplit(
  revenue: number,
  mode: SplitMode,
  creatorShareOverride?: number | null,
): SplitResult {
  const creatorPct =
    creatorShareOverride == null
      ? mode.defaultCreatorSharePct
      : creatorShareOverride;
  const portalFee = revenue * mode.portalFeePct;
  const creator = revenue * creatorPct;
  const remaining = Math.max(0, revenue - portalFee - creator);

  const payouts: Record<string, number> = {};
  for (const b of mode.beneficiaries) {
    payouts[b.name] = (payouts[b.name] ?? 0) + remaining * b.pct;
  }
  return { portalFee, creator, remaining, payouts };
}

/** Effective creator share for a podcast (override wins over mode default). */
export function effectiveCreatorShare(
  mode: SplitMode,
  override?: number | null,
): number {
  return override == null ? mode.defaultCreatorSharePct : override;
}
