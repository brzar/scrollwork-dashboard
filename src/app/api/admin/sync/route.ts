import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit, requireRole, requireSameOrigin, safeError } from "@/lib/security";
import type { Role } from "@/lib/permissions";
import { canSyncMetrics } from "@/lib/permissions";
import { listPodcasts } from "@/lib/megaphone";
import { listMegaphoneAccounts } from "@/lib/megaphone-accounts";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * Sync podcasts from Megaphone into the local `podcast` table.
 *
 * Auth: either an admin session (browser-initiated) OR a matching
 * CRON_SECRET in the `Authorization: Bearer <secret>` header (for
 * scheduled jobs / Vercel Cron).
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET;
  const isCron =
    cronSecret &&
    authHeader.startsWith("Bearer ") &&
    timingSafeEq(authHeader.slice("Bearer ".length), cronSecret);

  let actorEmail: string | null = null;
  let actorId: string | null = null;
  let actorRole: Role | null = null;

  if (!isCron) {
    const originBlock = requireSameOrigin(req);
    if (originBlock) return originBlock;
    const auth = await requireRole(canSyncMetrics);
    if (auth.error) return auth.error;
    // Sync hits Megaphone's API and writes a wide swath of rows — gate
    // browser-initiated calls behind a per-user limiter so a compromised
    // admin session can't be used to hammer the upstream / our DB.
    const rl = rateLimit(req, auth.session.userId, {
      scope: "sync:podcast",
      limit: 6,
      windowMs: 60_000,
    });
    if (rl) return rl;
    actorEmail = auth.session.email;
    actorId = auth.session.userId;
    actorRole = auth.session.role;
  }

  try {
    const accounts = listMegaphoneAccounts();
    if (accounts.length === 0) {
      return safeError(
        500,
        "No Megaphone accounts configured (set MEGAPHONE_API_TOKEN / MEGAPHONE_NETWORK_ID).",
      );
    }
    const supabase = createAdminClient();

    // Pull each account's podcasts and tag rows with that account so the
    // metrics sync later knows which session to use per show.
    // Note: we deliberately do NOT set `active` here. On insert it gets the
    // column default (true); on conflict it's left untouched, so a podcast
    // an admin has manually deactivated stays deactivated across syncs.
    const rows: Array<{
      megaphone_id: string;
      title: string;
      subtitle: string | null;
      author: string | null;
      image_url: string | null;
      network_id: string | null;
      megaphone_account: string;
    }> = [];
    for (const account of accounts) {
      const remote = await listPodcasts(account);
      for (const p of remote) {
        rows.push({
          megaphone_id: p.id,
          title: p.title,
          subtitle: p.subtitle ?? null,
          author: p.author ?? null,
          image_url: p.imageFile ?? null,
          network_id: account.networkId,
          megaphone_account: account.key,
        });
      }
    }

    // Upsert on megaphone_id so existing rows keep their UUID/access mappings.
    const { data, error } = await supabase
      .from("podcast")
      .upsert(rows, { onConflict: "megaphone_id" })
      .select("id, megaphone_id, title");
    if (error) return safeError(500, "Sync failed", error);

    await writeAudit({
      session: actorId
        ? {
            userId: actorId,
            email: actorEmail ?? "",
            fullName: null,
            avatarUrl: null,
            role: actorRole ?? "admin",
            partnerName: null,
          }
        : null,
      action: "podcast.sync",
      targetType: "system",
      targetId: "podcasts",
      metadata: { count: rows.length, source: isCron ? "cron" : "manual" },
      req,
    });

    return NextResponse.json({ ok: true, synced: data?.length ?? 0 });
  } catch (err) {
    return safeError(502, "Upstream sync unavailable", err);
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

/** Constant-time string compare. */
function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}
