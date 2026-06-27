import "server-only";
import { createClient } from "./supabase/server";
import { roleFromString, type Session } from "./permissions";

/**
 * Resolve the current session from request cookies.
 *
 * Always uses `getUser()` (validates the JWT) — never `getSession()` which
 * trusts cookie contents and can return a spoofed user inside Server
 * Components.
 *
 * Returns null when:
 *   - no auth cookie / invalid JWT
 *   - user has no row in user_profile (waiting on trigger / disabled)
 *   - user_profile.active = false
 */
export async function getServerSession(): Promise<Session | null> {
  const supabase = createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  const { data: profile } = await supabase
    .from("user_profile")
    .select("email, full_name, avatar_url, role, active, partner_name")
    .eq("user_id", data.user.id)
    .maybeSingle();

  if (!profile) return null;
  if (profile.active === false) return null;

  const role = roleFromString(profile.role);
  if (!role) return null;

  return {
    userId: data.user.id,
    email: profile.email,
    fullName: profile.full_name ?? null,
    avatarUrl: profile.avatar_url ?? null,
    role,
    partnerName: profile.partner_name ?? null,
  };
}
