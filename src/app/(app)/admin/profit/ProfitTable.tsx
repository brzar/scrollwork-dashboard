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
  /** Total creator revenue (confirmed + estimated). */
  creator: number;
  /** True when this month is estimate-only (current month). */
  isEstimated: boolean;
  /** Our gross, summed across each podcast's own split. */
  gross: number;
  /** Partner fee, summed across each podcast's own split. */
  partnerFee: number;
  /** Company net after partner fees. */
  net: number;
  /** Each founder's take-home. */
  perFounder: number;
};

const COLLAPSED = 3;

/**
 * Profit table with collapse/expand. Shows the per-month breakdown of
 * creator revenue → our gross → partner fee → our net take-home.
 *
 * Identical interaction pattern to the EarningsTable on /monthly — first
 * COLLAPSED rows are visible, the rest expand on click.
 */
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
            <TH className="text-right">Creator revenue</TH>
            <TH className="text-right">Our gross</TH>
            <TH className="text-right">Partner fee</TH>
            <TH className="text-right">Company net</TH>
            <TH className="text-right">Per founder</TH>
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
                {r.creator > 0 ? fmtCurrency(r.creator) : "—"}
              </TD>
              <TD className="text-right tabular-nums text-ink-700">
                {r.creator > 0 ? fmtCurrency(r.gross) : "—"}
              </TD>
              <TD className="text-right tabular-nums text-ink-600">
                {r.creator > 0 ? `−${fmtCurrency(r.partnerFee)}` : "—"}
              </TD>
              <TD className="text-right tabular-nums text-ink-700">
                {r.creator > 0 ? fmtCurrency(r.net) : "—"}
              </TD>
              <TD className="text-right tabular-nums font-semibold text-emerald-700">
                {r.creator > 0 ? fmtCurrency(r.perFounder) : "—"}
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
