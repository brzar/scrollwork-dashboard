import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session-server";
import { signExternalToken } from "@/lib/external-token";

/**
 * Issue a personal external-API token for the logged-in user (used by the
 * /connect-lifehub approval page). Requires a mapped partner identity —
 * that's what revenue payouts are keyed by.
 */
export const dynamic = "force-dynamic";

export async function POST() {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.EXTERNAL_API_TOKEN) {
    return NextResponse.json(
      { error: "External API not configured" },
      { status: 503 },
    );
  }
  if (!session.partnerName) {
    return NextResponse.json(
      {
        error:
          "Your account has no partner identity mapped — ask an admin to set one, then retry.",
      },
      { status: 403 },
    );
  }
  return NextResponse.json({
    token: signExternalToken({ u: session.userId, p: session.partnerName }),
  });
}
