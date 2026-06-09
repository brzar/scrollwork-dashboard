import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardBody } from "@/components/ui/Card";
import { MetricCard, buildMetric } from "@/components/MetricCard";
import { AreaTrendChart } from "@/components/charts/AreaTrendChart";
import { getServerSession } from "@/lib/session-server";
import { createClient } from "@/lib/supabase/server";
import { readCachedDelivery } from "@/lib/cached-metrics";
import {
  computeCpmByPodcast,
  computeOrgCpm,
  applyCpm,
} from "@/lib/cpm-estimate";
import { fmtCurrency, fmtCompact } from "@/lib/format";
import { CREATOR_SHARE_PCT } from "@/lib/profit";
import { subDays, format, parseISO } from "date-fns";
import { isoDate } from "@/lib/date-ranges";

export const dynamic = "force-dynamic";

type Range = "last_7" | "last_30" | "last_90" | "all_time";
const VALID_RANGES = new Set<Range>(["last_7", "last_30", "last_90", "all_time"]);
// Floor for the "all time" query. cached_metric was first populated in
// 2026 — pick something safely older so we never clip real data.
const ALL_TIME_FLOOR = "2020-01-01";

export default async function Overview({
  searchParams,
}: {
  searchParams: { range?: string };
}) {
  const session = await getServerSession();
  if (!session) redirect("/pending");

  const range: Range = VALID_RANGES.has(searchParams.range as Range)
    ? (searchParams.range as Range)
    : "last_30";
  const isAllTime = range === "all_time";
  const N = range === "last_7" ? 7 : range === "last_90" ? 90 : 30;
  const vsLabel = `prior ${N} days`;

  const now = new Date();
  // For windowed ranges we fetch [priorStart .. now] so we can compute
  // the delta against the previous N days. For all-time we fetch from
  // the floor and skip the comparison entirely (no meaningful "prior
  // all time").
  const currentStart = isAllTime ? new Date(ALL_TIME_FLOOR) : subDays(now, N - 1);
  const priorEnd = isAllTime ? null : subDays(currentStart, 1);
  const priorStart = isAllTime ? null : subDays(priorEnd!, N - 1);
  const queryFromIso = isAllTime ? ALL_TIME_FLOOR : isoDate(priorStart!);

  const supabase = createClient();
  const { data: podcasts } = await supabase
    .from("podcast")
    .select("id")
    .eq("active", true);
  const podIds = (podcasts ?? []).map((p) => p.id);

  const [{ rows: all }, cpmByPodcast] = await Promise.all([
    readCachedDelivery(podIds, queryFromIso, isoDate(now)),
    computeCpmByPodcast(podIds, now),
  ]);
  const orgCpm = computeOrgCpm(cpmByPodcast);

  type Day = {
    date: string;
    streams: number;
    downloads: number;
    delivery: number;
    revenue: number;
  };
  const byDate = new Map<string, Day>();
  for (const r of all) {
    const v = r.value ?? {};
    const dlCount = Number(v.totalDelivery ?? 0);
    const podCpm = cpmByPodcast.get(r.podcastId);
    const eff = podCpm?.cpm != null ? podCpm : orgCpm;
    const day = byDate.get(r.date) ?? {
      date: r.date,
      streams: 0,
      downloads: 0,
      delivery: 0,
      revenue: 0,
    };
    day.streams += Number(v.totalStreams ?? 0);
    day.downloads += Number(v.totalDownloads ?? 0);
    day.delivery += dlCount;
    day.revenue += applyCpm(dlCount, eff);
    byDate.set(r.date, day);
  }

  const sorted = Array.from(byDate.values()).sort((a, b) =>
    a.date < b.date ? -1 : 1,
  );
  const curDays = isAllTime
    ? sorted
    : sorted.filter((d) => d.date >= isoDate(currentStart));
  const priorDays = isAllTime
    ? []
    : sorted.filter(
        (d) => d.date >= isoDate(priorStart!) && d.date <= isoDate(priorEnd!),
      );
  const sum = (arr: Day[], k: keyof Day) =>
    arr.reduce((s, d) => s + (typeof d[k] === "number" ? (d[k] as number) : 0), 0);

  const cur = {
    delivery: sum(curDays, "delivery"),
    streams: sum(curDays, "streams"),
    downloads: sum(curDays, "downloads"),
    revenue: sum(curDays, "revenue"),
  };
  const prior = {
    delivery: sum(priorDays, "delivery"),
    streams: sum(priorDays, "streams"),
    downloads: sum(priorDays, "downloads"),
    revenue: sum(priorDays, "revenue"),
  };

  // For windowed ranges we label every day. For all-time, daily labels
  // become unreadable past a few months, so switch to "MMM yyyy" — the
  // minTickGap on the chart axis still thins them out further.
  const labelFmt = isAllTime ? "MMM yyyy" : "MMM d";
  const chart = curDays.map((d) => ({
    date: format(parseISO(d.date), labelFmt),
    streams: d.streams,
  }));

  return (
    <div className="animate-rise space-y-10">
      <header className="flex items-end justify-between gap-6 flex-wrap pt-4">
        <div>
          <h1 className="text-[28px] font-semibold text-ink-900 tracking-tightish leading-tight">
            Overview
          </h1>
          <p className="text-[14px] text-ink-500 mt-1.5">
            {isAllTime
              ? "All-time totals across every podcast you have access to."
              : `${rangeLabel(range)}, compared to the ${N} days before.`}
          </p>
        </div>
        <RangePills current={range} />
      </header>

      {(() => {
        // RPM = revenue per 1000 streams. The rate that ties delivery
        // to dollars — what creators expect to see on a podcast
        // dashboard. We project it for both windows so deltas work.
        const rpm = (rev: number, streams: number) =>
          streams > 0 ? (rev * 1000) / streams : 0;
        const curEarnings = cur.revenue * CREATOR_SHARE_PCT;
        const priorEarnings = prior.revenue * CREATOR_SHARE_PCT;
        const curRpm = rpm(cur.revenue, cur.streams);
        const priorRpm = rpm(prior.revenue, prior.streams);
        // For all-time, every prior window is empty by construction —
        // there's no "prior all time." Hide the delta dot and show a
        // simple "All time" footer so the cards read as totals, not
        // deltas.
        const totalProps = { indicator: undefined, comparison: "All time" };
        return (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              label="Streams"
              value={fmtCompact(cur.streams)}
              {...(isAllTime
                ? totalProps
                : buildMetric({
                    current: cur.streams,
                    previous: prior.streams,
                    fmt: fmtCompact,
                    vsLabel,
                  }))}
            />
            <MetricCard
              label="Est. revenue"
              value={fmtCurrency(cur.revenue)}
              {...(isAllTime
                ? totalProps
                : buildMetric({
                    current: cur.revenue,
                    previous: prior.revenue,
                    fmt: fmtCurrency,
                    vsLabel,
                  }))}
            />
            <MetricCard
              label="Your earnings"
              value={fmtCurrency(curEarnings)}
              {...(isAllTime
                ? totalProps
                : buildMetric({
                    current: curEarnings,
                    previous: priorEarnings,
                    fmt: fmtCurrency,
                    vsLabel,
                  }))}
            />
            <MetricCard
              label="RPM"
              value={fmtCurrency(curRpm)}
              {...(isAllTime
                ? totalProps
                : buildMetric({
                    current: curRpm,
                    previous: priorRpm,
                    fmt: fmtCurrency,
                    vsLabel,
                  }))}
            />
          </div>
        );
      })()}

      <section className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[15px] font-semibold text-ink-900 tracking-tightish">
            Streams
          </h2>
          <span className="text-[12.5px] text-ink-500">{rangeLabel(range)}</span>
        </div>
        <Card>
          <CardBody className="p-7">
            {chart.length === 0 ? (
              <div className="h-[280px] flex items-center justify-center text-sm text-ink-500">
                No data yet. Run a sync from the Admin page to populate.
              </div>
            ) : (
              <AreaTrendChart data={chart} dataKey="streams" label="Streams" />
            )}
          </CardBody>
        </Card>
        <p className="text-[12px] text-ink-500">
          Revenue here is an estimate from each podcast's trailing CPM × recent
          delivery. Your earnings show {Math.round(CREATOR_SHARE_PCT * 100)}% of
          gross revenue. RPM is revenue per 1,000 streams.{" "}
          <Link
            href="/monthly"
            className="font-medium text-ink-900 hover:underline underline-offset-2"
          >
            Revenue
          </Link>{" "}
          has confirmed monthly totals.
        </p>
      </section>
    </div>
  );
}

function rangeLabel(r: Range) {
  switch (r) {
    case "last_7":
      return "last 7 days";
    case "last_30":
      return "last 30 days";
    case "last_90":
      return "last 90 days";
    case "all_time":
      return "all time";
  }
}

function RangePills({ current }: { current: Range }) {
  const items: Array<{ key: Range; label: string }> = [
    { key: "last_7", label: "7d" },
    { key: "last_30", label: "30d" },
    { key: "last_90", label: "90d" },
    { key: "all_time", label: "All time" },
  ];
  return (
    <div className="inline-flex p-1 rounded-xl bg-white shadow-card text-[13px]">
      {items.map((it) => (
        <a
          key={it.key}
          href={`/?range=${it.key}`}
          className={`px-3 py-1.5 rounded-lg font-medium tabular-nums transition-all duration-150 ${
            current === it.key
              ? "bg-ink-900 text-ink-50"
              : "text-ink-600 hover:text-ink-900"
          }`}
        >
          {it.label}
        </a>
      ))}
    </div>
  );
}
