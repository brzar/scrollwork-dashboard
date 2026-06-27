import "server-only";
import { createAdminClient } from "./supabase/admin";
import { createClient as createServerSupabase } from "./supabase/server";
import {
  fetchDelivery,
  fetchEarnings,
  type DeliveryPoint,
  type EarningsPoint,
} from "./megaphone-web";
import { isoDate } from "./date-ranges";
import { subDays, subMonths, startOfMonth, endOfMonth, format } from "date-fns";

/**
 * Cached-metric layer.
 *
 * Reads on the dashboard go through Supabase (`cached_metric` table),
 * which makes pages fast and respects RLS — the user only sees rows for
 * podcasts they have access to.
 *
 * Writes happen via syncMetrics(): one Megaphone delivery call + one
 * earnings call per podcast in the network. Each row is upserted by
 * (podcast_id, metric, granularity, bucket_start) so re-syncing is
 * idempotent.
 *
 * Sync is triggered manually from the admin UI (Sync metrics button),
 * and can be wired to a cron in production (Vercel Cron / external
 * scheduler) by POSTing to /api/admin/sync-metrics with CRON_SECRET.
 */

// How far back each sync pulls. Older rows aren't deleted; they
// accumulate so longer date-range views ("All time") work over time.
const DELIVERY_LOOKBACK_DAYS = 365;
const EARNINGS_LOOKBACK_MONTHS = 24;

export type SyncResult = {
  podcasts: number;
  deliveryRows: number;
  earningsRows: number;
  failures: Array<{ megaphoneId: string; reason: string }>;
};

/**
 * Pull recent metrics for every podcast and upsert into cached_metric.
 * Service-role write — RLS doesn't apply.
 */
export async function syncMetrics(now: Date = new Date()): Promise<SyncResult> {
  const supabase = createAdminClient();

  const { data: podcasts, error } = await supabase
    .from("podcast")
    .select("id, megaphone_id")
    .eq("active", true);
  if (error) throw new Error(`Failed to list podcasts: ${error.message}`);

  const result: SyncResult = {
    podcasts: 0,
    deliveryRows: 0,
    earningsRows: 0,
    failures: [],
  };

  const deliveryStart = isoDate(subDays(now, DELIVERY_LOOKBACK_DAYS));
  const deliveryEnd = isoDate(now);
  const earningsStart = isoDate(
    startOfMonth(subMonths(now, EARNINGS_LOOKBACK_MONTHS - 1)),
  );
  const earningsEnd = isoDate(endOfMonth(now));

  // Fan out in parallel — Megaphone tolerates concurrent reads from one
  // session. 9 podcasts × 2 calls = 18 requests, well within limits.
  await Promise.all(
    (podcasts ?? []).map(async (p) => {
      result.podcasts += 1;
      const [dl, er] = await Promise.allSettled([
        fetchDelivery({ start: deliveryStart, end: deliveryEnd, podcastIds: [p.megaphone_id] }),
        fetchEarnings({ start: earningsStart, end: earningsEnd, granularity: "month", podcastIds: [p.megaphone_id] }),
      ]);

      if (dl.status === "fulfilled") {
        const rows = dl.value.map((point) => deliveryRow(p.id, point));
        if (rows.length > 0) {
          const { error: e } = await supabase
            .from("cached_metric")
            .upsert(rows, { onConflict: "podcast_id,metric,granularity,bucket_start" });
          if (e) {
            result.failures.push({ megaphoneId: p.megaphone_id, reason: `delivery upsert: ${e.message}` });
          } else {
            result.deliveryRows += rows.length;
          }
        }
      } else {
        result.failures.push({ megaphoneId: p.megaphone_id, reason: `delivery: ${stringifyErr(dl.reason)}` });
      }

      if (er.status === "fulfilled") {
        const rows = er.value.map((point) => earningsRow(p.id, point));
        if (rows.length > 0) {
          const { error: e } = await supabase
            .from("cached_metric")
            .upsert(rows, { onConflict: "podcast_id,metric,granularity,bucket_start" });
          if (e) {
            result.failures.push({ megaphoneId: p.megaphone_id, reason: `earnings upsert: ${e.message}` });
          } else {
            result.earningsRows += rows.length;
          }
        }
      } else {
        result.failures.push({ megaphoneId: p.megaphone_id, reason: `earnings: ${stringifyErr(er.reason)}` });
      }
    }),
  );

  return result;
}

function deliveryRow(podcastId: string, p: DeliveryPoint) {
  return {
    podcast_id: podcastId,
    metric: "delivery",
    granularity: "day" as const,
    bucket_start: p.date,
    bucket_end: p.date,
    value: {
      totalDownloads: p.totalDownloads,
      totalStreams: p.totalStreams,
      totalStarts: p.totalStarts,
      totalDelivery: p.totalDelivery,
      totalSaiStarts: p.totalSaiStarts,
    },
    fetched_at: new Date().toISOString(),
  };
}

