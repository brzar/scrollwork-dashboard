import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  rateLimit,
  requireRole,
  requireSameOrigin,
  safeError,
} from "@/lib/security";
import { isAdmin } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";

const Schema = z.object({
  monetizable: z.boolean().optional(),
  // null clears the mode; a uuid assigns one.
  split_mode_id: z.string().uuid().nullable().optional(),
  // Percent 0–100, or null to fall back to the mode's default creator share.
  creator_share_pct: z
    .number()
    .min(0, "must be ≥ 0%")
    .max(100, "must be ≤ 100%")
    .nullable()
    .optional(),
});

/**
 * Update a podcast's monetization config: monetizable flag, split mode,
 * and creator-share override. Admin-only, same-origin, audited.
 */
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const originBlock = requireSameOrigin(req);
  if (originBlock) return originBlock;
  const auth = await requireRole(isAdmin);
  if (auth.error) return auth.error;
  const rl = rateLimit(req, auth.session.userId, {
    scope: "podcast:config",
    limit: 60,
    windowMs: 60_000,
  });
  if (rl) return rl;

  if (!z.string().uuid().safeParse(params.id).success) {
    return safeError(400, "Invalid podcast id");
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = Schema.safeParse(raw);
  if (!parsed.success) {
    return safeError(400, parsed.error.issues[0]?.message ?? "Invalid config");
  }

  const patch: {
    monetizable?: boolean;
    split_mode_id?: string | null;
    creator_share_pct?: number | null;
  } = {};
  if (parsed.data.monetizable !== undefined) {
    patch.monetizable = parsed.data.monetizable;
  }
  if (parsed.data.split_mode_id !== undefined) {
    patch.split_mode_id = parsed.data.split_mode_id;
  }
  if (parsed.data.creator_share_pct !== undefined) {
    patch.creator_share_pct =
      parsed.data.creator_share_pct == null
        ? null
        : parsed.data.creator_share_pct / 100;
  }
  if (Object.keys(patch).length === 0) return safeError(400, "No changes");

  const supabase = createAdminClient();

  const { data: before } = await supabase
    .from("podcast")
    .select("id, title, monetizable, split_mode_id, creator_share_pct")
    .eq("id", params.id)
    .maybeSingle();
  if (!before) return safeError(404, "Podcast not found");

  const { error } = await supabase
    .from("podcast")
    .update(patch)
    .eq("id", params.id);
  if (error) return safeError(500, "Failed to update config", error);

  await writeAudit({
    session: auth.session,
    action: "podcast.config.change",
    targetType: "podcast",
    targetId: params.id,
    metadata: { title: before.title, from: before, to: patch },
    req,
  });

  return NextResponse.json({ ok: true });
}
