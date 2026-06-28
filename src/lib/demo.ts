/**
 * Fake data for test/demo users.
 *
 * Demo accounts never touch real data (RLS gives them none); these values
 * just populate the dashboard so it looks alive in a demo. Everything is
 * built from the joke constants 67 / 69 so it's obviously not real.
 */

import type { Session } from "./permissions";

export function isDemo(session: Session): boolean {
  return session.isDemo === true;
}

/** Stable fake podcast list. IDs are non-UUID sentinels so nothing maps to
 *  a real row even if one leaked into a query. */
export const DEMO_PODCASTS = [
  { id: "demo-1", title: "Demo Show Alpha", author: "Test Network" },
  { id: "demo-2", title: "Demo Show Bravo", author: "Test Network" },
  { id: "demo-3", title: "Demo Show Charlie", author: "Test Network" },
];

/** Per-window fake metric totals — all 67/69-flavored. */
export const DEMO_METRICS = {
  streams: 6969,
  streamsPrev: 6700,
  revenue: 69,
  revenuePrev: 67,
  earnings: 67,
  earningsPrev: 69,
  rpm: 6.9,
  rpmPrev: 6.7,
  delivery: 6969,
};

/** A fake daily series for charts — flat-ish around 67/69. */
export function demoSeries(points: number): Array<{ date: string; streams: number }> {
  const out: Array<{ date: string; streams: number }> = [];
  for (let i = points - 1; i >= 0; i--) {
    out.push({ date: `D-${i}`, streams: i % 2 === 0 ? 69 : 67 });
  }
  return out;
}

/** Fake per-podcast monthly earnings rows for the Revenue page. */
export function demoMonthlyEarnings(months: number) {
  const labels: string[] = [];
  const now = new Date(2026, 5, 1); // fixed so output is deterministic
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    labels.push(
      d.toLocaleString("en-US", { month: "short", year: "numeric" }),
    );
  }
  return labels.map((month, i) => ({
    month,
    confirmed: i % 2 === 0 ? 69 : 67,
    estimated: i === labels.length - 1 ? 6.9 : 0,
  }));
}
