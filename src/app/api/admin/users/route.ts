import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  requireRole,
  requireSameOrigin,
  rateLimit,
  safeError,
} from "@/lib/security";
import {
  canManageUsers,
  ROLES,
  ACCESS_LEVELS,
  type Role,
  type AccessLevel,
} from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";

const PodcastGrant = z.object({
  podcast_id: z.string().uuid(),
  access_level: z
    .enum(ACCESS_LEVELS as [AccessLevel, ...AccessLevel[]])
    .default("read"),
});

const InviteSchema = z.object({
  email: z.string().email().max(254),
  role: z.enum(ROLES as [Role, ...Role[]]),
  /**
   * Optional pre-seeded podcast access. For new invites we stash this on
   * the invitation row and the auth trigger consumes it on first sign-in.
   * For existing users we apply it immediately.
   */
  podcasts: z.array(PodcastGrant).max(500).optional().default([]),
  /** Beneficiary name this account maps to in split modes (e.g. "King"). */
  partner_name: z.string().trim().max(80).nullable().optional(),
});

export async function GET() {
  const auth = await requireRole(canManageUsers);
  if (auth.error) return auth.error;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("user_profile")
    .select("user_id, email, full_name, role, active, created_at")
    .order("created_at", { ascending: false });
  if (error) return safeError(500, "Failed to load users", error);
  return NextResponse.json(data ?? []);
}

export async function POST(req: Request) {
  const originBlock = requireSameOrigin(req);
  if (originBlock) return originBlock;
  const auth = await requireRole(canManageUsers);
  if (auth.error) return auth.error;
  const rl = rateLimit(req, auth.session.userId, {
    scope: "invite",
    limit: 20,
    windowMs: 60_000,
  });
  if (rl) return rl;

  const raw = await req.json().catch(() => ({}));
  const parsed = InviteSchema.safeParse(raw);
  if (!parsed.success) return safeError(400, "Invalid invite");

  if (parsed.data.role === "super_admin" && auth.session.role !== "super_admin") {
    return safeError(403, "Only super admins can invite super admins");
  }

  const isPerPodcastRole =
    parsed.data.role === "creator" || parsed.data.role === "viewer";
  const podcasts = isPerPodcastRole ? parsed.data.podcasts : [];

  const supabase = createAdminClient();

  // Existing user? Update role and apply podcast grants immediately.
  const { data: existing } = await supabase
    .from("user_profile")
    .select("user_id, email, role")
    .ilike("email", parsed.data.email)
    .maybeSingle();

  if (existing) {
    // Privilege-downgrade guard: only super_admin can touch a super_admin
    // account. Otherwise any admin could re-invite the super_admin's email
    // with role=admin to demote them.
    if (existing.role === "super_admin" && auth.session.role !== "super_admin") {
      return safeError(403, "Only super admins can modify super-admin accounts");
    }
    // Privilege-escalation guard (defense in depth — RLS also blocks this):
    // only super_admin can promote anyone to super_admin via re-invite.
    if (parsed.data.role === "super_admin" && auth.session.role !== "super_admin") {
      return safeError(403, "Only super admins can grant super-admin");
    }
    // Self-demotion guard: don't let the caller demote themselves and lock
    // themselves out of the admin surface mid-request.
    if (
      existing.user_id === auth.session.userId &&
      parsed.data.role !== auth.session.role
    ) {
      return safeError(400, "Refusing to change your own role");
    }
    const update: { role: Role; active: boolean; partner_name?: string | null } =
      { role: parsed.data.role, active: true };
    if (parsed.data.partner_name !== undefined) {
      update.partner_name = parsed.data.partner_name || null;
    }
    const { error } = await supabase
      .from("user_profile")
      .update(update)
      .eq("user_id", existing.user_id);
    if (error) return safeError(500, "Failed to update role", error);

    if (podcasts.length > 0) {
      const rows = podcasts.map((p) => ({
        user_id: existing.user_id,
        podcast_id: p.podcast_id,
        access_level: p.access_level,
        granted_by: auth.session.userId,
      }));
      const { error: e2 } = await supabase
        .from("user_podcast_access")
        .upsert(rows, { onConflict: "user_id,podcast_id" });
      if (e2) return safeError(500, "Failed to apply podcast access", e2);
    }

    await writeAudit({
      session: auth.session,
      action: "user.role.change",
      targetType: "user",
      targetId: existing.user_id,
      metadata: { role: parsed.data.role, via: "invite", podcasts: podcasts.length },
      req,
    });
    return NextResponse.json({ ok: true, mode: "updated", podcasts: podcasts.length });
  }

  // New invitation — stash podcasts in the row so the trigger applies them
  // on the user's first sign-in.
  const { data, error } = await supabase
    .from("invitation")
    .insert({
      email: parsed.data.email,
      role: parsed.data.role,
      invited_by: auth.session.userId,
      podcast_access: podcasts,
      partner_name: parsed.data.partner_name || null,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      return safeError(409, "An open invite for that email already exists");
    }
    return safeError(500, "Failed to create invite", error);
  }

  await writeAudit({
    session: auth.session,
    action: "user.invite",
    targetType: "invitation",
    targetId: data.id,
    metadata: {
      email: parsed.data.email,
      role: parsed.data.role,
      podcasts: podcasts.length,
    },
    req,
  });

  return NextResponse.json({
    ok: true,
    mode: "invited",
    id: data.id,
    podcasts: podcasts.length,
  });
}
