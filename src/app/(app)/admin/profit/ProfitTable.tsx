"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { fmtCurrency } from "@/lib/format";
import {
  FOUNDER_SHARE_PCT,
  GROSS_SHARE_PCT,
  PARTNER_FEE_PCT,
  splitRevenue,
} from "@/lib/profit";

export type ProfitTableRow = {
  /** 'yyyy-MM-01' */
  month: string;
  /** Human-readable label, e.g. 'January 2026' */
  label: string;
  /** Confirmed creator revenue. */
  confirmed: number;
  /** Estimated creator revenue (current month). */
  estimated: number;
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
            <TH className="text-right">
              Our gross ({Math.round(GROSS_SHARE_PCT * 100)}%)
            </TH>
            <TH className="text-right">
              Partner fee ({Math.round(PARTNER_FEE_PCT * 100)}%)
            </TH>
            <TH className="text-right">Company net</TH>
            <TH className="text-right">
              Per founder ({Math.round(FOUNDER_SHARE_PCT * 100)}%)
            </TH>
          </TR>
        </THead>
        <TBody>
          {visible.map((r) => {
            const isEstimated = r.confirmed === 0 && r.estimated > 0;
            const creator = r.confirmed + r.estimated;
            const s = splitRevenue(creator);
            return (
              <TR key={r.month}>
                <TD className="font-medium">
                  <div className="flex items-center gap-2">
                    <span>{r.label}</span>
                    {isEstimated ? (
                      <Badge tone="neutral">estimated</Badge>
                    ) : null}
                  </div>
                </TD>
                <TD className="text-right tabular-nums">
                  {creator > 0 ? fmtCurrency(creator) : "—"}
                </TD>
                <TD className="text-right tabular-nums text-ink-700">
                  {creator > 0 ? fmtCurrency(s.gross) : "—"}
                </TD>
                <TD className="text-right tabular-nums text-ink-600">
                  {creator > 0 ? `−${fmtCurrency(s.partnerFee)}` : "—"}
                </TD>
                <TD className="text-right tabular-nums text-ink-700">
                  {creator > 0 ? fmtCurrency(s.net) : "—"}
                </TD>
                <TD className="text-right tabular-nums font-semibold text-emerald-700">
                  {creator > 0 ? fmtCurrency(s.perFounder) : "—"}
                </TD>
              </TR>
            );
          })}
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
