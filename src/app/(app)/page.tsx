import { redirect } from "next/navigation";
import { Card, CardBody } from "@/components/ui/Card";
import { MetricCard, buildMetric } from "@/components/MetricCard";
import { AreaTrendChart } from "@/components/charts/AreaTrendChart";
import { getServerSession } from "@/lib/session-server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readCachedDelivery } from "@/lib/cached-metrics";
import {
  computeCpmByPodcast,
  computeOrgCpm,
  applyCpm,
} from "@/lib/cpm-estimate";
import { fmtCurrency, fmtCompact } from "@/lib/format";
import { CREATOR_SHARE_PCT } from "@/lib/profit";
import {
  computeSplit,
  effectiveCreatorShare,
  parseBeneficiaries,
  type SplitMode,
} from "@/lib/split";
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
  // Podcast config is RLS-scoped to what this user can see. Resilient to
  // the split-mode columns not being migrated in yet.
  type PodCfg = {
    id: string;
    monetizable: boolean;
    split_mode_id: string | null;
    creator_share_pct: number | null;
  };
  let podCfgs: PodCfg[] = [];
  const withCfg = await supabase
    .from("podcast")
    .select("id, monetizable, split_mode_id, creator_share_pct")
    .eq("active", true);
  if (withCfg.error) {
    const basic = await supabase.from("podcast").select("id").eq("active", true);
    podCfgs = (basic.data ?? []).map((p) => ({
      id: p.id,
      monetizable: true,
      split_mode_id: null,
      creator_share_pct: null,
    }));
  } else {
    podCfgs = withCfg.data ?? [];
  }
  const cfgById = new Map(podCfgs.map((p) => [p.id, p]));
  const podIds = podCfgs.map((p) => p.id);

  // Split-mode templates live in an admin-RLS table, so read them with the
  // service-role client (safe — they're not user-specific, and we only
  // apply them to podcasts the user already sees). Empty if unmigrated.
  const modeById = new Map<string, SplitMode>();
  try {
    const admin = createAdminClient();
    const modesRes = await admin
      .from("split_mode")
      .select(
        "id, name, portal, portal_fee_pct, default_creator_share_pct, beneficiaries",
      );
    for (const m of modesRes.data ?? []) {
      modeById.set(m.id, {
        id: m.id,
        name: m.name,
        portal: m.portal,
        portalFeePct: m.portal_fee_pct,
        defaultCreatorSharePct: m.default_creator_share_pct,
        beneficiaries: parseBeneficiaries(m.beneficiaries),
      });
    }
  } catch {
    // No modes available — falls back to the flat creator share below.
  }

  const [{ rows: all }, cpmByPodcast] = await Promise.all([
    readCachedDelivery(podIds, queryFromIso, isoDate(now)),
    computeCpmByPodcast(podIds, now),
  ]);
  const orgCpm = computeOrgCpm(cpmByPodcast);

  // Per-podcast revenue split into the current vs. prior window, so we can
  // apply each show's split when computing personalized earnings.
  const revByPodcast = new Map<string, { cur: number; prior: number }>();

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
    const rev = applyCpm(dlCount, eff);
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
    day.revenue += rev;
    byDate.set(r.date, day);

    // Per-podcast revenue, classified into the current/prior window.
    const inCur = isAllTime || r.date >= isoDate(currentStart);
    const inPrior =
      !isAllTime &&
      r.date >= isoDate(priorStart!) &&
      r.date <= isoDate(priorEnd!);
    if (inCur || inPrior) {
      const e = revByPodcast.get(r.podcastId) ?? { cur: 0, prior: 0 };
      if (inCur) e.cur += rev;
      if (inPrior) e.prior += rev;
      revByPodcast.set(r.podcastId, e);
    }
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

        // "Your earnings" is relative to who's logged in:
        //  - a partner/owner (has a partner identity like Jonathan/King)
        //    sees their own payout across every show, via the split modes.
        //  - everyone else (creators/viewers) sees the creator share of the
        //    podcasts they have access to.
        const viewerName = session.partnerName;
        const earningsFor = (podRev: number, cfg: PodCfg | undefined): number => {
          if (podRev <= 0) return 0;
          if (cfg && cfg.monetizable === false) return 0;
          const mode = cfg?.split_mode_id
            ? modeById.get(cfg.split_mode_id)
            : undefined;
          if (viewerName) {
            if (!mode) return 0;
            return (
              computeSplit(podRev, mode, cfg?.creator_share_pct).payouts[
                viewerName
              ] ?? 0
            );
          }
          const share = mode
            ? effectiveCreatorShare(mode, cfg?.creator_share_pct)
            : CREATOR_SHARE_PCT;
          return podRev * share;
        };
        let curEarnings = 0;
        let priorEarnings = 0;
        for (const [pid, rev] of revByPodcast) {
          const cfg = cfgById.get(pid);
          curEarnings += earningsFor(rev.cur, cfg);
          priorEarnings += earningsFor(rev.prior, cfg);
        }
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
