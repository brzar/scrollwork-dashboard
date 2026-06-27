/**
 * Revenue-share constants for Scrollwork.
 *
 *   creator_revenue  → what the show earns from the provider
 *   gross_share      → our cut before paying partners (30% of creator revenue)
 *   partner_fee      → what we pay our partners (20% of gross_share)
 *   net_take         → what the company keeps (80% of gross_share)
 *   per_founder      → each founder's personal slice (50% of net_take)
 *
 * Equivalent end-to-end for one founder:
 *   per_founder = creator_revenue × GROSS_SHARE_PCT × (1 − PARTNER_FEE_PCT) × FOUNDER_SHARE_PCT
 *
 * Edit these constants when contracts change.
 */

export const GROSS_SHARE_PCT = 0.30;      // Scrollwork's cut of creator revenue.
export const CREATOR_SHARE_PCT = 1 - GROSS_SHARE_PCT;  // 70% — the creator's take.
export const PARTNER_FEE_PCT = 0.20;      // Slice of our cut that goes to partners.
export const FOUNDER_SHARE_PCT = 0.5;     // Each founder's slice of company net.

export const FOUNDER_COUNT = Math.round(1 / FOUNDER_SHARE_PCT); // 2 with 50% split

export type RevenueSplit = {
  creator: number;
  gross: number;
  partnerFee: number;
  net: number;
  perFounder: number;
};

/**
 * Split using custom per-podcast percentages. `grossSharePct` and
 * `partnerFeePct` are fractions in [0, 1]. Founder share stays global
 * (it's how company net divides between founders, not a deal term).
 */
export function splitRevenueWith(
  creatorRevenue: number,
  grossSharePct: number,
  partnerFeePct: number,
): RevenueSplit {
  const gross = creatorRevenue * grossSharePct;
  const partnerFee = gross * partnerFeePct;
  const net = gross - partnerFee;
  const perFounder = net * FOUNDER_SHARE_PCT;
  return { creator: creatorRevenue, gross, partnerFee, net, perFounder };
}

/** Split using the global default percentages. */
export function splitRevenue(creatorRevenue: number): RevenueSplit {
  return splitRevenueWith(creatorRevenue, GROSS_SHARE_PCT, PARTNER_FEE_PCT);
}
