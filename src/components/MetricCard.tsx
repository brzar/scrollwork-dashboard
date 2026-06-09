import { Card } from "@/components/ui/Card";

export type MetricTone = "good" | "bad" | "same";

/**
 * Metric card. Big tabular number, label above, optional comparison
 * line below. Direction indicator is a small saturated circle with the
 * arrow inside — solid emerald for good, neutral ink for down. Reads
 * the same in both themes.
 */
export function MetricCard({
  label,
  value,
  indicator,
  comparison,
}: {
  label: string;
  value: string;
  /** Omit to render the card as a static total (no delta dot). */
  indicator?: MetricTone;
  comparison?: string;
}) {
  return (
    <Card className="p-6">
      <div className="text-[13px] font-medium text-ink-500">{label}</div>
      <div className="mt-3 flex items-center gap-2.5">
        <div className="text-3xl font-semibold text-ink-900 tracking-tightish tabular-nums leading-none">
          {value}
        </div>
        {indicator ? <DirectionDot tone={indicator} /> : null}
      </div>
      <div className="mt-2.5 text-[12.5px] text-ink-500">
        {comparison ?? "—"}
      </div>
    </Card>
  );
}

function DirectionDot({ tone }: { tone: MetricTone }) {
  // Refined emerald — closer to Vercel / Linear (#15803D-ish) than
  // Bootstrap's stock green. Down tone is neutral ink, no red — most
  // dips aren't bad, they're variance.
  const styles: Record<MetricTone, string> = {
    good: "bg-[#10A85B] text-white",
    bad: "bg-ink-200 text-ink-700",
    same: "bg-[#10A85B] text-white",
  };
  return (
    <span
      className={`inline-flex items-center justify-center w-[18px] h-[18px] rounded-full shrink-0 ${styles[tone]}`}
      aria-hidden
    >
      <DeltaArrow tone={tone} />
    </span>
  );
}

function DeltaArrow({ tone }: { tone: MetricTone }) {
  const stroke = "currentColor";
  const common = {
    stroke,
    strokeWidth: 2.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (tone === "good") {
    return (
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
        <path d="M5 8.5V1.5M5 1.5L1.5 5M5 1.5L8.5 5" {...common} />
      </svg>
    );
  }
  if (tone === "bad") {
    return (
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
        <path d="M5 1.5V8.5M5 8.5L1.5 5M5 8.5L8.5 5" {...common} />
      </svg>
    );
  }
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <path d="M2 5l2.2 2.2L8 3.5" {...common} />
    </svg>
  );
}

// ----------------------------------------------------------------------------
// Helper for building the props from raw numbers.
// ----------------------------------------------------------------------------

const SAME_THRESHOLD_PCT = 5; // |delta| < 5% → "about the same"

export type BuildMetricInput = {
  current: number;
  previous: number;
  fmt: (n: number) => string;
  inverted?: boolean;
  vsLabel?: string;
};

export function buildMetric(input: BuildMetricInput): {
  indicator: MetricTone;
  comparison: string;
} {
  const { current, previous, fmt, inverted = false, vsLabel = "prior period" } =
    input;
  if (!Number.isFinite(previous) || previous === 0) {
    return { indicator: "same", comparison: `No ${vsLabel} data` };
  }
  const delta = current - previous;
  const pct = (delta / Math.abs(previous)) * 100;
  const aboutSame = Math.abs(pct) < SAME_THRESHOLD_PCT;
  let tone: MetricTone;
  if (aboutSame) tone = "same";
  else if ((delta > 0) !== inverted) tone = "good";
  else tone = "bad";

  if (aboutSame) {
    return { indicator: tone, comparison: `About the same as ${vsLabel}` };
  }
  const direction = delta > 0 ? "more" : "less";
  return {
    indicator: tone,
    comparison: `${fmt(Math.abs(delta))} ${direction} than ${vsLabel}`,
  };
}
