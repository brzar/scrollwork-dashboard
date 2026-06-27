"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";

export type ModeOption = {
  id: string;
  name: string;
  /** Default creator share as a percentage, e.g. 70. */
  defaultCreatorPct: number;
};

export type PodcastConfigRow = {
  id: string;
  title: string;
  monetizable: boolean;
  splitModeId: string | null;
  /** Creator-share override as a percentage, or null to use the mode default. */
  creatorSharePct: number | null;
};

type RowState = {
  monetizable: boolean;
  modeId: string;
  creator: string; // "" = use mode default
  saving: boolean;
  error: string | null;
  saved: boolean;
};

export function PodcastConfigTable({
  rows,
  modes,
}: {
  rows: PodcastConfigRow[];
  modes: ModeOption[];
}) {
  const router = useRouter();
  const [state, setState] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(
      rows.map((r) => [
        r.id,
        {
          monetizable: r.monetizable,
          modeId: r.splitModeId ?? "",
          creator: r.creatorSharePct == null ? "" : String(r.creatorSharePct),
          saving: false,
          error: null,
          saved: false,
        },
      ]),
    ),
  );

  const patch = (id: string, next: Partial<RowState>) =>
    setState((s) => ({ ...s, [id]: { ...s[id], ...next } }));

  const original = (id: string) => rows.find((r) => r.id === id)!;
  const isDirty = (id: string) => {
    const o = original(id);
    const st = state[id];
    const creatorNum = st.creator === "" ? null : Number(st.creator);
    return (
      st.monetizable !== o.monetizable ||
      (st.modeId || null) !== o.splitModeId ||
      creatorNum !== o.creatorSharePct
    );
  };

  async function save(id: string) {
    const st = state[id];
    let creator: number | null = null;
    if (st.creator !== "") {
      creator = Number(st.creator);
      if (!Number.isFinite(creator) || creator < 0 || creator > 100) {
        patch(id, { error: "Creator 0–100" });
        return;
      }
    }
    patch(id, { saving: true, error: null, saved: false });
    try {
      const res = await fetch(`/api/admin/podcasts/${id}/config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          monetizable: st.monetizable,
          split_mode_id: st.modeId || null,
          creator_share_pct: creator,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        patch(id, { saving: false, error: body.error ?? "Save failed" });
        return;
      }
      patch(id, { saving: false, saved: true });
      router.refresh();
    } catch {
      patch(id, { saving: false, error: "Network error" });
    }
  }

  const modeDefault = (modeId: string) =>
    modes.find((m) => m.id === modeId)?.defaultCreatorPct ?? null;

  return (
    <Table>
      <THead>
        <TR>
          <TH>Podcast</TH>
          <TH className="text-center">Monetizable</TH>
          <TH>Split mode</TH>
          <TH className="text-right">Creator %</TH>
          <TH className="text-right">&nbsp;</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((r) => {
          const st = state[r.id];
          const def = modeDefault(st.modeId);
          return (
            <TR key={r.id}>
              <TD className="font-medium text-ink-900">{r.title}</TD>
              <TD className="text-center">
                <input
                  type="checkbox"
                  checked={st.monetizable}
                  onChange={(e) =>
                    patch(r.id, {
                      monetizable: e.target.checked,
                      saved: false,
                      error: null,
                    })
                  }
                  className="h-4 w-4 accent-emerald-600 align-middle"
                  aria-label={`${r.title} monetizable`}
                />
              </TD>
              <TD>
                <select
                  value={st.modeId}
                  disabled={!st.monetizable}
                  onChange={(e) =>
                    patch(r.id, {
                      modeId: e.target.value,
                      saved: false,
                      error: null,
                    })
                  }
                  className="bg-panel rounded-lg text-[13.5px] px-2.5 py-2 h-9 text-ink-900 shadow-card focus:outline-none disabled:opacity-50 max-w-[220px]"
                >
                  <option value="">— none —</option>
                  {modes.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </TD>
              <TD className="text-right">
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  step={0.5}
                  disabled={!st.monetizable || !st.modeId}
                  value={st.creator}
                  placeholder={def == null ? "—" : `${def} (default)`}
                  onChange={(e) =>
                    patch(r.id, {
                      creator: e.target.value,
                      saved: false,
                      error: null,
                    })
                  }
                  className="w-32 text-right ml-auto tabular-nums disabled:opacity-50"
                />
              </TD>
              <TD className="text-right">
                <div className="flex items-center justify-end gap-2">
                  {st.error ? (
                    <span className="text-[12px] text-red-600">{st.error}</span>
                  ) : st.saved && !isDirty(r.id) ? (
                    <span className="text-[12px] text-emerald-600">Saved</span>
                  ) : null}
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={st.saving || !isDirty(r.id)}
                    onClick={() => save(r.id)}
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
