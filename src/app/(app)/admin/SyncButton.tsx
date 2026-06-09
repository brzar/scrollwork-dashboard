"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

/**
 * Three-step sync:
 *   1. Refresh the Megaphone web session (best effort — skipped if no
 *      Playwright storage state exists yet).
 *   2. Sync podcasts via the CMS API.
 *   3. Sync metrics (delivery + earnings) into cached_metric.
 *
 * Each step shows its own progress label. Failure at any step is
 * surfaced inline; partial success is fine (e.g. refresh fails because
 * Playwright isn't installed, but the existing session is still valid →
 * podcasts + metrics still sync).
 */
export function SyncButton() {
  const router = useRouter();
  const [busy, setBusy] = useState<
    "idle" | "refresh" | "podcasts" | "metrics"
  >("idle");
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | {
        kind: "ok";
        podcasts: number;
        deliveryRows: number;
        earningsRows: number;
        failures: number;
        refreshed: boolean;
      }
    | { kind: "err"; message: string }
  >({ kind: "idle" });

  async function onClick() {
    setStatus({ kind: "idle" });
    try {
      // Step 1 — best-effort session refresh. We don't bail on failure.
      setBusy("refresh");
      const r0 = await fetch("/api/admin/megaphone-refresh", { method: "POST" });
      const refreshed = r0.ok;

      // Step 2 — podcasts.
      setBusy("podcasts");
      const r1 = await fetch("/api/admin/sync", { method: "POST" });
      const j1 = await r1.json().catch(() => ({}));
      if (!r1.ok) {
        setStatus({ kind: "err", message: j1.error ?? `Podcast sync failed (${r1.status})` });
        return;
      }

      // Step 3 — metrics.
      setBusy("metrics");
      const r2 = await fetch("/api/admin/sync-metrics", { method: "POST" });
      const j2 = await r2.json().catch(() => ({}));
      if (!r2.ok) {
        setStatus({ kind: "err", message: j2.error ?? `Metrics sync failed (${r2.status})` });
        return;
      }

      setStatus({
        kind: "ok",
        podcasts: j1.synced ?? 0,
        deliveryRows: j2.deliveryRows ?? 0,
        earningsRows: j2.earningsRows ?? 0,
        failures: Array.isArray(j2.failures) ? j2.failures.length : 0,
        refreshed,
      });
      router.refresh();
    } catch (e) {
      setStatus({ kind: "err", message: (e as Error).message });
    } finally {
      setBusy("idle");
    }
  }

  return (
    <div className="flex items-center gap-3">
      {status.kind === "ok" ? (
        <span className="text-xs text-emerald-700">
          {status.refreshed ? "Refreshed · " : ""}
          {status.podcasts} podcasts · {status.deliveryRows} delivery rows ·{" "}
          {status.earningsRows} earnings rows
          {status.failures > 0 ? ` · ${status.failures} failures` : ""}.
        </span>
      ) : null}
      {status.kind === "err" ? (
        <span className="text-xs text-red-600">{status.message}</span>
      ) : null}
      <Button onClick={onClick} disabled={busy !== "idle"}>
        {busy === "refresh"
          ? "Refreshing session…"
          : busy === "podcasts"
            ? "Syncing podcasts…"
            : busy === "metrics"
              ? "Syncing metrics…"
              : "Sync data"}
      </Button>
    </div>
  );
}
