import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireSameOrigin } from "@/lib/security";
import { writeAudit } from "@/lib/audit";
import { getServerSession } from "@/lib/session-server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const originBlock = requireSameOrigin(req);
  if (originBlock) return originBlock;

  const session = await getServerSession();
  const supabase = createClient();
  await supabase.auth.signOut();

  await writeAudit({
    session,
    action: "auth.logout",
    targetType: "user",
    targetId: session?.userId ?? null,
    req,
  });

  return NextResponse.json({ ok: true });
}

export async function GET() {
  // Legacy fallback so the pending-page link works (no CSRF risk: just
  // signs the user out).
  const supabase = createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(
    new URL("/login", process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"),
  );
}
