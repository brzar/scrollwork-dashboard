import "server-only";
import { createAdminClient } from "./supabase/admin";

/**
 * Megaphone "private" web-API client. Server-only.
 *
 * The documented CMS API token doesn't expose analytics (downloads,
 * streams, delivery, etc.) — only content management. Megaphone's web
 * dashboard at cms.megaphone.fm internally calls a separate
 * `/api/v2/private/...` API that *does* return analytics, but it auths
 * via session cookies + an `X-CSRF-Token` header that expire roughly
 * every 24 hours.
 *
 * This client reads the latest known-good session from the
 * `megaphone_session` table (super_admin can refresh it from the admin
 * UI). When the session expires, calls will start failing with 401/403
 * and the UI shows an "Update Megaphone session" prompt.
 *
 * Caveat: this is an internal endpoint. Megaphone may change or remove
 * it without notice. Use the official Metrics Export Service for
 * production once it's enabled on the account.
 */

const BASE = "https://cms.megaphone.fm/api/v2/private";

export type MegaphoneSession = {
  organizationId: string;
  csrfToken: string;
  cookieHeader: string;
};

export class MegaphoneWebSessionMissing extends Error {
  constructor() {
    super("Megaphone web session not configured");
    this.name = "MegaphoneWebSessionMissing";
  }
}

export class MegaphoneWebSessionExpired extends Error {
  status: number;
  constructor(status: number) {
    super(`Megaphone web session rejected (HTTP ${status})`);
    this.name = "MegaphoneWebSessionExpired";
    this.status = status;
  }
}

export class MegaphoneWebTimeout extends Error {
  constructor(ms: number) {
    super(`Megaphone private API timed out after ${ms}ms`);
    this.name = "MegaphoneWebTimeout";
  }
}

/** Per-request timeout for the private API. Generous but finite so a stalled
 * Megaphone never hangs a sync indefinitely. */
const CALL_TIMEOUT_MS = 20_000;

async function loadSession(): Promise<MegaphoneSession> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("megaphone_session")
    .select("organization_id, csrf_token, cookie_header")
    .eq("id", true)
    .maybeSingle();
  if (error || !data) throw new MegaphoneWebSessionMissing();
  return {
    organizationId: data.organization_id,
    csrfToken: data.csrf_token,
    cookieHeader: data.cookie_header,
  };
}

async function callPrivate<T>(
  path: string,
  body: unknown,
  session: MegaphoneSession,
): Promise<T> {
  const url = `${BASE}${path}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Origin": "https://cms.megaphone.fm",
        "Referer": `https://cms.megaphone.fm/organizations/${session.organizationId}/reports/dashboard`,
        "X-CSRF-Token": session.csrfToken,
        "Cookie": session.cookieHeader,
      },
      body: JSON.stringify(body),
      cache: "no-store",
      // Don't follow the 302 → /users/sign_in that an expired session
      // returns. Following it lands on an HTML login page (200) that then
      // breaks JSON parsing or stalls. Catch the redirect and treat it as
      // an expired session instead.
      redirect: "manual",
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new MegaphoneWebTimeout(CALL_TIMEOUT_MS);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  // A redirect means the session cookie is no longer valid — Megaphone
  // bounces unauthenticated requests to the sign-in page. `redirect:
  // "manual"` surfaces this as either a 3xx status or an opaque redirect
  // (status 0 / type "opaqueredirect").
  if (
    res.type === "opaqueredirect" ||
    (res.status >= 300 && res.status < 400)
  ) {
    throw new MegaphoneWebSessionExpired(res.status || 302);
  }

  if (res.status === 401 || res.status === 403 || res.status === 404) {
    // 404 here historically means "your session isn't authoritative for
    // this resource" rather than "resource doesn't exist". Treat all
    // auth-shaped failures the same.
    throw new MegaphoneWebSessionExpired(res.status);
  }
  if (!res.ok) {
    throw new Error(`Megaphone private API ${res.status}`);
  }
  return (await res.json()) as T;
}

// ---- Public surface ------------------------------------------------------

export type DeliveryPoint = {
  date: string;            // 'yyyy-MM-dd'
  totalDownloads: number;
  totalStreams: number;
  totalStarts: number;
  totalDelivery: number;
  totalSaiStarts: number;
};

export type DeliveryRequest = {
  start: string;
  end: string;
  /** Megaphone podcast IDs to filter to. Omit/empty = all podcasts. */
  podcastIds?: string[];
};

/**
 * Global delivery roll-up. Returns one row per day in [start, end].
 *
 * Server-side aggregates: callers can roll up to weekly/monthly with
 * stock JS. The Megaphone payload also includes `totalSaiStarts` etc.
 */
