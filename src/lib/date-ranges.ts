import { z } from "zod";
import {
  startOfDay,
  endOfDay,
  startOfMonth,
  endOfMonth,
  startOfYear,
  subDays,
  format,
} from "date-fns";

export type DateRangePreset =
  | "today"
  | "yesterday"
  | "last_7"
  | "last_30"
  | "last_90"
  | "mtd"
  | "ytd"
  | "last_12_months"
  | "all_time"
  | "custom";

export const PRESET_LABEL: Record<DateRangePreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  last_7: "Last 7 days",
  last_30: "Last 30 days",
  last_90: "Last 90 days",
  mtd: "Month to date",
  ytd: "Year to date",
  last_12_months: "Last 12 months",
  all_time: "All time",
  custom: "Custom",
};

export const ALL_PRESETS: DateRangePreset[] = [
  "today",
  "yesterday",
  "last_7",
  "last_30",
  "last_90",
  "mtd",
  "ytd",
  "last_12_months",
  "all_time",
  "custom",
];

/** Earliest date the dashboard ever queries. "All time" snaps to this. */
const ALL_TIME_START = new Date("2020-01-01");

export type DateRange = { start: Date; end: Date };

/** Resolve a preset to a date range. Custom returns last 7d as a fallback. */
export function resolveRange(
  preset: DateRangePreset,
  now: Date = new Date(),
  custom?: { start: Date; end: Date },
): DateRange {
  switch (preset) {
    case "today":
      return { start: startOfDay(now), end: endOfDay(now) };
    case "yesterday": {
      const y = subDays(now, 1);
      return { start: startOfDay(y), end: endOfDay(y) };
    }
    case "last_7":
      return { start: startOfDay(subDays(now, 6)), end: endOfDay(now) };
    case "last_30":
      return { start: startOfDay(subDays(now, 29)), end: endOfDay(now) };
    case "last_90":
      return { start: startOfDay(subDays(now, 89)), end: endOfDay(now) };
    case "mtd":
      return { start: startOfMonth(now), end: endOfDay(now) };
    case "ytd":
      return { start: startOfYear(now), end: endOfDay(now) };
    case "last_12_months":
      return { start: startOfDay(subDays(now, 364)), end: endOfDay(now) };
    case "all_time":
      return { start: ALL_TIME_START, end: endOfDay(now) };
    case "custom":
      if (custom) {
        return { start: startOfDay(custom.start), end: endOfDay(custom.end) };
      }
      return { start: startOfDay(subDays(now, 6)), end: endOfDay(now) };
  }
}

/** Format a date as 'yyyy-MM-dd' for Megaphone & API requests. */
export function isoDate(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

/**
 * Snap a date range to month boundaries. Used for Megaphone's earnings
 * endpoint, which only supports monthly buckets — start becomes the first
 * of the start month, end becomes the last day of the end month.
 */
export function alignToMonth(r: DateRange): DateRange {
  return { start: startOfMonth(r.start), end: endOfMonth(r.end) };
}

// ---- Zod schemas for API query parsing -----------------------------------

export const DateRangeQuery = z.object({
  preset: z
    .enum([
      "today",
      "yesterday",
      "last_7",
      "last_30",
      "last_90",
      "mtd",
      "ytd",
      "last_12_months",
      "all_time",
      "custom",
    ])
    .default("last_30"),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type DateRangeQueryInput = z.infer<typeof DateRangeQuery>;

export function rangeFromQuery(q: DateRangeQueryInput): DateRange {
  if (q.preset === "custom" && q.start && q.end) {
    return resolveRange("custom", new Date(), {
      start: new Date(q.start),
      end: new Date(q.end),
    });
  }
  return resolveRange(q.preset);
}
