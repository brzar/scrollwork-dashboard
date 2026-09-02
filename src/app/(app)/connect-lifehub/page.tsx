"use client";

import { useState } from "react";
import { Card, CardBody } from "@/components/ui/Card";

/**
 * Approval page for Life Hub. The user confirms, we issue their personal
 * signed token and bounce back to the Life Hub app running on their Mac.
 */
export default function ConnectLifeHubPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/external/token", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.token) {
        setError(data.error ?? "Could not issue a token.");
        setBusy(false);
        return;
      }
      window.location.href = `http://localhost:3210/oauth/scrollwork/callback?token=${encodeURIComponent(
        data.token,
      )}`;
    } catch {
      setError("Something went wrong — try again.");
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto mt-16 max-w-md">
      <Card>
        <CardBody>
          <h1 className="text-lg font-semibold">Connect Life Hub</h1>
          <p className="mt-2 text-sm text-neutral-400">
            Life Hub (running on your computer) is asking to read your monthly
            revenue take from this dashboard. It gets a personal read-only
            token for your account — nothing else.
          </p>
          <button
            onClick={approve}
            disabled={busy}
            className="mt-5 w-full rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50"
          >
            {busy ? "Connecting…" : "Approve & return to Life Hub"}
          </button>
          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        </CardBody>
      </Card>
    </div>
  );
}