export async function fetchDelivery(
  req: DeliveryRequest,
): Promise<DeliveryPoint[]> {
  const session = await loadSession();

  // Filter shape is a tuple of [field, values[]] — Megaphone rejects
  // object-shaped filters with HTTP 500. Empty array = all podcasts.
  const filters: Array<[string, string[]]> =
    req.podcastIds && req.podcastIds.length > 0
      ? [["podcast_id", req.podcastIds]]
      : [];

  const payload = {
    start: req.start,
    end: req.end,
    filters,
    groupBys: ["day"],
  };

  const raw = await callPrivate<{ items: any[] }>(
    `/reports/organizations/${session.organizationId}/delivery/global_delivery.json`,
    payload,
    session,
  );
  return (raw.items ?? []).map((it: any) => ({
    date: String(it.date ?? it.day ?? ""),
    totalDownloads: Number(it.totalDownloads ?? 0),
    totalStreams: Number(it.totalStreams ?? 0),
    totalStarts: Number(it.totalStarts ?? 0),
    totalDelivery: Number(it.totalDelivery ?? 0),
    totalSaiStarts: Number(it.totalSaiStarts ?? 0),
  }));
}

/** Sum totals across the series — used for stat cards. */
export type DeliveryTotals = {
  downloads: number;
  streams: number;
  starts: number;
  delivery: number;
  saiStarts: number;
};

export function sumDelivery(points: DeliveryPoint[]): DeliveryTotals {
  return points.reduce<DeliveryTotals>(
    (a, p) => ({
      downloads: a.downloads + p.totalDownloads,
      streams: a.streams + p.totalStreams,
      starts: a.starts + p.totalStarts,
      delivery: a.delivery + p.totalDelivery,
      saiStarts: a.saiStarts + p.totalSaiStarts,
    }),
    { downloads: 0, streams: 0, starts: 0, delivery: 0, saiStarts: 0 },
  );
}

// ---- Earnings / Revenue --------------------------------------------------

export type EarningsPoint = {
  date: string;          // 'yyyy-MM-dd' (start of bucket)
  /** Reported (confirmed) earnings — populated for finalized periods. */
  total: number;
  span: number;          // Spotify Audience Network
  pvr: number;           // Programmatic Video Revenue
  /** Estimated earnings — populated for in-progress / not-yet-finalized periods. */
  totalEstimated: number;
  spanEstimated: number;
  pvrEstimated: number;
};

export type EarningsRequest = {
  start: string;
  end: string;
  /**
   * Granularity. Only "month" is confirmed working on Megaphone's private
   * earnings endpoint — "day" exists as a type for future use but the
   * underlying intent param hasn't been reverse-engineered. Callers should
   * align start/end to month boundaries when using "month".
   */
  granularity: "day" | "month";
  /** Optional Megaphone podcast IDs to filter to. */
  podcastIds?: string[];
};

const ALL_METRICS = [
  "totalEarningsInDollars",
  "spanEarningsInDollars",
  "pvrEarningsInDollars",
  "totalEstimatedEarningsInDollars",
  "spanEstimatedEarningsInDollars",
  "pvrEstimatedEarningsInDollars",
] as const;

export async function fetchEarnings(
  req: EarningsRequest,
): Promise<EarningsPoint[]> {
  const session = await loadSession();

  // Earnings uses camelCase filter keys (`podcastId`) — different from the
  // delivery endpoint, which uses snake_case (`podcast_id`). Megaphone
  // returns the allowed list in its 400 error if we get it wrong.
  const filters: Array<[string, string[]]> =
    req.podcastIds && req.podcastIds.length > 0
      ? [["podcastId", req.podcastIds]]
      : [];

  const intent =
    req.granularity === "month" ? "earnings-by-month" : "earnings-by-day";

  const payload = {
    start: req.start,
    end: req.end,
    groupBys: [req.granularity],
    metrics: ALL_METRICS,
    sort: "date",
    sortDirection: "DESC",
    filters,
  };

  const raw = await callPrivate<{ items: any[] }>(
    `/reports/organizations/${session.organizationId}/monetization/earnings.json?intent=${intent}`,
    payload,
    session,
  );
  return (raw.items ?? []).map((it: any): EarningsPoint => ({
    date: String(it.date ?? ""),
    total: Number(it.totalEarningsInDollars ?? 0),
    span: Number(it.spanEarningsInDollars ?? 0),
    pvr: Number(it.pvrEarningsInDollars ?? 0),
    totalEstimated: Number(it.totalEstimatedEarningsInDollars ?? 0),
    spanEstimated: Number(it.spanEstimatedEarningsInDollars ?? 0),
    pvrEstimated: Number(it.pvrEstimatedEarningsInDollars ?? 0),
  }));
}

export type EarningsTotals = {
  /** Confirmed dollars. */
  total: number;
  span: number;
  pvr: number;
  /** Estimated for in-progress periods. */
  totalEstimated: number;
  /** total + totalEstimated — the "expected" line for stat cards. */
  totalExpected: number;
  /** True if any row has non-zero estimated value. */
  hasEstimated: boolean;
};

export function sumEarnings(points: EarningsPoint[]): EarningsTotals {
  let total = 0, span = 0, pvr = 0, est = 0;
  let hasEstimated = false;
  for (const p of points) {
    total += p.total;
    span += p.span;
    pvr += p.pvr;
    est += p.totalEstimated;
    if (p.totalEstimated > 0) hasEstimated = true;
  }
  return {
    total,
    span,
    pvr,
    totalEstimated: est,
    totalExpected: total + est,
    hasEstimated,
  };
}
