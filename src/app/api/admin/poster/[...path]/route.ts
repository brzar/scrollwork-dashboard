import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/permissions";
import {
  rateLimit,
  requireRole,
  requireSameOrigin,
  safeError,
} from "@/lib/security";
import { posterConfigured, posterFetch, PosterUnavailable } from "@/lib/poster";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin-only proxy to the Megaphone Poster's API. The dashboard runs on
 * Vercel; the Poster runs on a machine behind a tunnel. The browser hits
 * this route (same-origin, session-authed); we forward to the Poster with
 * the shared bearer token kept server-side, so the token never reaches the
 * client and only admins can reach the Poster at all.
 *
 * The Poster is "universal" by construction: every admin's request lands on
 * the one Poster instance, so they all see and drive the same channels,
 * queue, and state.
 */

// First path segment must be one of the Poster's known endpoints — keeps
// this from being a generic relay even though the target host is fixed.
const ALLOWED = new Set([
  "channels",
  "queue",
  "usage",
  "episodes",
  "pause",
  "post",
  "abort",
  "schedule",
  "skip",
  "unskip",
  "lookup",
  "warnings",
  "log",
  "megaphone-accounts",
]);

/** Map a mutating call to a shared audit action, or null to skip. */
function auditAction(method: string, seg: string): string | null {
  if (method === "POST" && seg === "post") return "poster.post";
  if (method === "POST" && seg === "pause") return "poster.pause";
  if (seg === "channels" && method !== "GET") return "poster.channel_edit";
  return null;
}

async function handle(
  req: NextRequest,
  { params }: { params: { path?: string[] } },
) {
  const segs = params.path ?? [];
  const first = segs[0] ?? "";
  if (!ALLOWED.has(first)) return safeError(404, "Unknown poster endpoint");

  const method = req.method.toUpperCase();

  // CSRF defense for state changes.
  if (method !== "GET") {
    const originBlock = requireSameOrigin(req);
    if (originBlock) return originBlock;
  }

  const auth = await requireRole(isAdmin);
  if (auth.error) return auth.error;

  // Stopping a run must never be rate-limited — you always want to be able
  // to hit the brakes.
  if (first !== "abort") {
    const rl = rateLimit(req, auth.session.userId, {
      scope: "poster:proxy",
      limit: method === "GET" ? 180 : 30,
      windowMs: 60_000,
    });
    if (rl) return rl;
  }

  if (!posterConfigured()) {
    return safeError(
      503,
      "Spotify Poster isn't connected yet (POSTER_API_URL / POSTER_API_TOKEN unset).",
    );
  }

  const search = req.nextUrl.search ?? "";
  const path = `/api/${segs.map(encodeURIComponent).join("/")}${search}`;

  let body: string | undefined;
  const fwdHeaders: Record<string, string> = {};
  if (method !== "GET" && method !== "DELETE") {
    body = await req.text();
    if (body) {
      fwdHeaders["Content-Type"] =
        req.headers.get("content-type") ?? "application/json";
    }
  }

  try {
    const res = await posterFetch(path, { method, body, headers: fwdHeaders });
    const text = await res.text();

    const action = auditAction(method, first);
    if (action && res.ok) {
      // Best-effort; never blocks or fails the response.
      void writeAudit({
        session: auth.session,
        action,
        targetType: "poster",
        targetId: segs.slice(1).join("/") || first,
        metadata: { method },
        req,
      });
    }

    return new NextResponse(text, {
      status: res.status,
      headers: {
        "Content-Type":
          res.headers.get("content-type") ?? "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof PosterUnavailable) {
      return safeError(503, "Spotify Poster isn't connected yet.");
    }
    return safeError(
      502,
      "Spotify Poster is unreachable. Make sure it's running and tunneled.",
      err,
    );
  }
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
