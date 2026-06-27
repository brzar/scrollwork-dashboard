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
  // Whole-or-decimal percent (0–100); stored as a fraction (0–1).
  founder_share_pct: z
    .number()
    .min(0, "must be ≥ 0%")
    .max(100, "must be ≤ 100%")
    .refine((n) => Number.isFinite(n), "must be a number"),
});

/**
 * Set the founder share — how much of company net each founder takes.
 * Admin-only, same-origin, audited (it decides money distribution).
 */
export async function POST(req: Request) {
  const originBlock = requireSameOrigin(req);
  if (originBlock) return originBlock;
  const auth = await requireRole(isAdmin);
  if (auth.error) return auth.error;
  const rl = rateLimit(req, auth.session.userId, {
    scope: "settings:founder-share",
    limit: 30,
    windowMs: 60_000,
  });
  if (rl) return rl;

  const raw = await req.json().catch(() => ({}));
  const parsed = Schema.safeParse(raw);
  if (!parsed.success) {
    return safeError(400, parsed.error.issues[0]?.message ?? "Invalid value");
  }

  const fraction = parsed.data.founder_share_pct / 100;
  const supabase = createAdminClient();

  const { data: before } = await supabase
    .from("app_settings")
    .select("founder_share_pct")
    .eq("id", true)
    .maybeSingle();

  const { error } = await supabase
    .from("app_settings")
    .upsert(
      { id: true, founder_share_pct: fraction, updated_by: auth.session.userId },
      { onConflict: "id" },
    );
  if (error) return safeError(500, "Failed to save founder share", error);

  await writeAudit({
    session: auth.session,
    action: "app_settings.founder_share",
    targetType: "system",
    targetId: "app_settings",
    metadata: {
      from: before?.founder_share_pct ?? null,
      to: fraction,
    },
    req,
  });

  return NextResponse.json({ ok: true, founder_share_pct: fraction });
}
