import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  requireRole,
  requireSameOrigin,
  safeError,
} from "@/lib/security";
import {
  canManageUsers,
  canChangeRoles,
  ROLES,
  type Role,
} from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";

const PatchSchema = z.object({
  role: z.enum(ROLES as [Role, ...Role[]]).optional(),
  active: z.boolean().optional(),
});

/**
 * Update role or active flag on a user.
 *   - role changes require super_admin (canChangeRoles).
 *   - active toggles require admin.
 */
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const originBlock = requireSameOrigin(req);
  if (originBlock) return originBlock;
  const auth = await requireRole(canManageUsers);
  if (auth.error) return auth.error;

  const raw = await req.json().catch(() => ({}));
  const parsed = PatchSchema.safeParse(raw);
  if (!parsed.success) return safeError(400, "Invalid update");
  const { role, active } = parsed.data;

  if (role && !canChangeRoles(auth.session)) {
    return safeError(403, "Only super admins can change roles");
  }

  const supabase = createAdminClient();

  // Don't allow demoting yourself out of super_admin — easy footgun.
  if (
    role &&
    params.id === auth.session.userId &&
    role !== "super_admin"
  ) {
    return safeError(400, "Refusing to demote yourself");
  }
  // Don't allow disabling yourself.
  if (active === false && params.id === auth.session.userId) {
    return safeError(400, "Refusing to disable yourself");
  }

  // Fetch the target's current role to enforce horizontal/vertical guards.
  // Without this, an admin (non-super) could disable the super_admin or
  // demote them via PATCH — the role guard above only blocks self-actions.
  const { data: target } = await supabase
    .from("user_profile")
    .select("user_id, role")
    .eq("user_id", params.id)
    .maybeSingle();
  if (!target) return safeError(404, "User not found");

  if (target.role === "super_admin" && auth.session.role !== "super_admin") {
    return safeError(403, "Only super admins can modify super-admin accounts");
  }
  // Block promoting anyone to super_admin via PATCH unless caller is super.
  if (role === "super_admin" && auth.session.role !== "super_admin") {
    return safeError(403, "Only super admins can grant super-admin");
  }

  const patch: { role?: Role; active?: boolean } = {};
  if (role) patch.role = role;
  if (typeof active === "boolean") patch.active = active;
  if (Object.keys(patch).length === 0) return safeError(400, "No changes");

  const { error } = await supabase
    .from("user_profile")
    .update(patch)
    .eq("user_id", params.id);
  if (error) return safeError(500, "Failed to update user", error);

  if (role) {
    await writeAudit({
      session: auth.session,
      action: "user.role.change",
      targetType: "user",
      targetId: params.id,
      metadata: { role },
      req,
    });
  }
  if (typeof active === "boolean") {
    await writeAudit({
      session: auth.session,
      action: active ? "user.reactivate" : "user.deactivate",
      targetType: "user",
      targetId: params.id,
      req,
    });
  }

  return NextResponse.json({ ok: true });
}
