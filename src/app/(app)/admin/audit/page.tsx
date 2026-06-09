import { redirect } from "next/navigation";
import { Card, CardBody } from "@/components/ui/Card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { getServerSession } from "@/lib/session-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canViewAudit } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const session = await getServerSession();
  if (!session) redirect("/pending");
  if (!canViewAudit(session)) redirect("/");

  const supabase = createAdminClient();
  const { data: rows } = await supabase
    .from("audit_log")
    .select("id, action, actor_email, target_type, target_id, metadata, ip, created_at")
    .order("created_at", { ascending: false })
    .limit(500);

  return (
    <div className="animate-rise space-y-10">
      <div className="pt-4">
        <h1 className="text-[28px] font-semibold text-ink-900 tracking-tightish leading-tight">
          Audit log
        </h1>
        <p className="text-[14px] text-ink-500 mt-1.5">
          Last 500 events. Auth, user, access, and sync actions.
        </p>
      </div>

      <Card>
        <CardBody className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>When (UTC)</TH>
                <TH>Actor</TH>
                <TH>Action</TH>
                <TH>Target</TH>
                <TH>IP</TH>
                <TH>Metadata</TH>
              </TR>
            </THead>
            <TBody>
              {(rows ?? []).map((r) => (
                <TR key={r.id}>
                  <TD className="text-xs text-ink-500 whitespace-nowrap">
                    {String(r.created_at).replace("T", " ").slice(0, 19)}
                  </TD>
                  <TD className="text-ink-700">{r.actor_email ?? "system"}</TD>
                  <TD className="font-mono text-xs">{r.action}</TD>
                  <TD className="text-xs text-ink-700">
                    {r.target_type ? `${r.target_type}/${r.target_id}` : "—"}
                  </TD>
                  <TD className="text-xs text-ink-500">{r.ip ?? "—"}</TD>
                  <TD className="text-xs">
                    <code className="text-ink-600">
                      {JSON.stringify(r.metadata ?? {})}
                    </code>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardBody>
      </Card>
    </div>
  );
}
