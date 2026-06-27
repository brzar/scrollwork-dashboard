import { redirect } from "next/navigation";
import { Card, CardBody } from "@/components/ui/Card";
import { StatCard } from "@/components/StatCard";
import {
  EarningsBarChart,
  type EarningsBarPoint,
} from "@/components/charts/EarningsBarChart";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { getServerSession } from "@/lib/session-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/permissions";
import { readCachedEarnings } from "@/lib/cached-metrics";
import {
  OWNER_NAME,
  computeSplit,
  parseBeneficiaries,
  type SplitMode,
} from "@/lib/split";
import { fmtCurrency } from "@/lib/format";
import {
  startOfYear,
  startOfMonth,
  endOfMonth,
  subYears,
  parseISO,
  format,
} from "date-fns";
import { isoDate } from "@/lib/date-ranges";
import { ProfitTable, type ProfitTableRow } from "./ProfitTable";
import {
  PodcastConfigTable,
  type PodcastConfigRow,
  type ModeOption,
} from "./PodcastConfigTable";

export const dynamic = "force-dynamic";

const MONTH_SHORT = (iso: string) => format(parseISO(iso), "MMM yyyy");
const MONTH_LONG = (iso: string) => format(parseISO(iso), "MMMM yyyy");
const pctLabel = (frac: number) => Math.round(frac * 1000) / 10;

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

  // ---- Split modes -----------------------------------------------------
  // configEnabled flips false if the split-modes migration hasn't run yet;
  // we then show a banner and fall back to a revenue-only view.
  let configEnabled = true;
  let modes: SplitMode[] = [];
  const modesRes = await admin
    .from("split_mode")
    .select(
      "id, name, portal, portal_fee_pct, default_creator_share_pct, beneficiaries",
    )
    .order("name", { ascending: true });
  if (modesRes.error) {
    configEnabled = false;
  } else {
    modes = (modesRes.data ?? []).map((m) => ({
      id: m.id,
      name: m.name,
      portal: m.portal,
      portalFeePct: m.portal_fee_pct,
      defaultCreatorSharePct: m.default_creator_share_pct,
      beneficiaries: parseBeneficiaries(m.beneficiaries),
    }));
  }
  const modeById = new Map(modes.map((m) => [m.id, m]));

  // ---- Podcasts + config ----------------------------------------------
  type PodRow = {
    id: string;
    title: string;
    monetizable: boolean;
    split_mode_id: string | null;
    creator_share_pct: number | null;
  };
  let podcasts: PodRow[] = [];
  const withCfg = await admin
    .from("podcast")
    .select("id, title, monetizable, split_mode_id, creator_share_pct")
    .eq("active", true)
    .order("title", { ascending: true });
  if (withCfg.error) {
    configEnabled = false;
    const basic = await admin
      .from("podcast")
      .select("id, title")
      .eq("active", true)
      .order("title", { ascending: true });
    podcasts = (basic.data ?? []).map((p) => ({
      id: p.id,
      title: p.title,
      monetizable: true,
      split_mode_id: null,
      creator_share_pct: null,
    }));
  } else {
    podcasts = withCfg.data ?? [];
  }
  const cfgById = new Map(podcasts.map((p) => [p.id, p]));
  const podIds = podcasts.map((p) => p.id);

  const earnings = await readCachedEarnings(podIds, queryStart, queryEnd);

  // ---- Roll up ---------------------------------------------------------
  // Per month: revenue / creator / portal across monetizable, mode-assigned
  // podcasts. Payouts tracked per beneficiary (confirmed vs. estimated).
  type MonthAgg = {
    month: string;
    revConfirmed: number;
    revEstimated: number;
    creator: number;
    portal: number;
  };
  const monthAgg = new Map<string, MonthAgg>();
  const getMonth = (m: string): MonthAgg => {
    const r =
      monthAgg.get(m) ??
      ({
        month: m,
        revConfirmed: 0,
        revEstimated: 0,
        creator: 0,
        portal: 0,
      } satisfies MonthAgg);
    monthAgg.set(m, r);
    return r;
  };
  // name -> month -> { confirmed, estimated }
  const payouts = new Map<string, Map<string, { c: number; e: number }>>();
  const addPayout = (
    name: string,
    month: string,
    c: number,
    e: number,
  ) => {
    let byMonth = payouts.get(name);
    if (!byMonth) {
      byMonth = new Map();
      payouts.set(name, byMonth);
    }
    const cur = byMonth.get(month) ?? { c: 0, e: 0 };
    cur.c += c;
    cur.e += e;
    byMonth.set(month, cur);
  };

  for (const r of earnings.rows) {
    const cfg = cfgById.get(r.podcastId);
    if (!cfg || !cfg.monetizable) continue;
    const mode = cfg.split_mode_id
      ? modeById.get(cfg.split_mode_id)
      : undefined;
    if (!mode) continue; // unassigned — counted separately below
    const v = r.value ?? {};
    const confirmed = Number(v.total ?? 0);
    const estimated = Number(v.totalEstimated ?? 0);
    const sc = computeSplit(confirmed, mode, cfg.creator_share_pct);
    const se = computeSplit(estimated, mode, cfg.creator_share_pct);
    const agg = getMonth(r.date);
    agg.revConfirmed += confirmed;
    agg.revEstimated += estimated;
    agg.creator += sc.creator + se.creator;
    agg.portal += sc.portalFee + se.portalFee;
    const names = new Set([
      ...Object.keys(sc.payouts),
      ...Object.keys(se.payouts),
    ]);
    for (const name of names) {
      addPayout(name, r.date, sc.payouts[name] ?? 0, se.payouts[name] ?? 0);
    }
  }

  // Personalize "your take" to the logged-in user's partner identity
  // (King / Lazarus / Jonathan). Falls back to the owner when unmapped.
  const viewerName = session.partnerName ?? OWNER_NAME;
  const ownerByMonth = payouts.get(viewerName) ?? new Map();
  const ownerAt = (m: string) => {
    const x = ownerByMonth.get(m);
    return x ? x.c + x.e : 0;
  };

  const ascending = Array.from(monthAgg.values()).sort((a, b) =>
    a.month < b.month ? -1 : 1,
  );
  const descending = [...ascending].reverse();

  // ---- Topline (your take) --------------------------------------------
  const thisMonthOwner = ownerAt(thisMonthIso);
  const lastFinalized = descending.find(
    (r) => r.month < thisMonthIso && r.revConfirmed > 0,
  );
  const lastFinalizedOwner = lastFinalized
    ? ownerByMonth.get(lastFinalized.month)?.c ?? 0
    : 0;
  const ytdMonths = ascending.filter((r) => r.month >= ytdStart);
  const ytdOwner = ytdMonths.reduce((s, r) => s + ownerAt(r.month), 0);

  // ---- Chart (your take per month) ------------------------------------
  const chart: EarningsBarPoint[] = ascending.map((r) => {
    const o = ownerByMonth.get(r.month) ?? { c: 0, e: 0 };
    return { month: MONTH_SHORT(r.month), confirmed: o.c, estimated: o.e };
  });

  // ---- Breakdown table -------------------------------------------------
  const tableRows: ProfitTableRow[] = descending.map((r) => {
    const revenue = r.revConfirmed + r.revEstimated;
    const remaining = Math.max(0, revenue - r.creator - r.portal);
    const yourTake = ownerAt(r.month);
    return {
      month: r.month,
      label: MONTH_LONG(r.month),
      isEstimated: r.revConfirmed === 0 && r.revEstimated > 0,
      revenue,
      creator: r.creator,
      portal: r.portal,
      yourTake,
      partners: Math.max(0, remaining - yourTake),
    };
  });

  // ---- Payouts by person ----------------------------------------------
  const peopleRows = Array.from(payouts.entries())
    .map(([name, byMonth]) => {
      let thisMonth = 0;
      let ytd = 0;
      for (const [month, amt] of byMonth) {
        const total = amt.c + amt.e;
        if (month === thisMonthIso) thisMonth += total;
        if (month >= ytdStart) ytd += total;
      }
      return { name, thisMonth, ytd };
    })
    .sort((a, b) => b.ytd - a.ytd);

  // ---- Config table ----------------------------------------------------
  const modeOptions: ModeOption[] = modes.map((m) => ({
    id: m.id,
    name: m.name,
    defaultCreatorPct: pctLabel(m.defaultCreatorSharePct),
  }));
  const configRows: PodcastConfigRow[] = podcasts.map((p) => ({
    id: p.id,
    title: p.title,
    monetizable: p.monetizable,
    splitModeId: p.split_mode_id,
    creatorSharePct:
      p.creator_share_pct == null ? null : pctLabel(p.creator_share_pct),
  }));
  const unassignedCount = podcasts.filter(
    (p) => p.monetizable && !p.split_mode_id,
  ).length;

  return (
    <div className="animate-rise space-y-10">
      <header className="pt-4">
        <h1 className="text-[28px] font-semibold text-ink-900 tracking-tightish leading-tight">
          Profit
        </h1>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label={`${MONTH_LONG(thisMonthIso)} — your take`}
          value={fmtCurrency(thisMonthOwner)}
          hint="estimate"
        />
        <StatCard
          label={
            lastFinalized
              ? `${MONTH_LONG(lastFinalized.month)} — your take`
              : "Last confirmed — your take"
          }
          value={fmtCurrency(lastFinalizedOwner)}
          hint="finalized"
        />
        <StatCard
          label="YTD — your take"
          value={fmtCurrency(ytdOwner)}
          hint="confirmed + estimate"
        />
      </div>

      <section className="space-y-4">
        <h2 className="text-[15px] font-semibold text-ink-900 tracking-tightish">
          Monthly — your take
        </h2>
        <Card>
          <CardBody className="p-7">
            {chart.length === 0 ? (
              <div className="h-[280px] flex items-center justify-center text-sm text-ink-500">
                {configEnabled
                  ? "No revenue under an assigned split mode yet. Assign modes below."
                  : "No data yet. Run a sync from the Admin page to populate."}
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

      {peopleRows.length > 0 ? (
        <section className="space-y-4">
          <h2 className="text-[15px] font-semibold text-ink-900 tracking-tightish">
            Payouts by person
          </h2>
          <Card>
            <CardBody className="p-0">
              <Table>
                <THead>
                  <TR>
                    <TH>Person</TH>
                    <TH className="text-right">
                      {MONTH_LONG(thisMonthIso)}
                    </TH>
                    <TH className="text-right">YTD</TH>
                  </TR>
                </THead>
                <TBody>
                  {peopleRows.map((p) => (
                    <TR key={p.name}>
                      <TD className="font-medium text-ink-900">
                        {p.name}
                        {p.name === viewerName ? (
                          <span className="text-ink-400"> (you)</span>
                        ) : null}
                      </TD>
                      <TD className="text-right tabular-nums text-ink-700">
                        {p.thisMonth > 0 ? fmtCurrency(p.thisMonth) : "—"}
                      </TD>
                      <TD className="text-right tabular-nums font-semibold text-ink-900">
                        {p.ytd > 0 ? fmtCurrency(p.ytd) : "—"}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </CardBody>
          </Card>
        </section>
      ) : null}

      <section className="space-y-4">
        <h2 className="text-[15px] font-semibold text-ink-900 tracking-tightish">
          Podcast monetization
        </h2>
        <Card>
          <CardBody className="p-0">
            {!configEnabled ? (
              <div className="p-7 text-sm text-ink-500">
                Split modes aren&apos;t enabled yet. Apply the{" "}
                <code className="text-ink-700">split_modes</code> migration to
                your database, then refresh.
              </div>
            ) : configRows.length === 0 ? (
              <div className="p-7 text-sm text-ink-500">
                No active podcasts yet. Run a sync from the Admin page.
              </div>
            ) : (
              <>
                {unassignedCount > 0 ? (
                  <div className="px-5 py-3 text-[12.5px] text-amber-700 border-b border-ink-100">
                    {unassignedCount} monetizable{" "}
                    {unassignedCount === 1 ? "podcast has" : "podcasts have"} no
                    split mode and aren&apos;t counted in the figures above.
                  </div>
                ) : null}
                <PodcastConfigTable rows={configRows} modes={modeOptions} />
              </>
            )}
          </CardBody>
        </Card>
      </section>
    </div>
  );
}
