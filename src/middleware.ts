import { NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { applySecurityHeaders } from "@/lib/security";

const PUBLIC_PATHS = [
  "/login",
  "/pending",
  "/auth/callback",
];

// Endpoints that authenticate themselves (CRON_SECRET bearer for scheduled
// jobs, or same-origin + role for browser calls). The middleware's
// session gate would otherwise 401 a cron request (it carries a bearer,
// not a session cookie) before it ever reaches the handler. The routes
// still fully enforce their own auth.
const SELF_AUTH_API_PATHS = [
  "/api/admin/sync",
  "/api/admin/sync-metrics",
  "/api/admin/megaphone-refresh",
];

export async function middleware(req: NextRequest) {
  // CVE-2025-29927 defense-in-depth: strip the middleware-bypass header.
  req.headers.delete("x-middleware-subrequest");

  // Per-request CSP nonce. Next.js auto-applies it to its inline scripts
  // via the x-nonce request header, letting us drop 'unsafe-inline'.
  const nonce = btoa(crypto.randomUUID());
  req.headers.set("x-nonce", nonce);

  const { pathname } = req.nextUrl;
  const { res, user } = await updateSession(req);

  const isPublic =
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/")) ||
    SELF_AUTH_API_PATHS.includes(pathname);

  // Unauthenticated → /login (preserving the destination as ?next).
  if (!user && !isPublic) {
    if (pathname.startsWith("/api/")) {
      return applySecurityHeaders(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
        { nonce },
      );
    }
    const loginUrl = new URL("/login", req.url);
    const safeNext =
      pathname.startsWith("/") && !pathname.startsWith("//") ? pathname : "/";
    loginUrl.searchParams.set("next", safeNext);
    return applySecurityHeaders(NextResponse.redirect(loginUrl), { nonce });
  }

  // Authenticated user on /login → bounce home.
  if (user && pathname === "/login") {
    return applySecurityHeaders(
      NextResponse.redirect(new URL("/", req.url)),
      { nonce },
    );
  }

  return applySecurityHeaders(res, { nonce });
}

export const config = {
  // Skip static assets and Next internals.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|logo.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
