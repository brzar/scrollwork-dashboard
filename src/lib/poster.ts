import "server-only";

/**
 * Thin server-side client for the Megaphone Poster (the local YouTube →
 * Megaphone tool, surfaced in the dashboard as the "Spotify Poster" admin
 * tab). The Poster runs on a machine and is exposed over a Cloudflare
 * tunnel; we reach it with a shared bearer token that never leaves the
 * server. The browser only ever talks to our own /api/admin/poster proxy.
 */

const BASE = (process.env.POSTER_API_URL ?? "").replace(/\/+$/, "");
const TOKEN = process.env.POSTER_API_TOKEN ?? "";

const DEFAULT_TIMEOUT_MS = 25_000;

/** True when both the tunnel URL and the shared token are configured. */
export function posterConfigured(): boolean {
  return Boolean(BASE && TOKEN);
}

/** Thrown when the Poster isn't configured (no URL / token in env). */
export class PosterUnavailable extends Error {}

/**
 * Fetch a path on the Poster (e.g. "/api/queue"). Adds the bearer token,
 * a hard timeout, and never follows redirects (a redirect from a tunnel
 * almost always means an auth/login interstitial, not a real response).
 */
export async function posterFetch(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  if (!posterConfigured()) {
    throw new PosterUnavailable("Poster is not configured");
  }
  const { timeoutMs = DEFAULT_TIMEOUT_MS, headers, ...rest } = init;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(`${BASE}${path}`, {
      ...rest,
      headers: { ...(headers ?? {}), Authorization: `Bearer ${TOKEN}` },
      signal: ctrl.signal,
      cache: "no-store",
      redirect: "manual",
    });
  } finally {
    clearTimeout(timer);
  }
}
