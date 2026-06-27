/* eslint-disable no-console */
/**
 * Sync Megaphone metrics (delivery + earnings) into cached_metric.
 *
 *   npm run megaphone:sync-metrics
 *
 * Runs in plain Node (no Next, no serverless time limit), so it handles
 * slow accounts that don't fit Vercel's 60s function cap. It reads the
 * stored web session from Supabase (cookies + CSRF) — no Megaphone API
 * token needed — fetches each podcast's metrics from the private API, and
 * upserts them. Idempotent (upsert by podcast_id, metric, granularity,
 * bucket_start).
 *
 * Designed for GitHub Actions: needs only NEXT_PUBLIC_SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY.
 */

import * as path from "node:path";
import * as dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import {
  subDays,
  subMonths,
  startOfMonth,
  endOfMonth,
  format,
} from "date-fns";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const PRIVATE_BASE = "https://cms.megaphone.fm/api/v2/private";
const DELIVERY_LOOKBACK_DAYS = 365;
const EARNINGS_LOOKBACK_MONTHS = 24;
const CALL_TIMEOUT_MS = 30_000; // generous — no overall function limit here
const CONCURRENCY = 4; // gentle on Megaphone to avoid throttling

const isoDate = (d: Date) => format(d, "yyyy-MM-dd");

type Session = {
  organizationId: string;
  csrfToken: string;
  cookieHeader: string;
};

