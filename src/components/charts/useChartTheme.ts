"use client";

import { useEffect, useState } from "react";

/**
 * Reactively returns the current dashboard theme. Recharts can't read
 * CSS variables directly (stroke/fill take strings), so each chart
 * pulls a small palette object via this hook instead.
 *
 * Observes the html `.dark` class so a theme toggle re-renders charts
 * without a full reload.
 */
export function useChartTheme(): "light" | "dark" {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof document === "undefined") return "light";
    return document.documentElement.classList.contains("dark") ? "dark" : "light";
  });

  useEffect(() => {
    const update = () =>
      setTheme(
        document.documentElement.classList.contains("dark") ? "dark" : "light",
      );
    update();
    const obs = new MutationObserver(update);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => obs.disconnect();
  }, []);

  return theme;
}

export type ChartPalette = {
  grid: string;
  axis: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  brand: string;
  brandSoft: string;
  confirmed: string;
  estimated: string;
};

export const CHART_PALETTE: Record<"light" | "dark", ChartPalette> = {
  light: {
    grid: "#E4E4E7",
    axis: "#A1A1AA",
    tooltipBg: "#FFFFFF",
    tooltipBorder: "#E4E4E7",
    tooltipText: "#18181B",
    brand: "#7C3AED",
    brandSoft: "#A78BFA",
    confirmed: "#7C3AED",
    estimated: "#C4B5FD",
  },
  dark: {
    grid: "#2A2A2F",
    axis: "#71717A",
    tooltipBg: "#1F1F22",
    tooltipBorder: "#3F3F46",
    tooltipText: "#FAFAFA",
    brand: "#A78BFA",
    brandSoft: "#C4B5FD",
    confirmed: "#A78BFA",
    estimated: "#6D28D9",
  },
};
