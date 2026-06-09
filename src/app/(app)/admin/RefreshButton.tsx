"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

/**
 * Trigger /api/admin/megaphone-refresh — boots headless Playwright on the
 * server and writes fresh cookies into the megaphone_session row.
 * 5–15 seconds typical (Chromium boot + navigation + XHR capture).
 */
export function RefreshButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<
    { kind: "idle" } | { kind: "ok" } | { kind: "err"; message: string }
  >({ kind: "idle" });

  async function onClick() {
    setBusy(true);
    setStatus({ kind: "idle" });
    try {
      const res = await fetch("/api/admin/megaphone-refresh", { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus({ kind: "err", message: j.error ?? `HTTP ${res.status}` });
        return;
      }
      setStatus({ kind: "ok" });
      router.refresh();
    } catch (e) {
      setStatus({ kind: "err", message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="secondary" size="sm" onClick={onClick} disabled={busy}>
        {busy ? "Refreshing…" : "Refresh session"}
      </Button>
      {status.kind === "ok" ? (
        <span className="text-[11px] text-emerald-700">Refreshed.</span>
      ) : null}
      {status.kind === "err" ? (
        <span className="text-[11px] text-red-600 max-w-[12rem] text-right">
          {status.message}
        </span>
      ) : null}
    </div>
  );
}
