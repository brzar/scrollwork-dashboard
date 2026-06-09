import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit, requireRole, requireSameOrigin, safeError } from "@/lib/security";
import type { Role } from "@/lib/permissions";
import { canSyncMetrics } from "@/lib/permissions";
import { listPodcasts } from "@/lib/megaphone";
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
    const remote = await listPodcasts();
    const supabase = createAdminClient();

    const rows = remote.map((p) => ({
      megaphone_id: p.id,
      title: p.title,
      subtitle: p.subtitle ?? null,
      author: p.author ?? null,
      image_url: p.imageFile ?? null,
      network_id: process.env.MEGAPHONE_NETWORK_ID ?? null,
      active: true,
    }));

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

/** Constant-time string compare. */
function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}
