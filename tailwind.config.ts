import type { Config } from "tailwindcss";

/**
 * Token system modeled on Linear / Spotify-for-Creators / Vercel.
 *
 * Colors are driven by CSS custom properties so dark mode is a single
 * class flip on <html>. The ink ramp is inverted under .dark (the
 * darkest light-mode token becomes the lightest dark-mode token), which
 * means most existing utility usage (text-ink-900, bg-ink-50, etc.)
 * "just works" in both themes without per-component dark: variants.
 */
const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Brand color stays committed across modes — purple reads on both
        // light and dark surfaces. We just shift weight in dark mode.
        brand: {
          DEFAULT: "rgb(var(--brand) / <alpha-value>)",
          dark: "rgb(var(--brand-dark) / <alpha-value>)",
          light: "rgb(var(--brand-light) / <alpha-value>)",
        },
        // Semantic surfaces. `canvas` = the page bg; `panel` = the
        // floating card surface. Both flip under .dark.
        canvas: "rgb(var(--canvas) / <alpha-value>)",
        panel: "rgb(var(--panel) / <alpha-value>)",
        // Ink ramp. Same usage from page code; CSS variables invert
        // under .dark so contrast direction is preserved.
        ink: {
          50: "rgb(var(--ink-50) / <alpha-value>)",
          100: "rgb(var(--ink-100) / <alpha-value>)",
          150: "rgb(var(--ink-150) / <alpha-value>)",
          200: "rgb(var(--ink-200) / <alpha-value>)",
          300: "rgb(var(--ink-300) / <alpha-value>)",
          400: "rgb(var(--ink-400) / <alpha-value>)",
          500: "rgb(var(--ink-500) / <alpha-value>)",
          600: "rgb(var(--ink-600) / <alpha-value>)",
          700: "rgb(var(--ink-700) / <alpha-value>)",
          800: "rgb(var(--ink-800) / <alpha-value>)",
          900: "rgb(var(--ink-900) / <alpha-value>)",
          950: "rgb(var(--ink-950) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: [
          "var(--font-inter)",
          "Inter",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
      borderRadius: {
        lg: "10px",
        xl: "14px",
        "2xl": "18px",
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(var(--shadow-drop) / var(--shadow-drop-alpha)), 0 0 0 1px rgb(var(--shadow-ring) / var(--shadow-ring-alpha))",
        "card-lg":
          "0 8px 24px -6px rgb(var(--shadow-drop) / calc(var(--shadow-drop-alpha) * 2)), 0 0 0 1px rgb(var(--shadow-ring) / calc(var(--shadow-ring-alpha) + 0.04))",
        button:
          "0 1px 2px 0 rgb(var(--shadow-drop) / var(--shadow-drop-alpha)), inset 0 0 0 1px rgb(var(--shadow-ring) / 0.06)",
      },
      letterSpacing: {
        tightish: "-0.012em",
      },
    },
  },
  plugins: [],
};

export default config;
