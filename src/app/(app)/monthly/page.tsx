import { redirect } from "next/navigation";
import { Card, CardBody } from "@/components/ui/Card";
import { StatCard } from "@/components/StatCard";
import {
  EarningsBarChart,
  type EarningsBarPoint,
} from "@/components/charts/EarningsBarChart";
import { EarningsTable, type EarningsTableRow } from "./EarningsTable";
import { getServerSession } from "@/lib/session-server";
import { createClient } from "@/lib/supabase/server";
import { readCachedEarnings } from "@/lib/cached-metrics";
import { fmtCurrency } from "@/lib/format";
import {
  startOfMonth,
  endOfMonth,
  startOfYear,
  parseISO,
  format,
  subYears,
} from "date-fns";
import { isoDate } from "@/lib/date-ranges";
import { isDemo, DEMO_METRICS, demoMonthlyEarnings } from "@/lib/demo";

export const dynamic = "force-dynamic";

const MONTH_SHORT = (iso: string) => format(parseISO(iso), "MMM yyyy");
const MONTH_LONG = (iso: string) => format(parseISO(iso), "MMMM yyyy");

export default async function RevenuePage() {
  const session = await getServerSession();
  if (!session) redirect("/pending");

  if (isDemo(session)) {
    return <DemoRevenue />;
  }

  const now = new Date();
  // Cover everything since 18 months back so we always show enough context.
  const queryStart = isoDate(startOfMonth(subYears(now, 1)));
  const queryEnd = isoDate(endOfMonth(now));
  const thisMonthIso = isoDate(startOfMonth(now));
  const ytdStart = isoDate(startOfYear(now));

  const supabase = createClient();
  const { data: pods } = await supabase
    .from("podcast")
    .select("id")
    .eq("active", true);
  const podIds = (pods ?? []).map((p) => p.id);

  const earnings = await readCachedEarnings(podIds, queryStart, queryEnd);

  // Aggregate to one row per month — total only, no premium-vs-ad split.
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

  const ascending = Array.from(map.values()).sort((a, b) =>
    a.month < b.month ? -1 : 1,
  );
  const descending = [...ascending].reverse();

  // Topline.
  const ytdRows = ascending.filter((r) => r.month >= ytdStart);
  const ytdConfirmed = ytdRows.reduce((s, r) => s + r.confirmed, 0);
  const ytdEstimated = ytdRows.reduce((s, r) => s + r.estimated, 0);
  const thisMonth = map.get(thisMonthIso);
  const thisMonthTotal =
    (thisMonth?.confirmed ?? 0) + (thisMonth?.estimated ?? 0);
  const lastFinalized = descending.find(
    (r) => r.month < thisMonthIso && r.confirmed > 0,
  );

  const chart: EarningsBarPoint[] = ascending.map((r) => ({
    month: MONTH_SHORT(r.month),
    confirmed: r.confirmed,
    estimated: r.estimated,
  }));
  const tableRows: EarningsTableRow[] = descending.map((r) => ({
    month: r.month,
    label: MONTH_LONG(r.month),
    confirmed: r.confirmed,
    estimated: r.estimated,
  }));

  return (
    <div className="animate-rise space-y-10">
      <header className="pt-4">
        <h1 className="text-[28px] font-semibold text-ink-900 tracking-tightish leading-tight">
          Revenue
        </h1>
        <p className="text-[14px] text-ink-500 mt-1.5 max-w-xl">
          Monthly earnings. Finalized months are solid; the current month is
          an estimate until the cycle closes.
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label={`${MONTH_LONG(thisMonthIso)} estimate`}
          value={fmtCurrency(thisMonthTotal)}
          hint="Provider forecast"
        />
        <StatCard
          label={
            lastFinalized
              ? `${MONTH_LONG(lastFinalized.month)} confirmed`
              : "Last confirmed"
          }
          value={fmtCurrency(lastFinalized?.confirmed ?? 0)}
          hint="Finalized"
        />
        <StatCard
          label="Year to date"
          value={fmtCurrency(ytdConfirmed + ytdEstimated)}
          hint={
            ytdEstimated > 0
              ? `${fmtCurrency(ytdConfirmed)} confirmed + ${fmtCurrency(ytdEstimated)} estimate`
              : format(now, "yyyy")
          }
        />
      </div>

      <section className="space-y-4">
        <h2 className="text-[15px] font-semibold text-ink-900 tracking-tightish">
          Monthly performance
        </h2>
        <Card>
          <CardBody className="p-7">
            {chart.length === 0 ? (
              <div className="h-[280px] flex items-center justify-center text-sm text-ink-500">
                No data yet. Sync from the Admin page to populate.
              </div>
            ) : (
              <EarningsBarChart data={chart} />
            )}
          </CardBody>
        </Card>
      </section>

      <section className="space-y-4">
        <h2 className="text-[15px] font-semibold text-ink-900 tracking-tightish">
          By month
        </h2>
        <Card>
          <CardBody className="p-0">
            <EarningsTable rows={tableRows} />
          </CardBody>
        </Card>
      </section>
    </div>
  );
}

/** Fake Revenue page for test/demo users. */
function DemoRevenue() {
  const chart: EarningsBarPoint[] = demoMonthlyEarnings(12);
  return (
    <div className="animate-rise space-y-10">
      <header className="pt-4">
        <h1 className="text-[28px] font-semibold text-ink-900 tracking-tightish leading-tight">
          Revenue
        </h1>
        <p className="text-[14px] text-ink-500 mt-1.5">
          Demo workspace — sample data only.
        </p>
      </header>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="This month" value={fmtCurrency(DEMO_METRICS.revenue)} hint="estimate" />
        <StatCard label="Last confirmed" value={fmtCurrency(DEMO_METRICS.revenuePrev)} hint="finalized" />
        <StatCard label="YTD" value={fmtCurrency(69 * 6)} hint="sample" />
      </div>
      <section className="space-y-4">
        <h2 className="text-[15px] font-semibold text-ink-900 tracking-tightish">
          Monthly revenue
        </h2>
        <Card>
          <CardBody className="p-7">
            <EarningsBarChart data={chart} />
          </CardBody>
        </Card>
      </section>
    </div>
  );
}