function earningsRow(podcastId: string, p: EarningsPoint) {
  const start = p.date; // already first-of-month
  const d = new Date(start);
  const end = format(endOfMonth(d), "yyyy-MM-dd");
  return {
    podcast_id: podcastId,
    metric: "earnings",
    granularity: "month" as const,
    bucket_start: start,
    bucket_end: end,
    value: {
      total: p.total,
      span: p.span,
      pvr: p.pvr,
      totalEstimated: p.totalEstimated,
      spanEstimated: p.spanEstimated,
      pvrEstimated: p.pvrEstimated,
    },
    fetched_at: new Date().toISOString(),
  };
}

function stringifyErr(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

// ---- Read path ----------------------------------------------------------

/**
 * Fetch all rows from a PostgREST query, paginating in 1000-row pages.
 * Supabase enforces a server-side "Max Rows" cap (default 1000) that
 * overrides `.limit()`, so larger result sets have to come in pages.
 *
 * `buildQuery` is a thunk so each page builds a fresh query — necessary
 * because `.range()` mutates the builder.
 */
async function fetchAllPaginated<T = any>(
  buildQuery: () => any,
  pageSize = 1000,
  hardCap = 100_000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < hardCap; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await buildQuery().range(from, to);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < pageSize) break;
  }
  return out;
}

export type CacheStatus = {
  /** True if at least one row exists across the queried podcasts. */
  hasData: boolean;
  /** Latest fetched_at across all queried rows. null when empty. */
  lastFetched: Date | null;
  /** True if lastFetched is older than this threshold (default 6 hours). */
  stale: boolean;
};

const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

/**
 * Read cached delivery rows for the given podcast UUIDs (Supabase IDs,
 * not Megaphone IDs) in the [fromIso, toIso] range. Uses the request-
 * scoped Supabase client so RLS applies — a creator/viewer only sees
 * rows for podcasts they're assigned to.
 */
export async function readCachedDelivery(
  podcastIds: string[],
  fromIso: string,
  toIso: string,
): Promise<{ rows: Array<{ podcastId: string; date: string; value: any }>; status: CacheStatus }> {
  if (podcastIds.length === 0) {
    return { rows: [], status: { hasData: false, lastFetched: null, stale: false } };
  }
  const supabase = createServerSupabase();
  const data = await fetchAllPaginated<{ podcast_id: string; bucket_start: string; value: any; fetched_at: any }>(
    () =>
      supabase
        .from("cached_metric")
        .select("podcast_id, bucket_start, value, fetched_at")
        .in("podcast_id", podcastIds)
        .eq("metric", "delivery")
        .eq("granularity", "day")
        .gte("bucket_start", fromIso)
        .lte("bucket_start", toIso)
        .order("bucket_start", { ascending: true }),
  );

  return {
    rows: data.map((r) => ({
      podcastId: r.podcast_id,
      date: String(r.bucket_start),
      value: r.value,
    })),
    status: computeStatus(data),
  };
}

/**
 * Read cached monthly earnings rows. Same RLS-respects-access guarantee.
 */
export async function readCachedEarnings(
  podcastIds: string[],
  fromIso: string,
  toIso: string,
): Promise<{ rows: Array<{ podcastId: string; date: string; value: any }>; status: CacheStatus }> {
  if (podcastIds.length === 0) {
    return { rows: [], status: { hasData: false, lastFetched: null, stale: false } };
  }
  const supabase = createServerSupabase();
  const data = await fetchAllPaginated<{ podcast_id: string; bucket_start: string; value: any; fetched_at: any }>(
    () =>
      supabase
        .from("cached_metric")
        .select("podcast_id, bucket_start, value, fetched_at")
        .in("podcast_id", podcastIds)
        .eq("metric", "earnings")
        .eq("granularity", "month")
        .gte("bucket_start", fromIso)
        .lte("bucket_start", toIso)
        .order("bucket_start", { ascending: true }),
  );

  return {
    rows: data.map((r) => ({
      podcastId: r.podcast_id,
      date: String(r.bucket_start),
      value: r.value,
    })),
    status: computeStatus(data),
  };
}

function computeStatus(rows: Array<{ fetched_at?: any }>): CacheStatus {
  if (rows.length === 0) {
    return { hasData: false, lastFetched: null, stale: false };
  }
  let latest = 0;
  for (const r of rows) {
    const t = r.fetched_at ? new Date(r.fetched_at).getTime() : 0;
    if (t > latest) latest = t;
  }
  const lastFetched = latest ? new Date(latest) : null;
  const stale = !lastFetched || Date.now() - lastFetched.getTime() > STALE_AFTER_MS;
  return { hasData: true, lastFetched, stale };
}
