"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { fmtCurrency } from "@/lib/format";

export type EarningsTableRow = {
  /** 'yyyy-MM-01' */
  month: string;
  /** Human-readable label, e.g. 'January 2026' */
  label: string;
  confirmed: number;
  estimated: number;
};

const COLLAPSED = 3;

/**
 * Earnings table that shows the most recent N months by default and
 * expands to show the full history. Pre-rendering the full data means
 * the expand is instant — no extra fetch.
 */
export function EarningsTable({ rows }: { rows: EarningsTableRow[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rows : rows.slice(0, COLLAPSED);
  const hasMore = rows.length > COLLAPSED;

  return (
    <>
      <Table>
        <THead>
          <TR>
            <TH>Month</TH>
            <TH className="text-right">Earnings</TH>
          </TR>
        </THead>
        <TBody>
          {visible.map((r) => {
            const total = r.confirmed + r.estimated;
            const isEstimated = r.confirmed === 0 && r.estimated > 0;
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
                <TD className="text-right tabular-nums font-medium">
                  {total > 0 ? fmtCurrency(total) : "—"}
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
