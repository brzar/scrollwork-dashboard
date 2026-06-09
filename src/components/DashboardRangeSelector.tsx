"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition } from "react";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import {
  ALL_PRESETS,
  PRESET_LABEL,
  type DateRangePreset,
} from "@/lib/date-ranges";

/**
 * Server-driven range selector. Picking a preset updates the URL's
 * `?range=` query param and triggers a soft router refresh, which causes
 * the server page to re-render with the new range.
 *
 * Reading current state from URL means the link is shareable / bookmarkable.
 */
export function DashboardRangeSelector({
  current,
  customStart,
  customEnd,
}: {
  current: DateRangePreset;
  customStart?: string;
  customEnd?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function push(updates: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  return (
    <div className="inline-flex items-center gap-2">
      <Select
        value={current}
        onChange={(e) => {
          const v = e.target.value as DateRangePreset;
          if (v === "custom") {
            push({ range: "custom" });
          } else {
            push({ range: v, start: null, end: null });
          }
        }}
        disabled={isPending}
        aria-label="Date range"
      >
        {ALL_PRESETS.map((p) => (
          <option key={p} value={p}>
            {PRESET_LABEL[p]}
          </option>
        ))}
      </Select>

      {current === "custom" ? (
        <>
          <Input
            type="date"
            value={customStart ?? ""}
            onChange={(e) => push({ start: e.target.value })}
            aria-label="Start date"
            disabled={isPending}
          />
          <span className="text-ink-400 text-sm">→</span>
          <Input
            type="date"
            value={customEnd ?? ""}
            onChange={(e) => push({ end: e.target.value })}
            aria-label="End date"
            disabled={isPending}
          />
        </>
      ) : null}

      {isPending ? (
        <span className="text-xs text-ink-400">Loading…</span>
      ) : null}
    </div>
  );
}
