"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { fmtCompact, fmtCurrency } from "@/lib/format";
import { useChartTheme, CHART_PALETTE } from "./useChartTheme";

export type EarningsBarPoint = {
  month: string;
  confirmed: number;
  estimated: number;
};

/**
 * Stacked monthly earnings: confirmed sits at the base in brand purple,
 * estimated stacks on top in a lighter brand tint so the in-progress
 * portion stays visually distinct. Theme-aware via CHART_PALETTE.
 */
export function EarningsBarChart({
  data,
  height = 280,
}: {
  data: EarningsBarPoint[];
  height?: number;
}) {
  const theme = useChartTheme();
  const p = CHART_PALETTE[theme];
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 16, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={p.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="month"
            stroke={p.axis}
            tick={{ fontSize: 11, fill: p.axis }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            stroke={p.axis}
            tick={{ fontSize: 11, fill: p.axis }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `$${fmtCompact(v)}`}
            width={64}
          />
          <Tooltip
            cursor={{ fill: theme === "dark" ? "rgba(255,255,255,0.04)" : "rgba(15,23,42,0.04)" }}
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
            formatter={(value: any, name: string) => [fmtCurrency(Number(value)), name]}
          />
          <Bar
            dataKey="confirmed"
            stackId="a"
            fill={p.confirmed}
            name="Confirmed"
            radius={[0, 0, 0, 0]}
          />
          <Bar
            dataKey="estimated"
            stackId="a"
            fill={p.estimated}
            name="Estimate"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
