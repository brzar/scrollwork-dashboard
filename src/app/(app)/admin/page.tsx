import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardBody } from "@/components/ui/Card";
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
  const [usersRes, podcastsRes, accessRes, sessionRes, lastSyncRes] = await Promise.all([
    supabase.from("user_profile").select("user_id, role, active"),
    supabase.from("podcast").select("id, active"),
    supabase.from("user_podcast_access").select("user_id"),
    supabase
      .from("megaphone_session")
      .select("storage_state, last_refresh_at, last_refresh_status, last_refresh_message")
      .eq("id", true)
      .maybeSingle(),
    supabase
      .from("audit_log")
      .select("created_at, metadata")
      .eq("action", "metrics.sync")
      .order("created_at", { ascending: false })
      .limit(1),
  ]);
  const users = usersRes.data ?? [];
  const podcasts = podcastsRes.data ?? [];
  const access = accessRes.data ?? [];
  const sessionInfo = sessionRes.data;
  const lastSync = lastSyncRes.data?.[0];

  const showRefresh = isSuperAdmin(session) && !!sessionInfo?.storage_state;
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
            {lastSync?.metadata ? (
              <div className="text-xs text-ink-500 mt-1">
                {lastSync.metadata.podcasts ?? 0} podcasts ·{" "}
                {lastSync.metadata.deliveryRows ?? 0} delivery rows ·{" "}
                {lastSync.metadata.earningsRows ?? 0} earnings rows
                {(lastSync.metadata.failures?.length ?? 0) > 0 ? (
                  <span className="text-amber-700">
                    {" "}· {lastSync.metadata.failures.length} failures
                  </span>
                ) : null}
              </div>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm text-ink-600">Data source session</div>
                <div className="text-base font-semibold text-ink-900 mt-2">
                  {sessionInfo?.storage_state
                    ? "Auto-refresh armed"
                    : sessionInfo
                      ? "Manual only"
                      : "Not configured"}
                </div>
                {sessionInfo?.last_refresh_at ? (
                  <div className="text-xs text-ink-500 mt-1">
                    Last refresh{" "}
                    {new Date(sessionInfo.last_refresh_at).toLocaleString()}
                    {sessionInfo.last_refresh_status === "failed" ? (
                      <span className="text-red-600">
                        {" "}· {sessionInfo.last_refresh_message ?? "failed"}
                      </span>
                    ) : null}
                  </div>
                ) : !sessionInfo ? (
                  <div className="text-xs text-ink-500 mt-1">
                    Auth not configured. See SETUP.md.
                  </div>
                ) : null}
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
