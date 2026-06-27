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

/**
 * Percentages arrive from the UI as whole-or-decimal percents (0–100)
 * and are stored as fractions (0–1). Two decimals is plenty for a deal
 * term like 32.5%.
 */
const pct = z
  .number()
  .min(0, "must be ≥ 0%")
  .max(100, "must be ≤ 100%")
  .refine((n) => Number.isFinite(n), "must be a number");

const SplitsSchema = z.object({
  gross_share_pct: pct,
  partner_fee_pct: pct,
});

/**
 * Update a podcast's revenue-split percentages.
 *
 * Auth: admin session via browser, same-origin enforced. Splits decide how
 * money is divided, so we audit every change with before/after values.
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
    scope: "podcast:splits",
    limit: 60,
    windowMs: 60_000,
  });
  if (rl) return rl;

  if (!z.string().uuid().safeParse(params.id).success) {
    return safeError(400, "Invalid podcast id");
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = SplitsSchema.safeParse(raw);
  if (!parsed.success) {
    return safeError(400, parsed.error.issues[0]?.message ?? "Invalid splits");
  }

  const grossFraction = parsed.data.gross_share_pct / 100;
  const partnerFraction = parsed.data.partner_fee_pct / 100;

  const supabase = createAdminClient();

  // Read current values so the audit log captures the delta.
  const { data: before } = await supabase
    .from("podcast")
    .select("id, title, gross_share_pct, partner_fee_pct")
    .eq("id", params.id)
    .maybeSingle();
  if (!before) return safeError(404, "Podcast not found");

  const { error } = await supabase
    .from("podcast")
    .update({
      gross_share_pct: grossFraction,
      partner_fee_pct: partnerFraction,
    })
    .eq("id", params.id);
  if (error) return safeError(500, "Failed to update splits", error);

  await writeAudit({
    session: auth.session,
    action: "podcast.splits.change",
    targetType: "podcast",
    targetId: params.id,
    metadata: {
      title: before.title,
      from: {
        gross_share_pct: before.gross_share_pct,
        partner_fee_pct: before.partner_fee_pct,
      },
      to: {
        gross_share_pct: grossFraction,
        partner_fee_pct: partnerFraction,
      },
    },
    req,
  });

  return NextResponse.json({
    ok: true,
    gross_share_pct: grossFraction,
    partner_fee_pct: partnerFraction,
  });
}
