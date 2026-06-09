import "server-only";
import { createClient } from "./supabase/server";
import {
  startOfMonth,
  endOfMonth,
  subMonths,
  format,
  parseISO,
  isAfter,
} from "date-fns";
import { isoDate } from "./date-ranges";

/**
 * Per-podcast CPM estimation.
 *
 * Megaphone confirms monthly revenue at the end of each cycle. We estimate
 * revenue for unfinalized days by computing each podcast's own CPM from
 * its trailing finalized months and applying it to recent daily delivery.
 *
 * For each podcast:
 *   1. Pull the last N **finalized** months where total > 0.
 *   2. Compute that podcast's blended CPM:
 *        cpm = sum(confirmed_revenue) / (sum(delivery) / 1000)
 *   3. For each recent day, estimated_revenue = (delivery / 1000) × cpm.
 *
 * Podcasts with no confirmed revenue history return cpm = null. Callers
 * can choose to fall back to the org-wide CPM (we expose that via
 * computeOrgCpm) or render "—".
 */

const BLEND_MONTHS = 3;

export type CpmModel = {
  /** Blended CPM in dollars per 1k delivered. Null when no eligible months. */
  cpm: number | null;
  /** The (start-of-month) ISO dates that fed the blend. */
  monthsUsed: string[];
  /** Sum of confirmed revenue across the blended months. */
  totalRevenue: number;
  /** Sum of delivery across the blended months. */
  totalDelivery: number;
};

const EMPTY_MODEL: CpmModel = {
  cpm: null,
  monthsUsed: [],
  totalRevenue: 0,
  totalDelivery: 0,
};

type Row = {
  podcast_id: string;
  bucket_start: string;
  value: any;
};

/**
 * Compute a per-podcast CPM map. Reads via SSR client so RLS scopes the
 * result to podcasts the caller can see.
 *
 * The map is keyed by podcast UUID. Podcasts present in `podcastIds` but
 * with no confirmed revenue history return EMPTY_MODEL — never undefined,
 * so callers don't have to special-case.
 */
