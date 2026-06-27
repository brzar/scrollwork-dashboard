import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  rateLimit,
  requireRole,
  requireSameOrigin,
  safeError,
} from "@/lib/security";
import {
  canManagePodcastAccess,
  ACCESS_LEVELS,
  type AccessLevel,
} from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";

const GrantSchema = z.object({
  podcast_id: z.string().uuid(),
  access_level: z
    .enum(ACCESS_LEVELS as [AccessLevel, ...AccessLevel[]])
    .default("read"),
});

/**
 * Grant or upsert a (user, podcast) access mapping.
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const originBlock = requireSameOrigin(req);
  if (originBlock) return originBlock;
  const auth = await requireRole(canManagePodcastAccess);
  if (auth.error) return auth.error;
  const rl = rateLimit(req, auth.session.userId, {
    scope: "access:grant",
    limit: 60,
    windowMs: 60_000,
  });
  if (rl) return rl;

  const raw = await req.json().catch(() => ({}));
  const parsed = GrantSchema.safeParse(raw);
  if (!parsed.success) return safeError(400, "Invalid grant");

  const supabase = createAdminClient();

  // Ensure both rows exist (avoids leaking foreign-key error details).
  const [{ data: targetUser }, { data: podcast }] = await Promise.all([
    supabase.from("user_profile").select("user_id, role").eq("user_id", params.id).maybeSingle(),
    supabase.from("podcast").select("id").eq("id", parsed.data.podcast_id).maybeSingle(),
  ]);
  if (!targetUser) return safeError(404, "User not found");
  if (!podcast) return safeError(404, "Podcast not found");

  const { error } = await supabase
    .from("user_podcast_access")
    .upsert(
      {
        user_id: params.id,
        podcast_id: parsed.data.podcast_id,
        access_level: parsed.data.access_level,
        granted_by: auth.session.userId,
      },
      { onConflict: "user_id,podcast_id" },
    );
  if (error) return safeError(500, "Failed to grant access", error);

  await writeAudit({
    session: auth.session,
    action: "access.grant",
    targetType: "access",
    targetId: `${params.id}:${parsed.data.podcast_id}`,
    metadata: { access_level: parsed.data.access_level },
    req,
  });

  return NextResponse.json({ ok: true });
}

/**
 * Revoke an access mapping. `?podcast_id=` in the query string.
 */
export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
) {
  const originBlock = requireSameOrigin(req);
  if (originBlock) return originBlock;
  const auth = await requireRole(canManagePodcastAccess);
  if (auth.error) return auth.error;
  const rl = rateLimit(req, auth.session.userId, {
    scope: "access:revoke",
    limit: 60,
    windowMs: 60_000,
  });
  if (rl) return rl;

  const podcastId = new URL(req.url).searchParams.get("podcast_id");
  if (!podcastId || !/^[0-9a-f-]{36}$/i.test(podcastId)) {
    return safeError(400, "Invalid podcast_id");
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("user_podcast_access")
    .delete()
    .eq("user_id", params.id)
    .eq("podcast_id", podcastId);
  if (error) return safeError(500, "Failed to revoke access", error);

  await writeAudit({
    session: auth.session,
    action: "access.revoke",
    targetType: "access",
    targetId: `${params.id}:${podcastId}`,
    req,
  });

  return NextResponse.json({ ok: true });
}
