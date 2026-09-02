import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  OWNER_NAME,
  computeSplit,
  parseBeneficiaries,
  type SplitMode,
} from "@/lib/split";
import { startOfMonth, endOfMonth, subYears } from "date-fns";
import { isoDate } from "@/lib/date-ranges";
import { verifyExternalToken } from "@/lib/external-token";

/**
 * Machine-readable owner take, for external tools (Life Hub).
 *
 * Auth: `Authorization: Bearer <EXTERNAL_API_TOKEN>`. The route is listed in
 * the middleware's SELF_AUTH_API_PATHS so the session gate lets it through;
 * without the env var set it always 401s (fail closed).
 *
 * Returns the owner's monthly payout across all monetizable, mode-assigned
 * podcasts — the same math as /admin/profit, collapsed to one number per
 * month: { owner, months: [{ month: "YYYY-MM", confirmed, estimated, total }] }
 */
export const dynamic = "force-dynamic";

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function GET(req: Request) {
  const master = process.env.EXTERNAL_API_TOKEN;
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  // Master token (legacy) → the owner; otherwise a signed per-user token
  // issued by /connect-lifehub → that user's partner identity.
  let takeName: string | null = null;
  if (master && bearer === master) {
    takeName = OWNER_NAME;
  } else {
    takeName = verifyExternalToken(bearer)?.p ?? null;
  }
  if (!master || !takeName) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const queryStart = isoDate(startOfMonth(subYears(now, 1)));
  const queryEnd = isoDate(endOfMonth(now));
  const admin = createAdminClient();

  const modesRes = await admin
    .from("split_mode")
    .select(
      "id, name, portal, portal_fee_pct, default_creator_share_pct, beneficiaries",
    );
  if (modesRes.error) {
    return NextResponse.json(
      { error: "split modes unavailable" },
      { status: 500 },
    );
  }
  const modeById = new Map<string, SplitMode>(
    (modesRes.data ?? []).map((m) => [
      m.id,
      {
        id: m.id,
        name: m.name,
        portal: m.portal,
        portalFeePct: m.portal_fee_pct,
        defaultCreatorSharePct: m.default_creator_share_pct,
        beneficiaries: parseBeneficiaries(m.beneficiaries),
      },
    ]),
  );

  const pods = await admin
    .from("podcast")
    .select("id, monetizable, split_mode_id, creator_share_pct")
    .eq("active", true);
  if (pods.error) {
    return NextResponse.json({ error: pods.error.message }, { status: 500 });
  }
  const cfgById = new Map(pods.data.map((p) => [p.id, p]));
  // Read cached_metric with the admin client — readCachedEarnings() uses the
  // session-scoped client, and this route has no session (RLS would hide
  // every row).
  const metricRes = await admin
    .from("cached_metric")
    .select("podcast_id, bucket_start, value")
    .in(
      "podcast_id",
      pods.data.map((p) => p.id),
    )
    .eq("metric", "earnings")
    .eq("granularity", "month")
    .gte("bucket_start", queryStart)
    .lte("bucket_start", queryEnd)
    .order("bucket_start", { ascending: true });
  if (metricRes.error) {
    return NextResponse.json({ error: metricRes.error.message }, { status: 500 });
  }
  const rows = (metricRes.data ?? []).map((r) => ({
    podcastId: r.podcast_id,
    date: String(r.bucket_start),
    value: r.value,
  }));

  const byMonth = new Map<string, { confirmed: number; estimated: number }>();
  for (const r of rows) {
    const cfg = cfgById.get(r.podcastId);
    if (!cfg?.monetizable || !cfg.split_mode_id) continue;
    const mode = modeById.get(cfg.split_mode_id);
    if (!mode) continue;
    const v = (r.value ?? {}) as { total?: number; totalEstimated?: number };
    const sc = computeSplit(Number(v.total ?? 0), mode, cfg.creator_share_pct);
    const se = computeSplit(
      Number(v.totalEstimated ?? 0),
      mode,
      cfg.creator_share_pct,
    );
    const month = String(r.date).slice(0, 7);
    const cur = byMonth.get(month) ?? { confirmed: 0, estimated: 0 };
    cur.confirmed += sc.payouts[takeName] ?? 0;
    cur.estimated += se.payouts[takeName] ?? 0;
    byMonth.set(month, cur);
  }

  const months = [...byMonth.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([month, x]) => ({
      month,
      confirmed: round2(x.confirmed),
      estimated: round2(x.estimated),
      total: round2(x.confirmed + x.estimated),
    }));

  return NextResponse.json({ owner: takeName, months });
}
