"use client";

import { useState } from "react";

/**
 * Dark-mode switch for super-admins. Optimistic UI on click — the
 * server response writes a cookie + DB row, then a full page reload
 * picks up the new `dark` class on <html> without FOUC.
 *
 * Visual is a Linear-style segmented control (Light | Dark) with the
 * selected option in the ink-900 pill — same primitive as the range
 * pills, kept lockstep so the dashboard reads as one system.
 */
export function ThemeToggle({ initial }: { initial: "light" | "dark" }) {
  const [value, setValue] = useState<"light" | "dark">(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setTheme(next: "light" | "dark") {
    if (next === value || busy) return;
    setBusy(true);
    setError(null);
    setValue(next); // optimistic
    try {
      const res = await fetch("/api/admin/settings/theme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dark_mode: next === "dark" }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Save failed (${res.status})`);
      }
      // Hard reload so the html element picks up the new class. SPA
      // navigation wouldn't re-run RootLayout, leaving the previous
      // theme stale until next full refresh.
      window.location.reload();
    } catch (e) {
      setValue(value); // revert
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <div className="inline-flex p-1 rounded-xl bg-canvas shadow-card text-[13px]">
        <button
          type="button"
          onClick={() => setTheme("light")}
          disabled={busy}
          aria-pressed={value === "light"}
          className={`px-3 py-1.5 rounded-lg font-medium transition-all duration-150 flex items-center gap-1.5 ${
            value === "light"
              ? "bg-ink-900 text-ink-50"
              : "text-ink-600 hover:text-ink-900"
          }`}
        >
          <IconSun /> Light
        </button>
        <button
          type="button"
          onClick={() => setTheme("dark")}
          disabled={busy}
          aria-pressed={value === "dark"}
          className={`px-3 py-1.5 rounded-lg font-medium transition-all duration-150 flex items-center gap-1.5 ${
            value === "dark"
              ? "bg-ink-900 text-ink-50"
              : "text-ink-600 hover:text-ink-900"
          }`}
        >
          <IconMoon /> Dark
        </button>
      </div>
      {error ? (
        <span className="text-[11px] text-red-600">{error}</span>
      ) : null}
    </div>
  );
}

function IconSun() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}
function IconMoon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
