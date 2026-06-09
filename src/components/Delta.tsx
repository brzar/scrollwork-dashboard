import { fmtDeltaPct } from "@/lib/format";

/**
 * Period-over-period delta indicator. Renders an up/down arrow with a
 * percent change, color-coded green (good) / red (bad) / gray (no change).
 *
 * `invert` flips the colors for metrics where "down is good" (e.g. ad
 * unsold rate). Defaults to false (up is good — revenue, downloads, etc).
 *
 * Returns null when previous is 0 or NaN (no meaningful comparison).
 */
export function Delta({
  current,
  previous,
  invert = false,
  showAbsolute = false,
  formatAbsolute,
}: {
  current: number;
  previous: number;
  invert?: boolean;
  showAbsolute?: boolean;
  formatAbsolute?: (n: number) => string;
}) {
  if (!Number.isFinite(previous) || previous === 0) {
    return (
      <span className="inline-flex items-center text-[11px] text-ink-400">
        —
      </span>
    );
  }

  const diff = current - previous;
  const pct = (diff / previous) * 100;

  // Treat ±0.05% as flat.
  const isFlat = Math.abs(pct) < 0.05;
  const goodWhenPositive = !invert;
  const isPositive = diff > 0;
  const tone = isFlat
    ? "flat"
    : isPositive === goodWhenPositive
      ? "good"
      : "bad";

  const toneClasses: Record<typeof tone, string> = {
    good: "text-emerald-700",
    bad: "text-red-600",
    flat: "text-ink-400",
  };

  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[11px] font-medium ${toneClasses[tone]}`}
      title={
        showAbsolute
          ? undefined
          : `from ${(formatAbsolute ?? String)(previous)}`
      }
    >
      {tone === "flat" ? (
        <DashIcon />
      ) : isPositive ? (
        <UpIcon />
      ) : (
        <DownIcon />
      )}
      {fmtDeltaPct(pct)}
      {showAbsolute && formatAbsolute ? (
        <span className="text-ink-500 font-normal ml-1">
          ({formatAbsolute(previous)})
        </span>
      ) : null}
    </span>
  );
}

function UpIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M5 8.5V1.5M5 1.5L1.5 5M5 1.5L8.5 5" />
    </svg>
  );
}
function DownIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M5 1.5V8.5M5 8.5L1.5 5M5 8.5L8.5 5" />
    </svg>
  );
}
function DashIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M2 5H8" />
    </svg>
  );
}
