import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit, requireRole, safeError } from "@/lib/security";
import { canViewAudit } from "@/lib/permissions";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireRole(canViewAudit);
  if (auth.error) return auth.error;
  const rl = rateLimit(req, auth.session.userId, {
    scope: "audit:read",
    limit: 60,
    windowMs: 60_000,
  });
  if (rl) return rl;

  const limit = Math.min(
    1000,
    Math.max(1, Number(new URL(req.url).searchParams.get("limit") ?? 200)),
  );

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("audit_log")
    .select("id, action, actor_id, actor_email, target_type, target_id, metadata, ip, user_agent, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return safeError(500, "Failed to read audit log", error);
  return NextResponse.json(data ?? []);
}
