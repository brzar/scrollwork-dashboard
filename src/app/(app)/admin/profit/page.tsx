import { redirect } from "next/navigation";
import { Card, CardBody } from "@/components/ui/Card";
import { StatCard } from "@/components/StatCard";
import {
  EarningsBarChart,
  type EarningsBarPoint,
} from "@/components/charts/EarningsBarChart";
import { getServerSession } from "@/lib/session-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/permissions";
import { readCachedEarnings } from "@/lib/cached-metrics";
import {
  FOUNDER_SHARE_PCT,
  GROSS_SHARE_PCT,
  PARTNER_FEE_PCT,
  splitRevenueWith,
} from "@/lib/profit";
import { fmtCurrency } from "@/lib/format";
import {
  startOfYear,
  startOfMonth,
  endOfMonth,
  subMonths,
  subYears,
  parseISO,
  format,
} from "date-fns";
import { isoDate } from "@/lib/date-ranges";
import { ProfitTable, type ProfitTableRow } from "./ProfitTable";
import { PodcastSplitsTable, type PodcastSplitRow } from "./PodcastSplitsTable";
import { FounderShareControl } from "./FounderShareControl";

export const dynamic = "force-dynamic";

const MONTH_SHORT = (iso: string) => format(parseISO(iso), "MMM yyyy");
const MONTH_LONG = (iso: string) => format(parseISO(iso), "MMMM yyyy");

