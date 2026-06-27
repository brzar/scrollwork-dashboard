"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { fmtCurrency } from "@/lib/format";

export type ProfitTableRow = {
  /** 'yyyy-MM-01' */
  month: string;
  /** Human-readable label, e.g. 'January 2026' */
  label: string;
  /** True when this month is estimate-only (current month). */
  isEstimated: boolean;
  /** Total revenue across monetizable podcasts. */
  revenue: number;
  /** Creator payouts. */
  creator: number;
  /** Portal fees. */
  portal: number;
  /** Owner (your) take. */
  yourTake: number;
  /** Everyone else's payouts combined. */
  partners: number;
};

const COLLAPSED = 3;

export function ProfitTable({ rows }: { rows: ProfitTableRow[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rows : rows.slice(0, COLLAPSED);
  const hasMore = rows.length > COLLAPSED;

  return (
    <>
      <Table>
        <THead>
          <TR>
            <TH>Month</TH>
            <TH className="text-right">Revenue</TH>
            <TH className="text-right">Creator</TH>
            <TH className="text-right">Portal</TH>
            <TH className="text-right">Partners</TH>
            <TH className="text-right">Your take</TH>
          </TR>
        </THead>
        <TBody>
          {visible.map((r) => (
            <TR key={r.month}>
              <TD className="font-medium">
                <div className="flex items-center gap-2">
                  <span>{r.label}</span>
                  {r.isEstimated ? (
                    <Badge tone="neutral">estimated</Badge>
                  ) : null}
                </div>
              </TD>
              <TD className="text-right tabular-nums">
                {r.revenue > 0 ? fmtCurrency(r.revenue) : "—"}
              </TD>
              <TD className="text-right tabular-nums text-ink-600">
                {r.revenue > 0 ? fmtCurrency(r.creator) : "—"}
              </TD>
              <TD className="text-right tabular-nums text-ink-600">
                {r.portal > 0 ? `−${fmtCurrency(r.portal)}` : "—"}
              </TD>
              <TD className="text-right tabular-nums text-ink-700">
                {r.partners > 0 ? fmtCurrency(r.partners) : "—"}
              </TD>
              <TD className="text-right tabular-nums font-semibold text-emerald-700">
                {r.yourTake > 0 ? fmtCurrency(r.yourTake) : "—"}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
      {hasMore ? (
        <div className="border-t border-ink-100 px-4 py-2 text-center">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs font-medium text-brand-dark hover:underline"
          >
            {expanded ? "Show fewer" : `Show all ${rows.length} months`}
          </button>
        </div>
      ) : null}
    </>
  );
}
