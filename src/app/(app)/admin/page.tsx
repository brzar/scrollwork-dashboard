import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardBody } from "@/components/ui/Card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { StatCard } from "@/components/StatCard";
import { getServerSession } from "@/lib/session-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin, isSuperAdmin } from "@/lib/permissions";
import { fmtNumber } from "@/lib/format";
import { resolveTheme } from "@/lib/theme";
import { SyncButton } from "./SyncButton";
import { RefreshButton } from "./RefreshButton";
import { ThemeToggle } from "./ThemeToggle";

export const dynamic = "force-dynamic";

export default async function AdminOverview() {
  const session = await getServerSession();
  if (!session) redirect("/pending");
  if (!isAdmin(session)) redirect("/");

  const supabase = createAdminClient();
  const [usersRes, podcastsRes, accessRes, lastSyncRes, syncActivityRes] =
    await Promise.all([
      supabase.from("user_profile").select("user_id, role, active"),
      supabase.from("podcast").select("id, active"),
      supabase.from("user_podcast_access").select("user_id"),
      supabase
        .from("audit_log")
        .select("created_at, metadata")
        .eq("action", "metrics.sync")
        .order("created_at", { ascending: false })
        .limit(1),
      // Recent sync + refresh runs for the activity panel.
      supabase
        .from("audit_log")
        .select("created_at, action, metadata")
        .in("action", ["metrics.sync", "megaphone.session.refresh"])
        .order("created_at", { ascending: false })
        .limit(12),
    ]);
  const users = usersRes.data ?? [];
  const podcasts = podcastsRes.data ?? [];
  const access = accessRes.data ?? [];
  const lastSync = lastSyncRes.data?.[0];

  type SyncEvent = {
    created_at: string;
    action: string;
    metadata: {
      source?: string;
      deliveryRows?: number;
      earningsRows?: number;
      failures?: unknown[];
      durationMs?: number;
      results?: Array<{ account?: string; ok?: boolean }>;
    } | null;
  };
  const syncActivity = (syncActivityRes.data ?? []) as SyncEvent[];

  // Megaphone data-source sessions (one row per account). Resilient to the
  // multi-account migration not being applied yet.
  type SessionRow = {
    account: string;
    storage_state: unknown;
    last_refresh_at: string | null;
    last_refresh_status: string | null;
    last_refresh_message: string | null;
  };
  let sessions: SessionRow[] = [];
  const sessRes = await supabase
    .from("megaphone_session")
    .select("account, storage_state, last_refresh_at, last_refresh_status, last_refresh_message");
  if (sessRes.error) {
    const legacy = await supabase
      .from("megaphone_session")
      .select("storage_state, last_refresh_at, last_refresh_status, last_refresh_message")
      .eq("id", true)
      .maybeSingle();
    if (legacy.data) {
      sessions = [{ account: "primary", ...legacy.data } as SessionRow];
    }
  } else {
    sessions = (sessRes.data ?? []) as SessionRow[];
  }
  const accountLabel = (key: string) =>
    key === "secondary" ? "Account 2" : key === "primary" ? "Account 1" : key;
  // metadata is jsonb (typed as Json). Narrow to the shape the sync route
  // writes so we can read the summary counts without `any`.
  const syncMeta = (lastSync?.metadata ?? null) as {
    podcasts?: number;
    deliveryRows?: number;
    earningsRows?: number;
    failures?: unknown[];
  } | null;

  const showRefresh =
    isSuperAdmin(session) && sessions.some((s) => !!s.storage_state);
  const theme = isSuperAdmin(session) ? await resolveTheme() : null;

  return (
    <div className="animate-rise space-y-10">
      <header className="flex items-start justify-between gap-6 flex-wrap pt-4">
        <div>
          <h1 className="text-[28px] font-semibold text-ink-900 tracking-tightish leading-tight">
            Admin
          </h1>
          <p className="text-[14px] text-ink-500 mt-1.5">
            Users, sync status, audit trail.
          </p>
        </div>
        <SyncButton />
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard
          label="Active users"
          value={fmtNumber(users.filter((u) => u.active).length)}
          hint={`${users.length} total`}
        />
        <StatCard
          label="Active podcasts"
          value={fmtNumber(podcasts.filter((p) => p.active).length)}
          hint={`${podcasts.length} total`}
        />
        <StatCard
          label="Access grants"
          value={fmtNumber(access.length)}
          hint="user × podcast"
        />
        <StatCard
          label="Admins"
          value={fmtNumber(
            users.filter((u) => u.role === "super_admin" || u.role === "admin").length,
          )}
          hint="incl. super admins"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardBody>
            <div className="text-sm text-ink-600">Last metrics sync</div>
            <div className="text-base font-semibold text-ink-900 mt-2">
              {lastSync
                ? new Date(lastSync.created_at).toLocaleString()
                : "Never"}
            </div>
            {syncMeta ? (
              <div className="text-xs text-ink-500 mt-1">
                {syncMeta.podcasts ?? 0} podcasts ·{" "}
                {syncMeta.deliveryRows ?? 0} delivery rows ·{" "}
                {syncMeta.earningsRows ?? 0} earnings rows
                {(syncMeta.failures?.length ?? 0) > 0 ? (
                  <span className="text-amber-700">
                    {" "}· {syncMeta.failures!.length} failures
                  </span>
                ) : null}
              </div>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm text-ink-600">Data source sessions</div>
                {sessions.length === 0 ? (
                  <div className="text-xs text-ink-500 mt-2">
                    Auth not configured. Run{" "}
                    <code className="text-ink-700">npm run megaphone:auth</code>.
                  </div>
                ) : (
                  <div className="mt-2 space-y-2">
                    {sessions.map((s) => (
                      <div key={s.account}>
                        <div className="text-[13px] font-semibold text-ink-900">
                          {accountLabel(s.account)}
                          <span className="font-normal text-ink-500">
                            {" · "}
                            {s.storage_state
                              ? "auto-refresh armed"
                              : "manual only"}
                          </span>
                        </div>
                        {s.last_refresh_at ? (
                          <div className="text-xs text-ink-500">
                            Last refresh{" "}
                            {new Date(s.last_refresh_at).toLocaleString()}
                            {s.last_refresh_status === "failed" ? (
                              <span className="text-red-600">
                                {" "}· {s.last_refresh_message ?? "failed"}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {showRefresh ? <RefreshButton /> : null}
            </div>
          </CardBody>
        </Card>
      </div>

      {theme ? (
        <Card>
          <CardBody>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <div className="text-sm text-ink-600">Appearance</div>
                <div className="text-base font-semibold text-ink-900 mt-1">
                  Dashboard theme
                </div>
                <div className="text-xs text-ink-500 mt-1 max-w-md">
                  Applies to every user. Saved instantly and persists
                  across reloads.
                </div>
              </div>
              <ThemeToggle initial={theme} />
            </div>
          </CardBody>
        </Card>
      ) : null}

      <section className="space-y-4">
        <h2 className="text-[15px] font-semibold text-ink-900 tracking-tightish">
          Auto-sync activity
        </h2>
        <Card>
          <CardBody className="p-0">
            {syncActivity.length === 0 ? (
              <div className="p-6 text-sm text-ink-500">
                No sync runs recorded yet. The scheduled job logs each run here.
              </div>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>When</TH>
                    <TH>Job</TH>
                    <TH>Source</TH>
                    <TH>Result</TH>
                    <TH className="text-right">Status</TH>
                  </TR>
                </THead>
                <TBody>
                  {syncActivity.map((e, i) => {
                    const m = e.metadata ?? {};
                    const isRefresh = e.action === "megaphone.session.refresh";
                    const failures = Array.isArray(m.failures)
                      ? m.failures.length
                      : 0;
                    const refreshResults = Array.isArray(m.results)
                      ? m.results
                      : [];
                    const refreshOk =
                      refreshResults.length > 0 &&
                      refreshResults.every((r) => r.ok);
                    const ok = isRefresh
                      ? refreshOk
                      : (m.deliveryRows ?? 0) + (m.earningsRows ?? 0) > 0;
                    return (
                      <TR key={`${e.created_at}-${i}`}>
                        <TD className="text-xs text-ink-500 whitespace-nowrap">
                          {new Date(e.created_at).toLocaleString()}
                        </TD>
                        <TD className="text-[13px] text-ink-800">
                          {isRefresh ? "Session refresh" : "Metrics sync"}
                        </TD>
                        <TD className="text-xs text-ink-500">
                          {m.source ?? "—"}
                        </TD>
                        <TD className="text-[13px] text-ink-700 tabular-nums">
                          {isRefresh
                            ? refreshResults
                                .map(
                                  (r) =>
                                    `${r.account ?? "?"}: ${r.ok ? "ok" : "fail"}`,
                                )
                                .join(" · ") || "—"
                            : `${fmtNumber(m.deliveryRows ?? 0)} delivery · ${fmtNumber(
                                m.earningsRows ?? 0,
                              )} earnings${
                                failures > 0 ? ` · ${failures} failed` : ""
                              }`}
                        </TD>
                        <TD className="text-right">
                          <Badge tone={ok ? "success" : "danger"}>
                            {ok ? "ok" : "issue"}
                          </Badge>
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>
      </section>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Link href="/admin/users" className="group">
          <Card className="hover:border-brand/40 hover:shadow-card-lg transition">
            <CardBody>
              <div className="text-sm font-semibold text-ink-900 flex items-center gap-1.5">
                Users
                <span className="text-brand-dark opacity-0 group-hover:opacity-100 transition">
                  →
                </span>
              </div>
              <div className="text-xs text-ink-500 mt-1">
                Invite, change role, assign podcast access.
              </div>
            </CardBody>
          </Card>
        </Link>
        <Link href="/admin/audit" className="group">
          <Card className="hover:border-brand/40 hover:shadow-card-lg transition">
            <CardBody>
              <div className="text-sm font-semibold text-ink-900 flex items-center gap-1.5">
                Audit log
                <span className="text-brand-dark opacity-0 group-hover:opacity-100 transition">
                  →
                </span>
              </div>
              <div className="text-xs text-ink-500 mt-1">
                Every admin action, with actor + IP.
              </div>
            </CardBody>
          </Card>
        </Link>
      </div>
    </div>
  );
}
