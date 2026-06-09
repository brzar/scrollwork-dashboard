"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { fmtCompact } from "@/lib/format";
import { useChartTheme, CHART_PALETTE } from "./useChartTheme";

export function TrendChart({
  data,
  dataKey,
  label,
  formatter,
  color,
  height = 240,
}: {
  data: Array<Record<string, number | string>>;
  dataKey: string;
  label: string;
  formatter?: (n: number) => string;
  color?: string;
  height?: number;
}) {
  const theme = useChartTheme();
  const p = CHART_PALETTE[theme];
  const lineColor = color ?? p.brand;
  const fmt = formatter ?? fmtCompact;
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={p.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            stroke={p.axis}
            tick={{ fontSize: 11, fill: p.axis }}
            tickLine={false}
            axisLine={false}
            minTickGap={24}
          />
          <YAxis
            stroke={p.axis}
            tick={{ fontSize: 11, fill: p.axis }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => fmt(v)}
            width={56}
          />
          <Tooltip
            contentStyle={{
              background: p.tooltipBg,
              border: `1px solid ${p.tooltipBorder}`,
              borderRadius: 10,
              fontSize: 12,
              color: p.tooltipText,
            }}
            itemStyle={{ color: p.tooltipText }}
            labelStyle={{ color: p.axis, marginBottom: 4 }}
            formatter={(v: any) => [fmt(Number(v)), label]}
          />
          <Line
            type="monotone"
            dataKey={dataKey}
            stroke={lineColor}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: lineColor }}
            name={label}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