async function callPrivate<T>(
  pathName: string,
  body: unknown,
  session: Session,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${PRIVATE_BASE}${pathName}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Origin: "https://cms.megaphone.fm",
        Referer: `https://cms.megaphone.fm/organizations/${session.organizationId}/reports/dashboard`,
        "X-CSRF-Token": session.csrfToken,
        Cookie: session.cookieHeader,
      },
      body: JSON.stringify(body),
      redirect: "manual",
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`timed out after ${CALL_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
    throw new Error("session expired (redirected to sign-in)");
  }
  if ([401, 403, 404].includes(res.status)) {
    throw new Error(`session rejected (HTTP ${res.status})`);
  }
  if (!res.ok) throw new Error(`private API ${res.status}`);
  return (await res.json()) as T;
}

const EARNINGS_METRICS = [
  "totalEarningsInDollars",
  "spanEarningsInDollars",
  "pvrEarningsInDollars",
  "totalEstimatedEarningsInDollars",
  "spanEstimatedEarningsInDollars",
  "pvrEstimatedEarningsInDollars",
];

async function fetchDelivery(
  session: Session,
  megaphoneId: string,
  start: string,
  end: string,
): Promise<any[]> {
  const raw = await callPrivate<{ items: any[] }>(
    `/reports/organizations/${session.organizationId}/delivery/global_delivery.json`,
    { start, end, filters: [["podcast_id", [megaphoneId]]], groupBys: ["day"] },
    session,
  );
  return raw.items ?? [];
}

async function fetchEarnings(
  session: Session,
  megaphoneId: string,
  start: string,
  end: string,
): Promise<any[]> {
  const raw = await callPrivate<{ items: any[] }>(
    `/reports/organizations/${session.organizationId}/monetization/earnings.json?intent=earnings-by-month`,
    {
      start,
      end,
      groupBys: ["month"],
      metrics: EARNINGS_METRICS,
      sort: "date",
      sortDirection: "DESC",
      filters: [["podcastId", [megaphoneId]]],
    },
    session,
  );
  return raw.items ?? [];
}

function deliveryRow(podcastId: string, p: any, fetchedAt: string) {
  return {
    podcast_id: podcastId,
    metric: "delivery",
    granularity: "day",
    bucket_start: String(p.date ?? p.day ?? ""),
    bucket_end: String(p.date ?? p.day ?? ""),
    value: {
      totalDownloads: Number(p.totalDownloads ?? 0),
      totalStreams: Number(p.totalStreams ?? 0),
      totalStarts: Number(p.totalStarts ?? 0),
      totalDelivery: Number(p.totalDelivery ?? 0),
      totalSaiStarts: Number(p.totalSaiStarts ?? 0),
    },
    fetched_at: fetchedAt,
  };
}

function earningsRow(podcastId: string, p: any, fetchedAt: string) {
  const start = String(p.date ?? "");
  const end = start ? format(endOfMonth(new Date(start)), "yyyy-MM-dd") : start;
  return {
    podcast_id: podcastId,
    metric: "earnings",
    granularity: "month",
    bucket_start: start,
    bucket_end: end,
    value: {
      total: Number(p.totalEarningsInDollars ?? 0),
      span: Number(p.spanEarningsInDollars ?? 0),
      pvr: Number(p.pvrEarningsInDollars ?? 0),
      totalEstimated: Number(p.totalEstimatedEarningsInDollars ?? 0),
      spanEstimated: Number(p.spanEstimatedEarningsInDollars ?? 0),
      pvrEstimated: Number(p.pvrEstimatedEarningsInDollars ?? 0),
    },
    fetched_at: fetchedAt,
  };
}

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error(
      "ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.",
    );
    process.exit(1);
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: podcasts, error: pErr } = await supabase
    .from("podcast")
    .select("id, megaphone_id, megaphone_account")
    .eq("active", true);
  if (pErr) {
    console.error("✗ Failed to list podcasts:", pErr.message);
    process.exit(2);
  }

  const { data: sessRows, error: sErr } = await supabase
    .from("megaphone_session")
    .select("account, organization_id, csrf_token, cookie_header");
  if (sErr) {
    console.error("✗ Failed to read sessions:", sErr.message);
    process.exit(2);
  }
  const sessions = new Map<string, Session>();
  for (const s of sessRows ?? []) {
    if (s.organization_id && s.csrf_token && s.cookie_header) {
      sessions.set(s.account ?? "primary", {
        organizationId: s.organization_id,
        csrfToken: s.csrf_token,
        cookieHeader: s.cookie_header,
      });
    }
  }

  const now = new Date();
  const deliveryStart = isoDate(subDays(now, DELIVERY_LOOKBACK_DAYS));
  const deliveryEnd = isoDate(now);
  const earningsStart = isoDate(
    startOfMonth(subMonths(now, EARNINGS_LOOKBACK_MONTHS - 1)),
  );
  const earningsEnd = isoDate(endOfMonth(now));
  const fetchedAt = now.toISOString();

  const list = podcasts ?? [];
  let deliveryRows = 0;
  let earningsRows = 0;
  const failures: string[] = [];

  let cursor = 0;
  async function worker() {
    while (cursor < list.length) {
      const p = list[cursor++];
      const account = p.megaphone_account || "primary";
      const session = sessions.get(account);
      if (!session) {
        failures.push(`${p.megaphone_id}: no session for account "${account}"`);
        continue;
      }
      try {
        const dl = await fetchDelivery(
          session,
          p.megaphone_id,
          deliveryStart,
          deliveryEnd,
        );
        const drows = dl.map((pt) => deliveryRow(p.id, pt, fetchedAt));
        if (drows.length) {
          const { error } = await supabase
            .from("cached_metric")
            .upsert(drows, {
              onConflict: "podcast_id,metric,granularity,bucket_start",
            });
          if (error) failures.push(`${p.megaphone_id} delivery upsert: ${error.message}`);
          else deliveryRows += drows.length;
        }
      } catch (e) {
        failures.push(`${p.megaphone_id} delivery: ${(e as Error).message}`);
      }
      try {
        const er = await fetchEarnings(
          session,
          p.megaphone_id,
          earningsStart,
          earningsEnd,
        );
        const erows = er.map((pt) => earningsRow(p.id, pt, fetchedAt));
        if (erows.length) {
          const { error } = await supabase
            .from("cached_metric")
            .upsert(erows, {
              onConflict: "podcast_id,metric,granularity,bucket_start",
            });
          if (error) failures.push(`${p.megaphone_id} earnings upsert: ${error.message}`);
          else earningsRows += erows.length;
        }
      } catch (e) {
        failures.push(`${p.megaphone_id} earnings: ${(e as Error).message}`);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, list.length) }, () => worker()),
  );

  // Record the run so the admin panel can track auto-sync health.
  const durationMs = Date.now() - now.getTime();
  await supabase.from("audit_log").insert({
    action: "metrics.sync",
    target_type: "system",
    target_id: "cached_metric",
    metadata: {
      source: "github",
      podcasts: list.length,
      deliveryRows,
      earningsRows,
      failures,
      durationMs,
    },
  });

  console.log(
    `✓ Synced ${list.length} podcasts · ${deliveryRows} delivery rows · ${earningsRows} earnings rows · ${failures.length} failures`,
  );
  for (const f of failures) console.log("  - " + f);
  // Don't fail the run on a few per-podcast failures; only fail if nothing
  // synced at all (likely a dead session).
  if (deliveryRows === 0 && earningsRows === 0 && list.length > 0) {
    console.error("✗ Nothing synced — sessions may be expired.");
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