export async function computeCpmByPodcast(
  podcastIds: string[],
  now: Date = new Date(),
): Promise<Map<string, CpmModel>> {
  const out = new Map<string, CpmModel>();
  for (const id of podcastIds) out.set(id, EMPTY_MODEL);
  if (podcastIds.length === 0) return out;

  const supabase = createClient();

  // Look back further than BLEND_MONTHS so we can skip months without
  // confirmed dollars. Never include the current month.
  const earliest = isoDate(startOfMonth(subMonths(now, BLEND_MONTHS + 6)));
  const latest = isoDate(endOfMonth(subMonths(now, 1)));

  // Supabase has a server-side max-rows cap (default 1000) — paginate to
  // pull all the delivery rows. A year × 10 podcasts is ~3,600 rows.
  const fetchAll = async (
    builder: () => any,
    pageSize = 1000,
  ): Promise<Row[]> => {
    const out: Row[] = [];
    for (let from = 0; from < 100_000; from += pageSize) {
      const { data, error } = await builder().range(from, from + pageSize - 1);
      if (error) throw new Error(error.message);
      if (!data?.length) break;
      out.push(...data);
      if (data.length < pageSize) break;
    }
    return out;
  };

  const [earningsData, deliveryData] = await Promise.all([
    fetchAll(() =>
      supabase
        .from("cached_metric")
        .select("podcast_id, bucket_start, value")
        .in("podcast_id", podcastIds)
        .eq("metric", "earnings")
        .eq("granularity", "month")
        .gte("bucket_start", earliest)
        .lte("bucket_start", latest),
    ),
    fetchAll(() =>
      supabase
        .from("cached_metric")
        .select("podcast_id, bucket_start, value")
        .in("podcast_id", podcastIds)
        .eq("metric", "delivery")
        .eq("granularity", "day")
        .gte("bucket_start", earliest)
        .lte("bucket_start", latest),
    ),
  ]);
  const earningsRes = { data: earningsData };
  const deliveryRes = { data: deliveryData };

  // Per-podcast confirmed revenue by month.
  const revByPodMonth = new Map<string, Map<string, number>>();
  for (const r of (earningsRes.data ?? []) as Row[]) {
    const total = Number(r.value?.total ?? 0);
    if (total <= 0) continue;
    const inner = revByPodMonth.get(r.podcast_id) ?? new Map<string, number>();
    inner.set(r.bucket_start, (inner.get(r.bucket_start) ?? 0) + total);
    revByPodMonth.set(r.podcast_id, inner);
  }

  // Per-podcast delivery by month.
  const dlByPodMonth = new Map<string, Map<string, number>>();
  for (const r of (deliveryRes.data ?? []) as Row[]) {
    const monthKey = format(startOfMonth(parseISO(r.bucket_start)), "yyyy-MM-dd");
    const inner = dlByPodMonth.get(r.podcast_id) ?? new Map<string, number>();
    inner.set(
      monthKey,
      (inner.get(monthKey) ?? 0) + Number(r.value?.totalDelivery ?? 0),
    );
    dlByPodMonth.set(r.podcast_id, inner);
  }

  for (const pid of podcastIds) {
    const monthsRev = revByPodMonth.get(pid);
    if (!monthsRev || monthsRev.size === 0) continue;

    // Most-recent BLEND_MONTHS that have confirmed dollars for this podcast.
    const eligibleMonths = Array.from(monthsRev.entries())
      .sort((a, b) => (a[0] > b[0] ? -1 : 1))
      .slice(0, BLEND_MONTHS)
      .map(([m]) => m);
    const dlByMonth = dlByPodMonth.get(pid) ?? new Map<string, number>();

    let totalRevenue = 0;
    let totalDelivery = 0;
    for (const m of eligibleMonths) {
      totalRevenue += monthsRev.get(m) ?? 0;
      totalDelivery += dlByMonth.get(m) ?? 0;
    }

    out.set(pid, {
      cpm: totalDelivery > 0 ? totalRevenue / (totalDelivery / 1000) : null,
      monthsUsed: eligibleMonths,
      totalRevenue,
      totalDelivery,
    });
  }

  return out;
}

/**
 * Org-wide blended CPM — sum of revenue across all included podcasts
 * divided by sum of delivery. Useful as a fallback for podcasts with
 * no individual history, and as a comparison anchor in the UI.
 */
export function computeOrgCpm(cpms: Map<string, CpmModel>): CpmModel {
  let totalRevenue = 0;
  let totalDelivery = 0;
  const months = new Set<string>();
  for (const m of cpms.values()) {
    totalRevenue += m.totalRevenue;
    totalDelivery += m.totalDelivery;
    m.monthsUsed.forEach((x) => months.add(x));
  }
  return {
    cpm: totalDelivery > 0 ? totalRevenue / (totalDelivery / 1000) : null,
    monthsUsed: Array.from(months).sort(),
    totalRevenue,
    totalDelivery,
  };
}

/**
 * Apply a CPM to a delivery count. Returns 0 if the model has no CPM.
 */
export function applyCpm(deliveryCount: number, model: CpmModel): number {
  if (!model.cpm) return 0;
  return (deliveryCount / 1000) * model.cpm;
}

/**
 * Whether a date is after the most-recent finalized month — i.e. needs the
 * CPM estimate. Future-proofing helper; callers can also just look at the
 * date directly.
 */
export function isAfterLastFinalizedMonth(
  date: Date,
  monthsUsed: string[],
): boolean {
  if (monthsUsed.length === 0) return true;
  const latest = monthsUsed.reduce((a, b) => (a > b ? a : b));
  const latestEnd = endOfMonth(parseISO(latest));
  return isAfter(date, latestEnd);
}
