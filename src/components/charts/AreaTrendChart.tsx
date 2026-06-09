"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { fmtCompact } from "@/lib/format";
import { useChartTheme, CHART_PALETTE } from "./useChartTheme";

/**
 * Spotify-creators-style area chart: thin colored line on top of a
 * subtle gradient fill below. Theme-aware via `useChartTheme`.
 */
export function AreaTrendChart({
  data,
  dataKey,
  label,
  color,
  formatter,
  height = 280,
}: {
  data: Array<Record<string, number | string>>;
  dataKey: string;
  label: string;
  color?: string;
  formatter?: (n: number) => string;
  height?: number;
}) {
  const theme = useChartTheme();
  const p = CHART_PALETTE[theme];
  const lineColor = color ?? p.brand;
  const fmt = formatter ?? fmtCompact;
  const gradientId = `area-grad-${dataKey}-${theme}`;
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 12, right: 16, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={lineColor} stopOpacity={theme === "dark" ? 0.4 : 0.25} />
              <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={p.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            stroke={p.axis}
            tick={{ fontSize: 11, fill: p.axis }}
            tickLine={false}
            axisLine={false}
            minTickGap={32}
          />
          <YAxis
            stroke={p.axis}
            tick={{ fontSize: 11, fill: p.axis }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => fmt(v)}
            width={56}
            orientation="right"
          />
          <Tooltip
            contentStyle={{
              background: p.tooltipBg,
              border: `1px solid ${p.tooltipBorder}`,
              borderRadius: 10,
              fontSize: 12,
              color: p.tooltipText,
              boxShadow:
                theme === "dark"
                  ? "0 8px 24px -4px rgba(0,0,0,0.6)"
                  : "0 4px 12px -2px rgba(0,0,0,0.08)",
            }}
            itemStyle={{ color: p.tooltipText }}
            labelStyle={{ color: p.axis, marginBottom: 4 }}
            formatter={(v: any) => [fmt(Number(v)), label]}
          />
          <Area
            type="monotone"
            dataKey={dataKey}
            stroke={lineColor}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={false}
            activeDot={{ r: 4, fill: lineColor }}
            name={label}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
