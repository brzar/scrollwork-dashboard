import { NextRequest, NextResponse } from "next/server";
import { rateLimit, requireRole, requireSameOrigin, safeError } from "@/lib/security";
import { isSuperAdmin } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";
// Playwright boot + network round-trip can take a while; cap at 60s.
export const maxDuration = 60;

/**
 * Trigger a headless Megaphone session refresh.
 *
 * Auth: super-admin via browser, OR `Authorization: Bearer $CRON_SECRET`
 * for scheduled jobs.
 *
 * Caveat: this route boots Playwright (Chromium) at runtime. On serverless
 * platforms with size limits (Vercel functions: 50 MB unzipped) this will
 * fail to deploy. Run the refresh from a long-running worker, your dev
 * machine via `npm run megaphone:refresh`, or a Docker host instead.
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET;
  const isCron =
    cronSecret &&
    authHeader.startsWith("Bearer ") &&
    timingSafeEq(authHeader.slice("Bearer ".length), cronSecret);

  let actor:
    | { userId: string; email: string; role: "super_admin" }
    | null = null;

  if (!isCron) {
    const originBlock = requireSameOrigin(req);
    if (originBlock) return originBlock;
    const auth = await requireRole(isSuperAdmin);
    if (auth.error) return auth.error;
    // Playwright boot is expensive (Chromium cold-start + headed Megaphone
    // login). One refresh every 30s per super-admin is plenty — anything
    // more is either a stuck button or abuse.
    const rl = rateLimit(req, auth.session.userId, {
      scope: "megaphone:refresh",
      limit: 2,
      windowMs: 60_000,
    });
    if (rl) return rl;
    actor = {
      userId: auth.session.userId,
      email: auth.session.email,
      role: "super_admin",
    };
  }

  try {
    const { refreshAndPersist } = await import("@/lib/megaphone-refresh");
    const result = await refreshAndPersist();
    await writeAudit({
      session: actor
        ? {
            userId: actor.userId,
            email: actor.email,
            fullName: null,
            avatarUrl: null,
            role: actor.role,
          }
        : null,
      action: "megaphone.session.refresh",
      targetType: "system",
      targetId: "megaphone_session",
      metadata: { source: isCron ? "cron" : "manual", ok: result.ok, message: result.message },
      req,
    });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.message },
        { status: 424 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return safeError(500, "Refresh failed", err);
  }
}

function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
