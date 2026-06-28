import { NextRequest, NextResponse } from "next/server";
import type { Session } from "./permissions";

// ----------------------------------------------------------------------------
// Request helpers
// ----------------------------------------------------------------------------

export function getClientIp(req: NextRequest | Request): string {
  const h: Headers = (req as any).headers;
  const xff = h.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return h.get("x-real-ip") || "unknown";
}

export function getUserAgent(req: NextRequest | Request): string {
  return ((req as any).headers as Headers).get("user-agent") || "";
}

export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  const host = req.headers.get("host");
  if (!host) return false;
  const candidate = origin ?? (referer ? new URL(referer).origin : null);
  if (!candidate) return false;
  try {
    return new URL(candidate).host === host;
  } catch {
    return false;
  }
}

/** 403 if the request's Origin / Referer doesn't match Host. */
export function requireSameOrigin(req: Request): NextResponse | null {
  if (isSameOrigin(req)) return null;
  return NextResponse.json({ error: "Forbidden (origin)" }, { status: 403 });
}

// ----------------------------------------------------------------------------
// Auth guards for API routes
// ----------------------------------------------------------------------------

export type RequireAuthResult =
  | { session: Session; error: null }
  | { session: null; error: NextResponse };

/**
 * Load the session from cookies. Every non-public route handler should
 * start with this and bail out on `error`.
 *
 * Dynamic import keeps this file importable from edge contexts (since
 * session-server.ts is `server-only`).
 */
export async function requireAuth(): Promise<RequireAuthResult> {
  const { getServerSession } = await import("./session-server");
  const session = await getServerSession();
  if (!session) {
    return {
      session: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { session, error: null };
}

export async function requireRole(
  predicate: (s: Session) => boolean,
): Promise<RequireAuthResult> {
  const auth = await requireAuth();
  if (auth.error) return auth;
  if (!predicate(auth.session)) {
    return {
      session: null,
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return auth;
}

// ----------------------------------------------------------------------------
// In-memory rate limiter (per-process, per-IP). Best-effort — for hard
// guarantees move to Upstash/Redis. Good enough for a single-process deploy
// and dramatically raises the cost of credential-stuffing/scraping.
// ----------------------------------------------------------------------------

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export type RateLimitOpts = {
  /** Max requests in the window. */
  limit: number;
  /** Window length in ms. */
  windowMs: number;
  /** Key prefix to namespace different endpoints. */
  scope: string;
};

export function rateLimit(
  req: NextRequest | Request,
  identifier: string | null,
  opts: RateLimitOpts,
): NextResponse | null {
  const ip = getClientIp(req);
  const key = `${opts.scope}:${identifier ?? ip}`;
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
    return null;
  }
  bucket.count += 1;
  if (bucket.count > opts.limit) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfter) },
      },
    );
  }
  return null;
}

// ----------------------------------------------------------------------------
// Security headers + CSP
// ----------------------------------------------------------------------------

const BASE_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  // Cross-Origin-* trio: isolate this origin's window from cross-origin
  // embedders and openers so leaked references can't be inspected by
  // attackers. Safe for an internal dashboard with no third-party embeds.
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  // We don't use any of these device APIs. Deny them all — defense in
  // depth against an injected script trying to access them.
  "Permissions-Policy": [
    "accelerometer=()",
    "autoplay=()",
    "browsing-topics=()",
    "camera=()",
    "display-capture=()",
    "fullscreen=(self)",
    "geolocation=()",
    "gyroscope=()",
    "interest-cohort=()",
    "magnetometer=()",
    "microphone=()",
    "midi=()",
    "payment=()",
    "publickey-credentials-get=()",
    "screen-wake-lock=()",
    "serial=()",
    "usb=()",
    "xr-spatial-tracking=()",
  ].join(", "),
};

function buildCsp({ isProd, nonce }: { isProd: boolean; nonce?: string }): string {
  const scriptSrc = nonce
    ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isProd ? "" : " 'unsafe-eval'"}`
    : `script-src 'self'${isProd ? "" : " 'unsafe-eval'"}`;

  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const connectExtras = supaUrl
    ? ` ${supaUrl} ${supaUrl.replace("https://", "wss://")}`
    : "";

  return [
    "default-src 'self'",
    "img-src 'self' data: https://lh3.googleusercontent.com https://*.megaphone.fm https://*.imgix.net https://*.googleusercontent.com https://i.ytimg.com https://*.ytimg.com",
    // Tailwind / Next inline styles need 'unsafe-inline' for style-src.
    "style-src 'self' 'unsafe-inline'",
    scriptSrc,
    // worker-src is not inherited from script-src reliably across browsers
    // when strict-dynamic is in play; pin it explicitly to 'self' so a
    // future devtools fetch can't load a worker from a CDN.
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "media-src 'self'",
    `connect-src 'self'${connectExtras}`,
    "font-src 'self' data:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    // Forces any http:// asset reference to be upgraded to https before
    // the browser fetches it. Belt-and-suspenders against mixed content
    // sneaking past us through a template or copy-paste.
    "upgrade-insecure-requests",
  ].join("; ");
}

export type SecurityHeaderOpts = { nonce?: string };

export function applySecurityHeaders(
  res: NextResponse,
  opts: SecurityHeaderOpts = {},
): NextResponse {
  for (const [k, v] of Object.entries(BASE_HEADERS)) res.headers.set(k, v);
  const isProd = process.env.NODE_ENV === "production";
  res.headers.set("Content-Security-Policy", buildCsp({ isProd, nonce: opts.nonce }));
  if (isProd) {
    res.headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains",
    );
  }
  return res;
}

// ----------------------------------------------------------------------------
// Error sanitization
// ----------------------------------------------------------------------------

/**
 * Public-facing error responses. Never include exception messages from
 * downstream services in client responses — those can leak API tokens,
 * connection strings, or internal hostnames.
 */
export function safeError(
  status: number,
  publicMessage: string,
  internal?: unknown,
): NextResponse {
  if (internal && process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.error(`[${status}] ${publicMessage}`, internal);
  }
  return NextResponse.json({ error: publicMessage }, { status });
}
