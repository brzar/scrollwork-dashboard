"use client";

import { memo, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import {
  ROLE_LABEL,
  ROLES,
  type Role,
  type AccessLevel,
  ACCESS_LABEL,
} from "@/lib/permissions";
import { initials } from "@/lib/format";

type User = {
  user_id: string;
  email: string;
  full_name: string | null;
  role: Role;
  active: boolean;
  created_at: string;
  partner_name: string | null;
};

type Podcast = { id: string; title: string };
type Access = { user_id: string; podcast_id: string; access_level: AccessLevel };
type Invite = {
  id: string;
  email: string;
  role: Role;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

export function UsersAdminClient({
  sessionRole,
  users,
  podcasts,
  access,
  invites,
  partnerNames,
}: {
  sessionRole: Role;
  users: User[];
  podcasts: Podcast[];
  access: Access[];
  invites: Invite[];
  partnerNames: string[];
}) {
  const router = useRouter();
  const [active, setActive] = useState<User | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("viewer");
  const [invitePartner, setInvitePartner] = useState("");
  // Per-podcast access level being granted in the invite form.
  // Keyed by podcast_id; absence = no access (default).
  const [invitePodcasts, setInvitePodcasts] = useState<
    Map<string, AccessLevel>
  >(new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Per-podcast roles (creator/viewer) need a per-podcast access list;
  // admin/super_admin implicitly see everything.
  const isPerPodcastRole = inviteRole === "creator" || inviteRole === "viewer";

  const accessByUser = useMemo(() => {
    const m = new Map<string, Access[]>();
    for (const a of access) {
      const arr = m.get(a.user_id) ?? [];
      arr.push(a);
      m.set(a.user_id, arr);
    }
    return m;
  }, [access]);

  const canChangeRole = sessionRole === "super_admin";

  async function call(url: string, init: RequestInit, key: string) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(url, {
        ...init,
        headers: { "Content-Type": "application/json", ...(init.headers || {}) },
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Request failed (${res.status})`);
      }
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function onInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail) return;
    const podcasts = isPerPodcastRole
      ? Array.from(invitePodcasts.entries()).map(([podcast_id, access_level]) => ({
          podcast_id,
          access_level,
        }))
      : [];
    await call(
      "/api/admin/users",
      {
        method: "POST",
        body: JSON.stringify({
          email: inviteEmail,
          role: inviteRole,
          podcasts,
          partner_name: invitePartner || null,
        }),
      },
      "invite",
    );
    setInviteEmail("");
    setInvitePodcasts(new Map());
    setInvitePartner("");
  }

  async function onChangePartner(u: User, partner_name: string) {
    await call(
      `/api/admin/users/${u.user_id}`,
      { method: "PATCH", body: JSON.stringify({ partner_name: partner_name || null }) },
      `partner-${u.user_id}`,
    );
  }

  function setPodcastLevel(podcastId: string, level: AccessLevel | "none") {
    setInvitePodcasts((prev) => {
      const next = new Map(prev);
      if (level === "none") next.delete(podcastId);
      else next.set(podcastId, level);
      return next;
    });
  }

  function setAllPodcasts(level: AccessLevel | "none") {
    if (level === "none") {
      setInvitePodcasts(new Map());
    } else {
      setInvitePodcasts(new Map(podcasts.map((p) => [p.id, level])));
    }
  }

  async function onChangeRole(u: User, role: Role) {
    await call(
      `/api/admin/users/${u.user_id}`,
      { method: "PATCH", body: JSON.stringify({ role }) },
      `role-${u.user_id}`,
    );
  }

  async function onToggleActive(u: User) {
    await call(
      `/api/admin/users/${u.user_id}`,
      { method: "PATCH", body: JSON.stringify({ active: !u.active }) },
      `active-${u.user_id}`,
    );
  }

  async function onGrant(u: User, podcastId: string, level: AccessLevel) {
    await call(
      `/api/admin/users/${u.user_id}/access`,
      { method: "POST", body: JSON.stringify({ podcast_id: podcastId, access_level: level }) },
      `grant-${u.user_id}-${podcastId}`,
    );
  }

  async function onRevoke(u: User, podcastId: string) {
    await call(
      `/api/admin/users/${u.user_id}/access?podcast_id=${encodeURIComponent(podcastId)}`,
      { method: "DELETE" },
      `revoke-${u.user_id}-${podcastId}`,
    );
  }

  return (
    <div className="animate-rise space-y-10">
      <div className="pt-4">
        <h1 className="text-[28px] font-semibold text-ink-900 tracking-tightish leading-tight">
          Users
        </h1>
        <p className="text-[14px] text-ink-500 mt-1.5">
          Invite, change roles, assign podcast access.
        </p>
      </div>

      {error ? (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">
          {error}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Invite user</CardTitle>
        </CardHeader>
        <CardBody>
          <form onSubmit={onInvite} className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
              <Input
                type="email"
                required
                placeholder="user@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="flex-1"
              />
              <Select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as Role)}
                disabled={!canChangeRole && inviteRole === "super_admin"}
              >
                {ROLES.filter((r) => canChangeRole || r !== "super_admin").map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </Select>
              <Button type="submit" disabled={busy === "invite"}>
                {busy === "invite" ? "Inviting…" : "Send invite"}
              </Button>
            </div>

            {partnerNames.length > 0 ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-ink-500 whitespace-nowrap">
                  Partner identity
                </span>
                <Select
                  value={invitePartner}
                  onChange={(e) => setInvitePartner(e.target.value)}
                  className="max-w-[220px]"
                >
                  <option value="">— none —</option>
                  {partnerNames.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
                <span className="text-[11.5px] text-ink-400">
                  links their account to a split-mode payout name
                </span>
              </div>
            ) : null}

            {isPerPodcastRole ? (
              <div className="border border-ink-200 rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-ink-50 border-b border-ink-100">
                  <div className="text-xs font-semibold text-ink-700">
                    Podcasts to grant ·{" "}
                    <span className="font-normal text-ink-500">
                      {invitePodcasts.size === 0
                        ? "none selected"
                        : `${invitePodcasts.size} of ${podcasts.length}`}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-ink-500">Quick set:</span>
                    <button
                      type="button"
                      className="text-brand-dark hover:underline"
                      onClick={() => setAllPodcasts("read")}
                    >
                      all read
                    </button>
                    <span className="text-ink-300">·</span>
                    <button
                      type="button"
                      className="text-brand-dark hover:underline"
                      onClick={() => setAllPodcasts("write")}
                    >
                      all write
                    </button>
                    <span className="text-ink-300">·</span>
                    <button
                      type="button"
                      className="text-ink-600 hover:underline"
                      onClick={() => setAllPodcasts("none")}
                    >
                      clear
                    </button>
                  </div>
                </div>
                <div className="max-h-64 overflow-y-auto divide-y divide-ink-100">
                  {podcasts.length === 0 ? (
                    <div className="p-4 text-sm text-ink-500 text-center">
                      No podcasts to assign. Run a sync first.
                    </div>
                  ) : (
                    podcasts.map((p) => (
                      <PodcastRow
                        key={p.id}
                        podcast={p}
                        level={invitePodcasts.get(p.id)}
                        onChange={(lvl) => setPodcastLevel(p.id, lvl)}
                      />
                    ))
                  )}
                </div>
              </div>
            ) : (
              <p className="text-xs text-ink-500">
                {ROLE_LABEL[inviteRole]} users see every podcast — no per-show
                picker needed.
              </p>
            )}

            <p className="text-xs text-ink-500">
              The user receives access when they sign in with Google using this
              email. Pending invites:{" "}
              {invites.filter((i) => !i.accepted_at && !i.revoked_at).length}
            </p>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All users · {users.length}</CardTitle>
        </CardHeader>
        <CardBody className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>User</TH>
                <TH>Role</TH>
                {partnerNames.length > 0 ? <TH>Partner</TH> : null}
                <TH>Status</TH>
                <TH>Podcasts</TH>
                <TH></TH>
              </TR>
            </THead>
            <TBody>
              {users.map((u) => {
                const grants = accessByUser.get(u.user_id) ?? [];
                return (
                  <TR key={u.user_id}>
                    <TD>
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-brand/15 text-brand-dark flex items-center justify-center text-xs font-semibold">
                          {initials(u.full_name || u.email)}
                        </div>
                        <div>
                          <div className="font-medium">{u.full_name || u.email}</div>
                          <div className="text-xs text-ink-500">{u.email}</div>
                        </div>
                      </div>
                    </TD>
                    <TD>
                      {canChangeRole ? (
                        <Select
                          value={u.role}
                          onChange={(e) => onChangeRole(u, e.target.value as Role)}
                          disabled={busy === `role-${u.user_id}`}
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABEL[r]}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <Badge tone={u.role === "super_admin" ? "brand" : "neutral"}>
                          {ROLE_LABEL[u.role]}
                        </Badge>
                      )}
                    </TD>
                    {partnerNames.length > 0 ? (
                      <TD>
                        <Select
                          value={u.partner_name ?? ""}
                          onChange={(e) => onChangePartner(u, e.target.value)}
                          disabled={busy === `partner-${u.user_id}`}
                        >
                          <option value="">— none —</option>
                          {partnerNames.map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                          {/* Preserve a custom value not in the current modes. */}
                          {u.partner_name &&
                          !partnerNames.includes(u.partner_name) ? (
                            <option value={u.partner_name}>
                              {u.partner_name}
                            </option>
                          ) : null}
                        </Select>
                      </TD>
                    ) : null}
                    <TD>
                      {u.active ? (
                        <Badge tone="success">Active</Badge>
                      ) : (
                        <Badge tone="danger">Disabled</Badge>
                      )}
                    </TD>
                    <TD className="text-xs text-ink-700">
                      {u.role === "super_admin" || u.role === "admin"
                        ? "All (admin)"
                        : `${grants.length} assigned`}
                    </TD>
                    <TD className="text-right whitespace-nowrap">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setActive(u)}
                      >
                        Manage access
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onToggleActive(u)}
                        disabled={busy === `active-${u.user_id}`}
                      >
                        {u.active ? "Disable" : "Enable"}
                      </Button>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </CardBody>
      </Card>

      {active ? (
        <AccessModal
          user={active}
          podcasts={podcasts}
          grants={accessByUser.get(active.user_id) ?? []}
          busy={busy}
          onClose={() => setActive(null)}
          onGrant={onGrant}
          onRevoke={onRevoke}
        />
      ) : null}
    </div>
  );
}

/**
 * One row in the invite-form podcast picker. Memoized so updating a
 * single row's access level doesn't re-render the whole list (with
 * many podcasts this was the source of the perceived lag).
 *
 * Uses a segmented pill control instead of a Select so each change is
 * a single click with no dropdown overlap. The selected pill picks up
 * the brand color for at-a-glance scannability.
 */
const PodcastRow = memo(function PodcastRow({
  podcast,
  level,
  onChange,
}: {
  podcast: Podcast;
  level: AccessLevel | undefined;
  onChange: (level: AccessLevel | "none") => void;
}) {
  const active = !!level;
  const options: Array<{ key: AccessLevel | "none"; label: string }> = [
    { key: "none", label: "None" },
    { key: "read", label: "Read" },
    { key: "write", label: "Write" },
    { key: "admin", label: "Admin" },
  ];
  return (
    <div
      className={`flex items-center justify-between gap-3 px-3 py-2 transition-colors ${
        active ? "bg-brand/5" : "hover:bg-ink-50/60"
      }`}
    >
      <span className="text-sm text-ink-800 truncate flex-1 min-w-0">
        {podcast.title}
      </span>
      <div className="inline-flex border border-ink-200 rounded-md bg-white overflow-hidden shrink-0">
        {options.map((opt) => {
          const selected =
            (opt.key === "none" && !level) || (opt.key !== "none" && level === opt.key);
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => onChange(opt.key)}
              className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                selected
                  ? "bg-brand text-white"
                  : "text-ink-600 hover:bg-ink-50"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
});

function AccessModal({
  user,
  podcasts,
  grants,
  busy,
  onClose,
  onGrant,
  onRevoke,
}: {
  user: User;
  podcasts: Podcast[];
  grants: Access[];
  busy: string | null;
  onClose: () => void;
  onGrant: (u: User, podcastId: string, level: AccessLevel) => void | Promise<void>;
  onRevoke: (u: User, podcastId: string) => void | Promise<void>;
}) {
  const levelByPodcast = new Map(grants.map((g) => [g.podcast_id, g.access_level]));
  return (
    <div
      className="fixed inset-0 bg-ink-900/40 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <Card
        className="w-full max-w-lg"
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Access · {user.full_name || user.email}</CardTitle>
            <button
              type="button"
              onClick={onClose}
              className="text-ink-500 hover:text-ink-900 text-sm"
            >
              Close
            </button>
          </div>
        </CardHeader>
        <CardBody className="p-0 max-h-[60vh] overflow-y-auto">
          {user.role === "super_admin" || user.role === "admin" ? (
            <div className="p-6 text-sm text-ink-600">
              This user has the <b>{ROLE_LABEL[user.role]}</b> role and
              implicitly has access to every podcast. Reduce the role to
              creator/viewer to apply per-podcast restrictions.
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Podcast</TH>
                  <TH>Access level</TH>
                  <TH></TH>
                </TR>
              </THead>
              <TBody>
                {podcasts.map((p) => {
                  const current = levelByPodcast.get(p.id);
                  return (
                    <TR key={p.id}>
                      <TD className="font-medium">{p.title}</TD>
                      <TD>
                        <Select
                          value={current ?? "none"}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === "none") onRevoke(user, p.id);
                            else onGrant(user, p.id, v as AccessLevel);
                          }}
                          disabled={
                            busy === `grant-${user.user_id}-${p.id}` ||
                            busy === `revoke-${user.user_id}-${p.id}`
                          }
                        >
                          <option value="none">No access</option>
                          <option value="read">{ACCESS_LABEL.read}</option>
                          <option value="write">{ACCESS_LABEL.write}</option>
                          <option value="admin">{ACCESS_LABEL.admin}</option>
                        </Select>
                      </TD>
                      <TD className="text-right">
                        {current ? (
                          <Badge tone="brand">{current}</Badge>
                        ) : (
                          <Badge tone="neutral">—</Badge>
                        )}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
