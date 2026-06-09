import { Card } from "@/components/ui/Card";

/**
 * The default stat surface — big number, label, optional supporting hint.
 *
 * Modeled on Spotify-for-Creators: the number sits in the upper-left and
 * gets the visual weight (text-3xl, tightish tracking, tabular numerals).
 * Label is a small ink-500 line above; hint is a smaller ink-500 line
 * below. No eyebrow, no decorative icon, no chrome.
 */
export function StatCard({
  label,
  value,
  delta,
  hint,
}: {
  label: string;
  value: string;
  delta?: { value: string; positive?: boolean } | null;
  hint?: string;
}) {
  return (
    <Card className="p-6">
      <div className="text-[13px] font-medium text-ink-500">{label}</div>
      <div className="mt-3 flex items-baseline gap-2">
        <div className="text-3xl font-semibold text-ink-900 tracking-tightish tabular-nums leading-none">
          {value}
        </div>
        {delta ? (
          <div
            className={`text-xs font-medium ${
              delta.positive ? "text-emerald-700" : "text-red-700"
            }`}
          >
            {delta.value}
          </div>
        ) : null}
      </div>
      {hint ? (
        <div className="mt-2.5 text-[12.5px] text-ink-500">{hint}</div>
      ) : null}
    </Card>
  );
}
