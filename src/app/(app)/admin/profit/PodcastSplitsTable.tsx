"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";

export type PodcastSplitRow = {
  id: string;
  title: string;
  /** Gross share as a percentage, e.g. 30 for 30%. */
  grossSharePct: number;
  /** Partner fee as a percentage, e.g. 20 for 20%. */
  partnerFeePct: number;
};

type RowState = {
  gross: string;
  partner: string;
  saving: boolean;
  error: string | null;
  saved: boolean;
};

/**
 * Editable per-podcast revenue splits. Each row holds its own draft state
 * and saves independently via PATCH /api/admin/podcasts/[id]/splits.
 * On success we refresh the route so the figures above recompute.
 */
export function PodcastSplitsTable({ rows }: { rows: PodcastSplitRow[] }) {
  const router = useRouter();
  const [state, setState] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(
      rows.map((r) => [
        r.id,
        {
          gross: String(r.grossSharePct),
          partner: String(r.partnerFeePct),
          saving: false,
          error: null,
          saved: false,
        },
      ]),
    ),
  );

  const patch = (id: string, next: Partial<RowState>) =>
    setState((s) => ({ ...s, [id]: { ...s[id], ...next } }));

  const isDirty = (r: PodcastSplitRow) => {
    const st = state[r.id];
    return (
      Number(st.gross) !== r.grossSharePct ||
      Number(st.partner) !== r.partnerFeePct
    );
  };

  const validate = (st: RowState): string | null => {
    const g = Number(st.gross);
    const p = Number(st.partner);
    if (!Number.isFinite(g) || !Number.isFinite(p)) return "Enter numbers";
    if (g < 0 || g > 100) return "Gross must be 0–100";
    if (p < 0 || p > 100) return "Partner must be 0–100";
    return null;
  };

  async function save(r: PodcastSplitRow) {
    const st = state[r.id];
    const err = validate(st);
    if (err) {
      patch(r.id, { error: err, saved: false });
      return;
    }
    patch(r.id, { saving: true, error: null, saved: false });
    try {
      const res = await fetch(`/api/admin/podcasts/${r.id}/splits`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gross_share_pct: Number(st.gross),
          partner_fee_pct: Number(st.partner),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        patch(r.id, {
          saving: false,
          error: body.error ?? "Save failed",
        });
        return;
      }
      patch(r.id, { saving: false, saved: true });
      router.refresh();
    } catch {
      patch(r.id, { saving: false, error: "Network error" });
    }
  }

  return (
    <Table>
      <THead>
        <TR>
          <TH>Podcast</TH>
          <TH className="text-right">Gross share %</TH>
          <TH className="text-right">Partner fee %</TH>
          <TH className="text-right">Creator keeps</TH>
          <TH className="text-right">&nbsp;</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((r) => {
          const st = state[r.id];
          const creatorKeeps = Number.isFinite(Number(st.gross))
            ? Math.max(0, 100 - Number(st.gross))
            : 0;
          return (
            <TR key={r.id}>
              <TD className="font-medium text-ink-900">{r.title}</TD>
              <TD className="text-right">
                <NumberCell
                  value={st.gross}
                  onChange={(v) =>
                    patch(r.id, { gross: v, saved: false, error: null })
                  }
                />
              </TD>
              <TD className="text-right">
                <NumberCell
                  value={st.partner}
                  onChange={(v) =>
                    patch(r.id, { partner: v, saved: false, error: null })
                  }
                />
              </TD>
              <TD className="text-right tabular-nums text-ink-600">
                {creatorKeeps}%
              </TD>
              <TD className="text-right">
                <div className="flex items-center justify-end gap-2">
                  {st.error ? (
                    <span className="text-[12px] text-red-600">{st.error}</span>
                  ) : st.saved && !isDirty(r) ? (
                    <span className="text-[12px] text-emerald-600">Saved</span>
                  ) : null}
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={st.saving || !isDirty(r)}
                    onClick={() => save(r)}
                  >
                    {st.saving ? "Saving…" : "Save"}
                  </Button>
                </div>
              </TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}

function NumberCell({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Input
      type="number"
      inputMode="decimal"
      min={0}
      max={100}
      step={0.1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-24 text-right ml-auto tabular-nums"
    />
  );
}
