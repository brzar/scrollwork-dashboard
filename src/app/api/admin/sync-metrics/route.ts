import { NextRequest, NextResponse } from "next/server";
import { rateLimit, requireRole, requireSameOrigin, safeError } from "@/lib/security";
import { isAdmin, type Role } from "@/lib/permissions";
import { syncMetrics } from "@/lib/cached-metrics";
import { writeAudit } from "@/lib/audit";
import {
  MegaphoneWebSessionMissing,
  MegaphoneWebSessionExpired,
  MegaphoneWebTimeout,
} from "@/lib/megaphone-web";

export const runtime = "nodejs";
// Megaphone is slow when we fan out 9 podcasts × 2 calls; give it room.
export const maxDuration = 60;

/**
 * Sync metrics from Megaphone into the cached_metric table.
 *
 * Auth: admin session via browser, OR `Authorization: Bearer $CRON_SECRET`
 * for a scheduled job.
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET;
  const isCron =
    cronSecret &&
    authHeader.startsWith("Bearer ") &&
    timingSafeEq(authHeader.slice("Bearer ".length), cronSecret);

  let session: { userId: string; email: string; role: Role } | null = null;

  if (!isCron) {
    const originBlock = requireSameOrigin(req);
    if (originBlock) return originBlock;
    const auth = await requireRole(isAdmin);
    if (auth.error) return auth.error;
    // Each manual sync fans out N podcast × 2 requests to Megaphone +
    // bulk-writes cached_metric. Limit browser-initiated calls to prevent
    // accidental or malicious resource burn.
    const rl = rateLimit(req, auth.session.userId, {
      scope: "sync:metrics",
      limit: 4,
      windowMs: 60_000,
    });
    if (rl) return rl;
    session = {
      userId: auth.session.userId,
      email: auth.session.email,
      role: auth.session.role,
    };
  }

  try {
    // Optional ?account= and ?slice=i&slices=n so callers can split the
    // work across several short requests and stay under the function limit.
    const sp = new URL(req.url).searchParams;
    const accountFilter = sp.get("account") || undefined;
    const slices = Number(sp.get("slices")) || undefined;
    const slice = Number(sp.get("slice")) || 0;
    const result = await syncMetrics(new Date(), accountFilter, slice, slices);
    await writeAudit({
      session: session
        ? {
            userId: session.userId,
            email: session.email,
            fullName: null,
            avatarUrl: null,
            role: session.role,
            partnerName: null,
          }
        : null,
      action: "metrics.sync",
      targetType: "system",
      targetId: "cached_metric",
      metadata: {
        source: isCron ? "cron" : "manual",
        ...result,
      },
      req,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof MegaphoneWebSessionMissing) {
      return safeError(424, "Megaphone session not configured");
    }
    if (err instanceof MegaphoneWebSessionExpired) {
      return safeError(424, "Megaphone session expired — refresh it");
    }
    if (err instanceof MegaphoneWebTimeout) {
      return safeError(504, "Megaphone timed out — try again");
    }
    return safeError(502, "Metrics sync failed", err);
  }
}

/**
 * Vercel Cron invokes endpoints with GET + an `Authorization: Bearer
 * $CRON_SECRET` header. Accept that here (cron-only — no session path) and
 * delegate to POST, which re-validates the bearer and runs the cron branch.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET;
  const ok =
    cronSecret &&
    authHeader.startsWith("Bearer ") &&
    timingSafeEq(authHeader.slice("Bearer ".length), cronSecret);
  if (!ok) return safeError(401, "Unauthorized");
  return POST(req);
}

function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
