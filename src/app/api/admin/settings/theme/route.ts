import { NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  requireRole,
  requireSameOrigin,
  safeError,
} from "@/lib/security";
import { isSuperAdmin } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { THEME_COOKIE, COOKIE_MAX_AGE } from "@/lib/theme";

export const runtime = "nodejs";

const Schema = z.object({
  dark_mode: z.boolean(),
});

/**
 * Flip the app-wide theme. Super-admin only.
 *
 * Writes to `app_settings` (org-wide source of truth) and also sets a
 * mirror cookie on the caller so the next render uses the new theme
 * with no FOUC.
 */
export async function POST(req: Request) {
  const originBlock = requireSameOrigin(req);
  if (originBlock) return originBlock;
  const auth = await requireRole(isSuperAdmin);
  if (auth.error) return auth.error;

  const raw = await req.json().catch(() => ({}));
  const parsed = Schema.safeParse(raw);
  if (!parsed.success) return safeError(400, "Invalid theme payload");

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("app_settings")
    .upsert(
      { id: true, dark_mode: parsed.data.dark_mode, updated_by: auth.session.userId },
      { onConflict: "id" },
    );
  if (error) return safeError(500, "Failed to save theme", error);

  // Mirror onto the caller's cookie so their next page render skips the
  // DB roundtrip + paints the new theme instantly.
  cookies().set({
    name: THEME_COOKIE,
    value: parsed.data.dark_mode ? "dark" : "light",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  await writeAudit({
    session: auth.session,
    action: "app_settings.theme",
    targetType: "system",
    targetId: "app_settings",
    metadata: { dark_mode: parsed.data.dark_mode },
    req,
  });

  return NextResponse.json({ ok: true });
}
