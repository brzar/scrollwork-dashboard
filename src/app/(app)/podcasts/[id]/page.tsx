import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { StatCard } from "@/components/StatCard";
import { Badge } from "@/components/ui/Badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { Delta } from "@/components/Delta";
import { TrendChart } from "@/components/charts/TrendChart";
import { getServerSession } from "@/lib/session-server";
import { createClient } from "@/lib/supabase/server";
import { listEpisodes } from "@/lib/megaphone";
import { readCachedDelivery, readCachedEarnings } from "@/lib/cached-metrics";
import {
  computeCpmByPodcast,
  computeOrgCpm,
  applyCpm,
} from "@/lib/cpm-estimate";
import { fmtCurrency, fmtCompact, fmtNumber } from "@/lib/format";
import {
  startOfYear,
  startOfMonth,
  endOfMonth,
  subMonths,
  subDays,
  format,
  parseISO,
} from "date-fns";
import { isoDate } from "@/lib/date-ranges";

export const dynamic = "force-dynamic";

const MONTH_NAME = (iso: string) => format(parseISO(iso), "MMM yyyy");

export default async function PodcastDetail({
  params,
}: {
  params: { id: string };
}) {
  const session = await getServerSession();
  if (!session) redirect("/pending");

  const supabase = createClient();
  const { data: podcast } = await supabase
    .from("podcast")
    .select("id, megaphone_id, title, subtitle, author, image_url, active")
    .eq("id", params.id)
    .maybeSingle();
  if (!podcast) notFound();

  const now = new Date();
  const earningsFrom = isoDate(startOfYear(subMonths(now, 12)));
  const earningsTo = isoDate(endOfMonth(now));
  const last30Start = isoDate(subDays(now, 29));
  const prior30Start = isoDate(subDays(now, 59));
  const prior30End = isoDate(subDays(now, 30));

  const [earnings, delivery, cpmMap, episodes] = await Promise.all([
    readCachedEarnings([podcast.id], earningsFrom, earningsTo),
    readCachedDelivery([podcast.id], prior30Start, isoDate(now)),
    computeCpmByPodcast([podcast.id], now),
    listEpisodes(podcast.megaphone_id, { perPage: 15 }).catch(() => []),
  ]);

  const cpm = cpmMap.get(podcast.id) ?? {
    cpm: null as number | null,
    monthsUsed: [] as string[],
    totalRevenue: 0,
    totalDelivery: 0,
  };
  const orgCpm = computeOrgCpm(cpmMap);
  const effectiveCpm = cpm.cpm != null ? cpm : orgCpm;
  const usingFallback = cpm.cpm == null && orgCpm.cpm != null;

  // Per-month rollup for the table.
  type MonthRow = {
    month: string;
    confirmed: number;
    estimate: number;
    delivery: number;
  };
  const months = new Map<string, MonthRow>();
  for (const r of earnings.rows) {
    const row = months.get(r.date) ?? {
      month: r.date,
      confirmed: 0,
      estimate: 0,
      delivery: 0,
    };
    row.confirmed += Number(r.value?.total ?? 0);
    row.estimate += Number(r.value?.totalEstimated ?? 0);
    months.set(r.date, row);
  }

  // Fold delivery into the monthly rollup too (for the table).
  for (const r of delivery.rows) {
    const monthKey = format(startOfMonth(parseISO(r.date)), "yyyy-MM-dd");
    const row = months.get(monthKey) ?? {
      month: monthKey,
      confirmed: 0,
      estimate: 0,
      delivery: 0,
    };
    row.delivery += Number(r.value?.totalDelivery ?? 0);
    months.set(monthKey, row);
  }
  const monthlyRows = Array.from(months.values()).sort((a, b) =>
    a.month > b.month ? -1 : 1,
  );

  // Topline: YTD confirmed + this month estimate.
  const thisMonth = isoDate(startOfMonth(now));
  const ytdConfirmed = monthlyRows
    .filter((r) => r.month >= isoDate(startOfYear(now)))
    .reduce((s, r) => s + r.confirmed, 0);
  const thisMonthEstimate =
    monthlyRows.find((r) => r.month === thisMonth)?.estimate ?? 0;

  // Last-30-day delivery + per-period delta.
  type Day = { date: string; streams: number; downloads: number; delivery: number; revenue: number };
  const byDate = new Map<string, Day>();
  for (const r of delivery.rows) {
    const v = r.value ?? {};
    const dlCount = Number(v.totalDelivery ?? 0);
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
    day.revenue += applyCpm(dlCount, effectiveCpm);
    byDate.set(r.date, day);
  }
  const sortedDays = Array.from(byDate.values()).sort((a, b) =>
    a.date < b.date ? -1 : 1,
  );
  const cur = sortedDays.filter((d) => d.date >= last30Start);
  const prior = sortedDays.filter(
    (d) => d.date >= prior30Start && d.date <= prior30End,
  );
  const sum = (arr: Day[], k: keyof Day) =>
    arr.reduce((s, d) => s + (typeof d[k] === "number" ? (d[k] as number) : 0), 0);
  const cur30 = {
    streams: sum(cur, "streams"),
    delivery: sum(cur, "delivery"),
    revenue: sum(cur, "revenue"),
  };
  const prior30 = {
    streams: sum(prior, "streams"),
    delivery: sum(prior, "delivery"),
    revenue: sum(prior, "revenue"),
  };

  const chart = cur.map((d) => ({
    date: d.date.slice(5),
    streams: d.streams,
    delivery: d.delivery,
  }));

  return (
    <div className="animate-rise space-y-10">
      <header className="flex items-center gap-4 pt-4">
        {podcast.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={podcast.image_url}
            alt=""
            className="w-14 h-14 rounded-xl object-cover shadow-card"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="w-14 h-14 rounded-xl bg-ink-100 text-ink-500 flex items-center justify-center font-semibold shadow-card">
            {podcast.title.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h1 className="text-[28px] font-semibold text-ink-900 tracking-tightish leading-tight truncate">
            {podcast.title}
          </h1>
          <div className="text-xs text-ink-500 mt-1 flex items-center gap-1.5 flex-wrap">
            <span>{podcast.author ?? "Unknown author"}</span>
            {!podcast.active ? <Badge tone="neutral">inactive</Badge> : null}
            {cpm.cpm != null ? (
              <Badge tone="brand">CPM ${cpm.cpm.toFixed(2)} / 1k</Badge>
            ) : usingFallback ? (
              <Badge tone="warning">org CPM ${orgCpm.cpm!.toFixed(2)} (fallback)</Badge>
            ) : (
              <Badge tone="neutral">no CPM yet</Badge>
            )}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <StatCard
          label="YTD confirmed"
          value={fmtCurrency(ytdConfirmed)}
          hint={format(now, "yyyy")}
        />
        <StatCard
          label={`${format(now, "MMMM")} estimate`}
          value={fmtCurrency(thisMonthEstimate)}
          hint="Provider forecast"
        />
        <StatCard
          label="30d streams"
          value={fmtCompact(cur30.streams)}
        />
        <StatCard
          label="30d est. revenue"
          value={fmtCurrency(cur30.revenue)}
          hint="Per-podcast CPM"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Last 30 days vs prior 30</CardTitle>
        </CardHeader>
        <CardBody className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>Metric</TH>
                <TH className="text-right">Current</TH>
                <TH className="text-right">Prior</TH>
                <TH className="text-right">Change</TH>
              </TR>
            </THead>
            <TBody>
              <ComparisonRow label="Est. revenue" cur={cur30.revenue} prior={prior30.revenue} fmt={fmtCurrency} />
              <ComparisonRow label="Streams" cur={cur30.streams} prior={prior30.streams} fmt={fmtNumber} />
              <ComparisonRow label="Delivery" cur={cur30.delivery} prior={prior30.delivery} fmt={fmtNumber} />
            </TBody>
          </Table>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Streams · last 30 days</CardTitle>
        </CardHeader>
        <CardBody>
          {chart.length === 0 ? (
            <div className="h-[200px] flex items-center justify-center text-sm text-ink-500">
              No data in this range.
            </div>
          ) : (
            <TrendChart data={chart} dataKey="streams" label="Streams" height={200} />
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Month by month</CardTitle>
        </CardHeader>
        <CardBody className="p-0">
          {monthlyRows.length === 0 ? (
            <div className="p-6 text-sm text-ink-500 text-center">
              No data for this podcast yet.
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Month</TH>
                  <TH className="text-right">Confirmed</TH>
                  <TH className="text-right">Estimate</TH>
                  <TH className="text-right">Delivery</TH>
                </TR>
              </THead>
              <TBody>
                {monthlyRows.slice(0, 18).map((r) => (
                  <TR key={r.month}>
                    <TD className="font-medium">{MONTH_NAME(r.month)}</TD>
                    <TD className="text-right tabular-nums">
                      {r.confirmed > 0 ? fmtCurrency(r.confirmed) : "—"}
                    </TD>
                    <TD className="text-right tabular-nums text-ink-600">
                      {r.estimate > 0 ? fmtCurrency(r.estimate) : "—"}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {r.delivery > 0 ? fmtNumber(r.delivery) : "—"}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent episodes</CardTitle>
        </CardHeader>
        <CardBody className="p-0">
          {episodes.length === 0 ? (
            <div className="p-6 text-sm text-ink-500 text-center">
              No episodes returned.
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Episode</TH>
                  <TH>Published</TH>
                  <TH className="text-right">Duration</TH>
                </TR>
              </THead>
              <TBody>
                {episodes.map((ep) => (
                  <TR key={ep.id}>
                    <TD className="font-medium text-ink-900">{ep.title}</TD>
                    <TD className="text-ink-700">
                      {ep.pubdate ? ep.pubdate.slice(0, 10) : "—"}
                    </TD>
                    <TD className="text-right tabular-nums text-ink-700">
                      {ep.duration ? fmtDuration(ep.duration) : "—"}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <div className="text-xs text-ink-400 flex items-center gap-3">
        <Link href="/podcasts" className="hover:underline">
          ← All podcasts
        </Link>
      </div>
    </div>
  );
}

function ComparisonRow({
  label,
  cur,
  prior,
  fmt,
}: {
  label: string;
  cur: number;
  prior: number;
  fmt: (n: number) => string;
}) {
  return (
    <TR>
      <TD className="font-medium">{label}</TD>
      <TD className="text-right tabular-nums">{fmt(cur)}</TD>
      <TD className="text-right tabular-nums text-ink-600">{fmt(prior)}</TD>
      <TD className="text-right">
        <Delta current={cur} previous={prior} />
      </TD>
    </TR>
  );
}

function fmtDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
