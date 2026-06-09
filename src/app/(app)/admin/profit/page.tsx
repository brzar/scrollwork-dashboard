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
  FOUNDER_COUNT,
  FOUNDER_SHARE_PCT,
  GROSS_SHARE_PCT,
  PARTNER_FEE_PCT,
  splitRevenue,
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
  const { data: pods } = await admin
    .from("podcast")
    .select("id")
    .eq("active", true);
  const podIds = (pods ?? []).map((p) => p.id);

  const earnings = await readCachedEarnings(podIds, queryStart, queryEnd);

  // Roll up creator revenue per month.
  type Row = { month: string; confirmed: number; estimated: number };
  const map = new Map<string, Row>();
  const get = (m: string): Row => {
    const r = map.get(m) ?? { month: m, confirmed: 0, estimated: 0 };
    map.set(m, r);
    return r;
  };
  for (const r of earnings.rows) {
    const v = r.value ?? {};
    const row = get(r.date);
    row.confirmed += Number(v.total ?? 0);
    row.estimated += Number(v.totalEstimated ?? 0);
  }

  // Ascending for the chart, descending for the table.
  const ascending = Array.from(map.values()).sort((a, b) =>
    a.month < b.month ? -1 : 1,
  );
  const descending = [...ascending].reverse();

  // ---- Topline ---------------------------------------------------------
  const thisMonth = map.get(thisMonthIso);
  const thisMonthCreator =
    (thisMonth?.confirmed ?? 0) + (thisMonth?.estimated ?? 0);
  const thisMonthNet = splitRevenue(thisMonthCreator).net;

  const lastFinalized = descending.find(
    (r) => r.month < thisMonthIso && r.confirmed > 0,
  );
  const lastFinalizedNet = lastFinalized
    ? splitRevenue(lastFinalized.confirmed).net
    : 0;

  const ytdRows = ascending.filter((r) => r.month >= ytdStart);
  const ytdConfirmed = ytdRows.reduce((s, r) => s + r.confirmed, 0);
  const ytdEstimated = ytdRows.reduce((s, r) => s + r.estimated, 0);
  const ytdNetConfirmed = splitRevenue(ytdConfirmed).net;
  const ytdNetEstimated = splitRevenue(ytdEstimated).net;
  const ytdNet = ytdNetConfirmed + ytdNetEstimated;

  // Chart shows per-founder take-home so it lines up with the topline
  // cards. Confirmed dark, estimated lighter on top.
  const chart: EarningsBarPoint[] = ascending.map((r) => ({
    month: MONTH_SHORT(r.month),
    confirmed: splitRevenue(r.confirmed).perFounder,
    estimated: splitRevenue(r.estimated).perFounder,
  }));

  const tableRows: ProfitTableRow[] = descending.map((r) => ({
    month: r.month,
    label: MONTH_LONG(r.month),
    confirmed: r.confirmed,
    estimated: r.estimated,
  }));

  return (
    <div className="animate-rise space-y-10">
      <header className="pt-4">
        <h1 className="text-[28px] font-semibold text-ink-900 tracking-tightish leading-tight">
          Profit
        </h1>
        <p className="text-[14px] text-ink-500 mt-1.5 max-w-2xl">
          What each founder keeps. We take{" "}
          <span className="font-medium text-ink-900">
            {Math.round(GROSS_SHARE_PCT * 100)}%
          </span>{" "}
          of creator revenue,{" "}
          <span className="font-medium text-ink-900">
            {Math.round(PARTNER_FEE_PCT * 100)}%
          </span>{" "}
          of that goes to partners, and the company net splits{" "}
          <span className="font-medium text-ink-900">
            {FOUNDER_COUNT} ways evenly
          </span>{" "}
          between founders.
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label={`${MONTH_LONG(thisMonthIso)} per founder`}
          value={fmtCurrency(thisMonthNet * FOUNDER_SHARE_PCT)}
          hint={`${fmtCurrency(thisMonthNet)} company net · estimate`}
        />
        <StatCard
          label={
            lastFinalized
              ? `${MONTH_LONG(lastFinalized.month)} per founder`
              : "Last confirmed per founder"
          }
          value={fmtCurrency(lastFinalizedNet * FOUNDER_SHARE_PCT)}
          hint={`${fmtCurrency(lastFinalizedNet)} company net · finalized`}
        />
        <StatCard
          label="YTD per founder"
          value={fmtCurrency(ytdNet * FOUNDER_SHARE_PCT)}
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
    </div>
  );
}