export default async function ProfitPage() {
  const session = await getServerSession();
  if (!session) redirect("/pending");
  if (!isAdmin(session)) redirect("/");

  const now = new Date();
  const queryStart = isoDate(startOfMonth(subYears(now, 1)));
  const queryEnd = isoDate(endOfMonth(now));
  const thisMonthIso = isoDate(startOfMonth(now));
  const ytdStart = isoDate(startOfYear(now));

  const admin = createAdminClient();
  // Load podcasts with their per-show splits. If the splits migration
  // hasn't been applied yet (columns missing), fall back to a basic query
  // + global defaults so the profit view still works — the per-podcast
  // editor just stays disabled until the migration runs.
  type PodRow = {
    id: string;
    title: string;
    gross_share_pct: number;
    partner_fee_pct: number;
  };
  let podcasts: PodRow[] = [];
  let splitsEnabled = true;
  const withSplits = await admin
    .from("podcast")
    .select("id, title, gross_share_pct, partner_fee_pct")
    .eq("active", true)
    .order("title", { ascending: true });
  if (withSplits.error) {
    splitsEnabled = false;
    const basic = await admin
      .from("podcast")
      .select("id, title")
      .eq("active", true)
      .order("title", { ascending: true });
    podcasts = (basic.data ?? []).map((p) => ({
      id: p.id,
      title: p.title,
      gross_share_pct: GROSS_SHARE_PCT,
      partner_fee_pct: PARTNER_FEE_PCT,
    }));
  } else {
    podcasts = withSplits.data ?? [];
  }
  const podIds = podcasts.map((p) => p.id);
  const splitOf = new Map(
    podcasts.map((p) => [
      p.id,
      { gross: p.gross_share_pct, partner: p.partner_fee_pct },
    ]),
  );

  // Founder share (% of company net per founder). Stored on app_settings;
  // falls back to the global default if the migration isn't applied yet.
  let founderShare = FOUNDER_SHARE_PCT;
  let founderShareEnabled = true;
  const settings = await admin
    .from("app_settings")
    .select("founder_share_pct")
    .eq("id", true)
    .maybeSingle();
  if (settings.error) {
    founderShareEnabled = false;
  } else if (settings.data?.founder_share_pct != null) {
    founderShare = settings.data.founder_share_pct;
  }

  const earnings = await readCachedEarnings(podIds, queryStart, queryEnd);

  // Roll up per month, applying EACH podcast's own split before summing.
  // We track creator revenue (for display) and the post-split net,
  // separated into confirmed vs. estimated so the chart + badges work.
  type Row = {
    month: string;
    creatorConfirmed: number;
    creatorEstimated: number;
    grossTotal: number;
    partnerFeeTotal: number;
    netConfirmed: number;
    netEstimated: number;
  };
  const map = new Map<string, Row>();
  const get = (m: string): Row => {
    const r =
      map.get(m) ??
      ({
        month: m,
        creatorConfirmed: 0,
        creatorEstimated: 0,
        grossTotal: 0,
        partnerFeeTotal: 0,
        netConfirmed: 0,
        netEstimated: 0,
      } satisfies Row);
    map.set(m, r);
    return r;
  };
  for (const r of earnings.rows) {
    const v = r.value ?? {};
    const split = splitOf.get(r.podcastId) ?? { gross: 0.3, partner: 0.2 };
    const confirmed = Number(v.total ?? 0);
    const estimated = Number(v.totalEstimated ?? 0);
    const sc = splitRevenueWith(confirmed, split.gross, split.partner);
    const se = splitRevenueWith(estimated, split.gross, split.partner);
    const row = get(r.date);
    row.creatorConfirmed += confirmed;
    row.creatorEstimated += estimated;
    row.grossTotal += sc.gross + se.gross;
    row.partnerFeeTotal += sc.partnerFee + se.partnerFee;
    row.netConfirmed += sc.net;
    row.netEstimated += se.net;
  }

  // Ascending for the chart, descending for the table.
  const ascending = Array.from(map.values()).sort((a, b) =>
    a.month < b.month ? -1 : 1,
  );
  const descending = [...ascending].reverse();

  // ---- Topline ---------------------------------------------------------
  const thisMonth = map.get(thisMonthIso);
  const thisMonthNet =
    (thisMonth?.netConfirmed ?? 0) + (thisMonth?.netEstimated ?? 0);

  const lastFinalized = descending.find(
    (r) => r.month < thisMonthIso && r.creatorConfirmed > 0,
  );
  const lastFinalizedNet = lastFinalized ? lastFinalized.netConfirmed : 0;

  const ytdRows = ascending.filter((r) => r.month >= ytdStart);
  const ytdNetConfirmed = ytdRows.reduce((s, r) => s + r.netConfirmed, 0);
  const ytdNetEstimated = ytdRows.reduce((s, r) => s + r.netEstimated, 0);
  const ytdNet = ytdNetConfirmed + ytdNetEstimated;

  // Chart shows per-founder take-home so it lines up with the topline
  // cards. Confirmed dark, estimated lighter on top.
  const chart: EarningsBarPoint[] = ascending.map((r) => ({
    month: MONTH_SHORT(r.month),
    confirmed: r.netConfirmed * founderShare,
    estimated: r.netEstimated * founderShare,
  }));

  const tableRows: ProfitTableRow[] = descending.map((r) => {
    const net = r.netConfirmed + r.netEstimated;
    return {
      month: r.month,
      label: MONTH_LONG(r.month),
      creator: r.creatorConfirmed + r.creatorEstimated,
      isEstimated: r.creatorConfirmed === 0 && r.creatorEstimated > 0,
      gross: r.grossTotal,
      partnerFee: r.partnerFeeTotal,
      net,
      perFounder: net * founderShare,
    };
  });

  const splitRows: PodcastSplitRow[] = podcasts.map((p) => ({
    id: p.id,
    title: p.title,
    grossSharePct: Math.round(p.gross_share_pct * 1000) / 10,
    partnerFeePct: Math.round(p.partner_fee_pct * 1000) / 10,
  }));

  return (
    <div className="animate-rise space-y-10">
      <header className="pt-4 flex items-start justify-between gap-6 flex-wrap">
        <h1 className="text-[28px] font-semibold text-ink-900 tracking-tightish leading-tight">
          Profit
        </h1>
        <FounderShareControl
          value={Math.round(founderShare * 1000) / 10}
          disabled={!founderShareEnabled}
        />
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label={`${MONTH_LONG(thisMonthIso)} per founder`}
          value={fmtCurrency(thisMonthNet * founderShare)}
          hint={`${fmtCurrency(thisMonthNet)} company net · estimate`}
        />
        <StatCard
          label={
            lastFinalized
              ? `${MONTH_LONG(lastFinalized.month)} per founder`
              : "Last confirmed per founder"
          }
          value={fmtCurrency(lastFinalizedNet * founderShare)}
          hint={`${fmtCurrency(lastFinalizedNet)} company net · finalized`}
        />
        <StatCard
          label="YTD per founder"
          value={fmtCurrency(ytdNet * founderShare)}
          hint={`${fmtCurrency(ytdNet)} company net${
            ytdNetEstimated > 0 ? " (incl. estimate)" : ""
          }`}
        />
      </div>

      <section className="space-y-4">
        <h2 className="text-[15px] font-semibold text-ink-900 tracking-tightish">
          Monthly per founder
        </h2>
        <Card>
          <CardBody className="p-7">
            {chart.length === 0 ? (
              <div className="h-[280px] flex items-center justify-center text-sm text-ink-500">
                No data yet. Run a sync from the Admin page to populate.
              </div>
            ) : (
              <EarningsBarChart data={chart} />
            )}
          </CardBody>
        </Card>
      </section>

      <section className="space-y-4">
        <h2 className="text-[15px] font-semibold text-ink-900 tracking-tightish">
          Breakdown
        </h2>
        <Card>
          <CardBody className="p-0">
            <ProfitTable rows={tableRows} />
          </CardBody>
        </Card>
      </section>

      <section className="space-y-4">
        <h2 className="text-[15px] font-semibold text-ink-900 tracking-tightish">
          Revenue splits per podcast
        </h2>
        <Card>
          <CardBody className="p-0">
            {!splitsEnabled ? (
              <div className="p-7 text-sm text-ink-500">
                Per-podcast splits aren&apos;t enabled yet. Apply the{" "}
                <code className="text-ink-700">podcast_splits</code> migration
                to your database, then refresh. Figures above use the default{" "}
                {Math.round(GROSS_SHARE_PCT * 100)}% /{" "}
                {Math.round(PARTNER_FEE_PCT * 100)}% split until then.
              </div>
            ) : splitRows.length === 0 ? (
              <div className="p-7 text-sm text-ink-500">
                No active podcasts yet. Run a sync from the Admin page.
              </div>
            ) : (
              <PodcastSplitsTable rows={splitRows} />
            )}
          </CardBody>
        </Card>
      </section>
    </div>
  );
}
