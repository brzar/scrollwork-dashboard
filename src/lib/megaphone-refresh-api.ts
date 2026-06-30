/**
 * Browser-free Megaphone session refresh.
 *
 * Probes the authenticated PRIVATE API (the same one the data sync uses, which
 * works fine from datacenter IPs) instead of driving a headless browser (which
 * Megaphone bounces to sign-in, false-reporting "expired"). On success it rolls
 * the cookie jar forward from any Set-Cookie the response carries.
 *
 * Pure: no `server-only`, no Supabase, no Playwright — safe to import from both
 * the API route and the standalone CLI/cron script.
 */

export type ApiRefreshResult = {
  ok: boolean;
  message: string;
  cookieHeader?: string;
  csrfToken?: string;
  organizationId?: string;
};

export const EXPIRED_MESSAGE =
  "Saved Megaphone session expired. Re-run `npm run megaphone:auth`.";

const PRIVATE_BASE = "https://cms.megaphone.fm/api/v2/private";
const PROBE_TIMEOUT_MS = 20_000;

/** Merge any Set-Cookie values Megaphone returns into the stored cookie jar. */
export function mergeCookies(current: string, setCookies: string[]): string {
  const jar = new Map<string, string>();
  for (const part of current.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0) jar.set(part.slice(0, i).trim(), part.slice(i + 1));
  }
  for (const sc of setCookies) {
    const first = (sc.split(";")[0] ?? "").trim();
    const i = first.indexOf("=");
    if (i > 0) jar.set(first.slice(0, i).trim(), first.slice(i + 1));
  }
  return Array.from(jar, ([k, v]) => `${k}=${v}`).join("; ");
}

export async function apiRefresh(row: {
  organizationId: string;
  csrfToken: string;
  cookieHeader: string;
}): Promise<ApiRefreshResult> {
  const now = new Date();
  const end = now.toISOString().slice(0, 10);
  const start = new Date(now.getTime() - 2 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const url = `${PRIVATE_BASE}/reports/organizations/${row.organizationId}/delivery/global_delivery.json`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Origin: "https://cms.megaphone.fm",
        Referer: `https://cms.megaphone.fm/organizations/${row.organizationId}/reports/dashboard`,
        "X-CSRF-Token": row.csrfToken,
        Cookie: row.cookieHeader,
      },
      body: JSON.stringify({ start, end, filters: [], groupBys: ["day"] }),
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
    });
  } catch (err) {
    return { ok: false, message: `Refresh probe failed: ${(err as Error).message}` };
  } finally {
    clearTimeout(timer);
  }

  // Redirect / 401 / 403 = cookies genuinely dead → re-seed needed.
  if (
    res.type === "opaqueredirect" ||
    (res.status >= 300 && res.status < 400) ||
    res.status === 401 ||
    res.status === 403
  ) {
    return { ok: false, message: EXPIRED_MESSAGE };
  }
  if (!res.ok) {
    // Other transient error — do NOT declare the session expired.
    return { ok: false, message: `Refresh probe HTTP ${res.status}` };
  }

  const setCookies: string[] = (res.headers as any).getSetCookie?.() ?? [];
  const cookieHeader = setCookies.length
    ? mergeCookies(row.cookieHeader, setCookies)
    : row.cookieHeader;
  return {
    ok: true,
    cookieHeader,
    csrfToken: row.csrfToken,
    organizationId: row.organizationId,
    message: "Refreshed (api)",
  };
}
