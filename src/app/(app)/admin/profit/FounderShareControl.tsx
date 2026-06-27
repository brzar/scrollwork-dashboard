"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

/**
 * Edits the founder share — the % of company net each founder takes home.
 * Saves to app_settings via the founder-share API and refreshes the page
 * so the "per founder" figures recompute.
 */
export function FounderShareControl({
  value,
  disabled,
}: {
  /** Current founder share as a percentage, e.g. 50. */
  value: number;
  /** True when the migration hasn't been applied (column missing). */
  disabled?: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(String(value));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = Number(draft) !== value;

  async function save() {
    const n = Number(draft);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      setError("0–100 only");
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/admin/settings/founder-share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ founder_share_pct: n }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Save failed");
        setSaving(false);
        return;
      }
      setSaving(false);
      setSaved(true);
      router.refresh();
    } catch {
      setSaving(false);
      setError("Network error");
    }
  }

  if (disabled) {
    return (
      <p className="text-[13px] text-ink-500">
        Founder share is{" "}
        <span className="font-medium text-ink-900">{value}%</span>. Apply the{" "}
        <code className="text-ink-700">founder_share</code> migration to edit it.
      </p>
    );
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <label className="text-[13px] text-ink-600">
        Each founder takes
      </label>
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          max={100}
          step={0.5}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setSaved(false);
            setError(null);
          }}
          className="w-24 text-right tabular-nums"
        />
        <span className="text-[13px] text-ink-600">% of company net</span>
      </div>
      <Button
        size="sm"
        variant="secondary"
        disabled={saving || !dirty}
        onClick={save}
      >
        {saving ? "Saving…" : "Save"}
      </Button>
      {error ? (
        <span className="text-[12px] text-red-600">{error}</span>
      ) : saved && !dirty ? (
        <span className="text-[12px] text-emerald-600">Saved</span>
      ) : null}
    </div>
  );
}
