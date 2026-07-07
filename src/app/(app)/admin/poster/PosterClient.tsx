"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import {
  Table,
  THead,
  TBody,
  TR,
  TH,
  TD,
} from "@/components/ui/Table";

// ---- Types mirroring the Poster's API --------------------------------------

type Channel = {
  name: string;
  slug: string;
  youtube_url: string;
  megaphone_network_id: string;
  megaphone_podcast_id: string;
  start_video_id: string;
  posts_per_day: number;
  include_shorts: boolean;
  author: string;
  mode: string;
  enabled: boolean;
  megaphone_account: number;
  posted_today: number;
  remaining_today: number;
  total_posted: number;
};

type QueueItem = {
  channel: string;
  channel_slug: string;
  video_id: string;
  title: string;
  url: string;
  upload_date: string;
  duration: number;
  thumbnail: string;
};

type Usage = {
  month: string;
  requests: { used: number; limit: number; remaining: number; percent: number };
  bandwidth: {
    used_mb: number;
    limit_mb: number;
    remaining_mb: number;
    percent: number;
  };
  egress?: {
    enabled: boolean;
    used_gb: number;
    budget_gb: number;
    remaining_gb: number | null;
    percent: number;
  };
};

type Episode = {
  channel_slug: string;
  episode_id?: string;
  video_id?: string;
  title?: string;
  posted_at_iso?: string;
  status?: string;
};

type Warning = {
  type: string;
  severity: string;
  title: string;
  detail: string;
  key: string;
};

type LogEvent = { seq: number; type: string; [k: string]: unknown };

// ---- Small fetch helper ----------------------------------------------------

async function api<T = any>(
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; data: T | null; error?: string }> {
  try {
    const res = await fetch(`/api/admin/poster${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    });
    let data: any = null;
    const text = await res.text();
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    const error = !res.ok
      ? data?.error || data?.detail || `Request failed (${res.status})`
      : undefined;
    return { ok: res.ok, status: res.status, data, error };
  } catch {
    return { ok: false, status: 0, data: null, error: "Network error" };
  }
}

// ---- Root ------------------------------------------------------------------

export function PosterClient({ configured }: { configured: boolean }) {
  if (!configured) return <NotConnected />;
  return <Poster />;
}

function Poster() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [paused, setPaused] = useState(false);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<LogEvent[]>([]);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [banner, setBanner] = useState<{ tone: Tone; text: string } | null>(
    null,
  );
  const [posting, setPosting] = useState(false);
  const logCursor = useRef<number>(-1);

  const flash = useCallback((tone: Tone, text: string) => {
    setBanner({ tone, text });
    window.setTimeout(() => setBanner(null), 6000);
  }, []);

  // Heavy data — channels, usage, episodes, warnings.
  const loadAll = useCallback(async () => {
    const [ch, us, ep, wn] = await Promise.all([
      api<{ channels: Channel[] }>("/channels"),
      api<Usage>("/usage"),
      api<{ episodes: Episode[] }>("/episodes"),
      api<{ warnings: Warning[] }>("/warnings"),
    ]);
    if (ch.ok && ch.data) {
      setChannels(ch.data.channels);
      setReachable(true);
    } else if (ch.status !== 0) {
      setReachable(false);
    }
    if (us.ok && us.data) setUsage(us.data);
    if (ep.ok && ep.data) setEpisodes(ep.data.episodes);
    if (wn.ok && wn.data) setWarnings(wn.data.warnings);
  }, []);

  // Fast loop — the live log (in-memory, cheap). Drives the run view, paused
  // and running state, so it polls quickly for a near-real-time feel.
  const pollLog = useCallback(async () => {
    const l = await api<{
      events: LogEvent[];
      latest_seq: number;
      is_running: boolean;
      paused: boolean;
    }>(`/log?since=${logCursor.current}`);
    if (l.ok && l.data) {
      setPaused(l.data.paused);
      setRunning(l.data.is_running);
      if (l.data.events.length) {
        setLog((prev) => [...prev, ...l.data!.events].slice(-400));
      }
      logCursor.current = l.data.latest_seq;
    }
  }, []);

  // Slower loop — the queue (recomputing it lists YouTube, so don't hammer it).
  const pollQueue = useCallback(async () => {
    const q = await api<{ items: QueueItem[]; is_running: boolean }>("/queue");
    if (q.ok && q.data) setQueue(q.data.items);
  }, []);

  const tick = useCallback(() => {
    pollLog();
    pollQueue();
  }, [pollLog, pollQueue]);

  useEffect(() => {
    loadAll();
    pollLog();
    pollQueue();
    const logTimer = window.setInterval(pollLog, 1500);
    const queueTimer = window.setInterval(pollQueue, 8000);
    const slow = window.setInterval(loadAll, 25000);
    return () => {
      window.clearInterval(logTimer);
      window.clearInterval(queueTimer);
      window.clearInterval(slow);
    };
  }, [loadAll, pollLog, pollQueue]);

  async function postNow() {
    if (posting) return;
    setPosting(true);
    const res = await api<{ started: boolean; count?: number; reason?: string }>(
      "/post",
      { method: "POST" },
    );
    setPosting(false);
    if (!res.ok) {
      flash("danger", res.error ?? "Couldn't start a run");
      return;
    }
    if (res.data?.started) {
      flash("success", `Started a run — ${res.data.count} video(s) queued.`);
      setRunning(true);
    } else {
      flash("neutral", res.data?.reason || "Nothing to post right now.");
    }
    tick();
  }

  async function stopRun() {
    if (!window.confirm("Stop the current run? It winds down gracefully — finished episodes stay posted.")) {
      return;
    }
    const res = await api("/abort", { method: "POST" });
    if (res.ok) {
      flash("neutral", "Stopping the run…");
      tick();
    } else {
      flash("danger", res.error ?? "Couldn't stop the run");
    }
  }

  async function togglePause() {
    const next = !paused;
    setPaused(next);
    const res = await api("/pause", {
      method: "POST",
      body: JSON.stringify({ paused: next }),
    });
    if (!res.ok) {
      setPaused(!next);
      flash("danger", res.error ?? "Couldn't change pause state");
    }
  }

  async function skip(item: QueueItem) {
    const res = await api(`/skip/${item.channel_slug}/${item.video_id}`, {
      method: "POST",
    });
    if (res.ok) {
      setQueue((q) => q.filter((i) => i.video_id !== item.video_id));
      flash("neutral", `Skipped “${item.title}”.`);
    } else {
      flash("danger", res.error ?? "Skip failed");
    }
  }

  async function toggleChannel(ch: Channel) {
    const target = !ch.enabled;
    const setEnabled = (slug: string, val: boolean) =>
      setChannels((cs) =>
        cs.map((c) => (c.slug === slug ? { ...c, enabled: val } : c)),
      );
    // Optimistic: flip the switch immediately so the click feels responsive
    // (the round-trip to Fly can take a second or two).
    setEnabled(ch.slug, target);
    const res = await api<{ enabled: boolean }>(
      `/channels/${ch.slug}/toggle`,
      { method: "POST" },
    );
    if (res.ok && res.data) {
      setEnabled(ch.slug, !!res.data.enabled); // reconcile with server truth
    } else {
      setEnabled(ch.slug, ch.enabled); // revert
      flash("danger", res.error ?? "Toggle failed");
    }
  }

  async function deleteChannel(ch: Channel) {
    if (
      !window.confirm(
        `Remove “${ch.name}” from the poster? Its posting history is kept; it just stops being mirrored.`,
      )
    )
      return;
    const res = await api(`/channels/${ch.slug}`, { method: "DELETE" });
    if (res.ok) {
      setChannels((cs) => cs.filter((c) => c.slug !== ch.slug));
      flash("neutral", `Removed “${ch.name}”.`);
    } else {
      flash("danger", res.error ?? "Delete failed");
    }
  }

  const enabledCount = channels.filter((c) => c.enabled).length;
  const runRows = useMemo(() => deriveRun(log), [log]);
  const activeRun = running || runRows.some((r) => !TERMINAL_STAGES.has(r.stage));

  return (
    <div className="animate-rise space-y-8">
      <header className="pt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold text-ink-900 tracking-tightish leading-tight">
            Spotify Poster
          </h1>
          <p className="text-[14px] text-ink-500 mt-1.5 max-w-xl">
            Mirror YouTube channels to Megaphone. Click{" "}
            <span className="font-medium text-ink-700">Post now</span> to
            publish the next batch; the daily cap per channel is enforced, so
            extra clicks are no-ops once a channel hits its quota.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="secondary"
            onClick={togglePause}
            title={paused ? "Resume posting" : "Pause posting"}
          >
            {paused ? "Resume" : "Pause"}
          </Button>
          {running ? (
            <Button variant="danger" onClick={stopRun}>
              Stop run
            </Button>
          ) : null}
          <Button onClick={postNow} disabled={posting || paused || running}>
            {posting ? "Starting…" : running ? "Run in progress" : "Post now"}
          </Button>
        </div>
      </header>

      {banner ? (
        <div
          className={`rounded-xl px-4 py-3 text-[13.5px] ${BANNER_TONE[banner.tone]}`}
        >
          {banner.text}
        </div>
      ) : null}

      <StatusStrip
        reachable={reachable}
        running={running}
        paused={paused}
        channels={channels.length}
        enabled={enabledCount}
        queued={queue.length}
      />

      {reachable === false ? (
        <Card>
          <CardBody className="p-6 text-[13.5px] text-ink-600">
            Couldn’t reach the Poster. It needs to be running on its machine
            with the tunnel up. Once it’s back, this page recovers on its own.
          </CardBody>
        </Card>
      ) : null}

      {warnings.length > 0 ? (
        <div className="space-y-2">
          {warnings.map((w) => (
            <div
              key={w.key}
              className="rounded-xl bg-amber-50 text-amber-900 px-4 py-3"
            >
              <div className="text-[13.5px] font-semibold">{w.title}</div>
              <div className="text-[12.5px] mt-0.5 text-amber-800">
                {w.detail}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {runRows.length > 0 ? (
        <RunProgress rows={runRows} active={activeRun} />
      ) : null}

      {usage ? <UsageCards usage={usage} /> : null}

      <QueueSection
        items={queue}
        running={running}
        onSkip={skip}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ActivityLog events={log} running={running} />
        <RecentEpisodes episodes={episodes} channels={channels} />
      </div>

      <ScheduleSection flash={flash} />

      <ChannelsSection
        channels={channels}
        onToggle={toggleChannel}
        onDelete={deleteChannel}
        onAdded={() => {
          loadAll();
          tick();
        }}
        flash={flash}
      />
    </div>
  );
}

// ---- Schedule --------------------------------------------------------------

function ScheduleSection({ flash }: { flash: (t: Tone, s: string) => void }) {
  const [enabled, setEnabled] = useState(false);
  const [times, setTimes] = useState<string[]>([]);
  const [tz, setTz] = useState("UTC");
  const [newTime, setNewTime] = useState("09:00");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  type Cfg = { enabled: boolean; times: string[]; tz: string };
  const applyCfg = useCallback((c: Cfg) => {
    setEnabled(!!c.enabled);
    setTimes(Array.isArray(c.times) ? c.times : []);
    setTz(c.tz || "UTC");
  }, []);

  const reload = useCallback(async () => {
    const r = await api<Cfg>("/schedule");
    if (r.ok && r.data) applyCfg(r.data);
    return r;
  }, [applyCfg]);

  useEffect(() => {
    reload().finally(() => setLoaded(true));
  }, [reload]);

  // Save and make local state authoritative from the server's response, so the
  // UI always reflects what's actually persisted (no phantom chips).
  async function save(next: Partial<Cfg>) {
    const body: Cfg = {
      enabled: next.enabled ?? enabled,
      times: next.times ?? times,
      tz: next.tz ?? tz,
    };
    setBusy(true);
    const r = await api<Cfg>("/schedule", {
      method: "POST",
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (r.ok && r.data) {
      applyCfg(r.data);
      flash("success", "Schedule saved.");
    } else {
      flash("danger", r.error ?? "Couldn't save the schedule");
      reload(); // revert optimistic UI to the real server state
    }
  }

  function toggle() {
    const v = !enabled;
    setEnabled(v);
    save({ enabled: v });
  }
  function addTime() {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(newTime)) {
      flash("danger", "Use 24-hour HH:MM (e.g. 09:00 or 18:30).");
      return;
    }
    if (times.includes(newTime)) return;
    const next = [...times, newTime].sort();
    setTimes(next);
    save({ times: next });
  }
  function removeTime(t: string) {
    const next = times.filter((x) => x !== t);
    setTimes(next);
    save({ times: next });
  }

  return (
    <section className="space-y-4">
      <h2 className="text-[15px] font-semibold text-ink-900 tracking-tightish">
        Schedule
      </h2>
      <Card>
        <CardBody className="p-6 space-y-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-[13.5px] font-medium text-ink-900">
                Auto-post on a schedule
              </div>
              <div className="text-[12.5px] text-ink-500 mt-0.5 max-w-md">
                Runs a posting cycle automatically at each time below — every
                channel posts up to its daily cap. No need to click Post now.
              </div>
            </div>
            <Switch on={enabled} busy={busy && !loaded} onToggle={toggle} />
          </div>

          <div className={enabled ? "" : "opacity-50 pointer-events-none"}>
            <div className="text-[12.5px] font-medium text-ink-600 mb-2">
              Times {tz ? `(${tz})` : ""}
            </div>
            {times.length === 0 ? (
              <div className="text-[12.5px] text-ink-400 mb-3">
                No times yet — add one below.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2 mb-3">
                {times.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1.5 bg-ink-100 rounded-md pl-2.5 pr-1.5 py-1 text-[13px] text-ink-800 tabular-nums"
                  >
                    {t}
                    <button
                      type="button"
                      onClick={() => removeTime(t)}
                      aria-label={`Remove ${t}`}
                      className="text-ink-400 hover:text-red-600 leading-none text-[15px]"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <label className="block">
                <div className="text-[12px] text-ink-500 mb-1">Add a time</div>
                <Input
                  type="time"
                  value={newTime}
                  onChange={(e) => setNewTime(e.target.value)}
                  className="w-[140px]"
                />
              </label>
              <Button variant="secondary" size="sm" onClick={addTime}>
                Add
              </Button>
            </div>
          </div>

          <label className="block max-w-xs">
            <div className="text-[12.5px] font-medium text-ink-600 mb-1.5">
              Timezone
            </div>
            <Input
              value={tz}
              onChange={(e) => setTz(e.target.value)}
              onBlur={() => save({ tz })}
              placeholder="Europe/Berlin"
              className="w-full"
            />
            <div className="text-[11.5px] text-ink-400 mt-1">
              IANA name, e.g. Europe/Berlin, America/New_York, UTC.
            </div>
          </label>
        </CardBody>
      </Card>
    </section>
  );
}

// ---- Status strip ----------------------------------------------------------

function StatusStrip({
  reachable,
  running,
  paused,
  channels,
  enabled,
  queued,
}: {
  reachable: boolean | null;
  running: boolean;
  paused: boolean;
  channels: number;
  enabled: number;
  queued: number;
}) {
  const conn =
    reachable === null
      ? { tone: "neutral" as Tone, label: "Connecting…" }
      : reachable
        ? { tone: "success" as Tone, label: "Connected" }
        : { tone: "danger" as Tone, label: "Offline" };
  const state = running
    ? { tone: "brand" as Tone, label: "Run in progress" }
    : paused
      ? { tone: "warning" as Tone, label: "Paused" }
      : { tone: "neutral" as Tone, label: "Idle" };

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] text-ink-600">
      <span className="inline-flex items-center gap-2">
        <Dot tone={conn.tone} />
        <span className="font-medium text-ink-800">{conn.label}</span>
      </span>
      <span className="inline-flex items-center gap-2">
        <Dot tone={state.tone} />
        {state.label}
      </span>
      <span>
        <span className="font-medium text-ink-900 tabular-nums">{enabled}</span>{" "}
        of {channels} channels active
      </span>
      <span>
        <span className="font-medium text-ink-900 tabular-nums">{queued}</span>{" "}
        queued to post now
      </span>
    </div>
  );
}

function Dot({ tone }: { tone: Tone }) {
  const c =
    tone === "success"
      ? "bg-emerald-500"
      : tone === "danger"
        ? "bg-red-500"
        : tone === "warning"
          ? "bg-amber-500"
          : tone === "brand"
            ? "bg-brand"
            : "bg-ink-300";
  return (
    <span className={`w-2 h-2 rounded-full ${c} ${tone === "brand" ? "animate-pulse" : ""}`} />
  );
}

// ---- Usage -----------------------------------------------------------------

function UsageCards({ usage }: { usage: Usage }) {
  const egress = usage.egress;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {egress?.enabled ? (
        <Meter
          label="Hosting data this month (spend cap)"
          used={egress.used_gb}
          limit={egress.budget_gb}
          percent={egress.percent}
          format={(n) => `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })} GB`}
        />
      ) : null}
      <Meter
        label={`Downloader requests · ${usage.month}`}
        used={usage.requests.used}
        limit={usage.requests.limit}
        percent={usage.requests.percent}
        format={(n) => n.toLocaleString()}
      />
      <Meter
        label="Downloader bandwidth"
        used={usage.bandwidth.used_mb}
        limit={usage.bandwidth.limit_mb}
        percent={usage.bandwidth.percent}
        format={(n) => `${n.toLocaleString(undefined, { maximumFractionDigits: 0 })} MB`}
      />
    </div>
  );
}

function Meter({
  label,
  used,
  limit,
  percent,
  format,
}: {
  label: string;
  used: number;
  limit: number;
  percent: number;
  format: (n: number) => string;
}) {
  const pct = Math.min(100, Math.max(0, percent));
  const tone =
    pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-brand";
  return (
    <Card className="p-6">
      <div className="text-[13px] font-medium text-ink-500">{label}</div>
      <div className="mt-2.5 flex items-baseline gap-2">
        <div className="text-2xl font-semibold text-ink-900 tracking-tightish tabular-nums leading-none">
          {format(used)}
        </div>
        <div className="text-[12.5px] text-ink-500">
          of {format(limit)} ({pct}%)
        </div>
      </div>
      <div className="mt-3 h-1.5 rounded-full bg-ink-100 overflow-hidden">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </Card>
  );
}

// ---- Queue -----------------------------------------------------------------

function QueueSection({
  items,
  running,
  onSkip,
}: {
  items: QueueItem[];
  running: boolean;
  onSkip: (i: QueueItem) => void;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-[15px] font-semibold text-ink-900 tracking-tightish">
          Next up
        </h2>
        <Badge tone={items.length ? "brand" : "neutral"}>{items.length}</Badge>
      </div>
      <Card>
        <CardBody className="p-0">
          {items.length === 0 ? (
            <div className="px-6 py-10 text-center text-[13.5px] text-ink-500">
              {running
                ? "A run is in progress — watch the activity log below."
                : "Nothing queued. Daily quotas are met, or every channel is caught up."}
            </div>
          ) : (
            <ul className="divide-y divide-ink-100">
              {items.map((it) => (
                <li
                  key={`${it.channel_slug}:${it.video_id}`}
                  className="flex items-center gap-4 px-5 py-3.5"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={it.thumbnail}
                    alt=""
                    className="w-[88px] h-[50px] rounded-md object-cover bg-ink-100 shrink-0"
                    loading="lazy"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-medium text-ink-900 truncate">
                      {it.title}
                    </div>
                    <div className="text-[12px] text-ink-500 mt-0.5 flex items-center gap-2">
                      <span className="truncate">{it.channel}</span>
                      <span className="text-ink-300">·</span>
                      <span className="tabular-nums">
                        {formatDuration(it.duration)}
                      </span>
                      {it.upload_date ? (
                        <>
                          <span className="text-ink-300">·</span>
                          <span className="tabular-nums">
                            {formatYmd(it.upload_date)}
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onSkip(it)}
                    className="shrink-0"
                  >
                    Skip
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </section>
  );
}

// ---- Activity log ----------------------------------------------------------

function ActivityLog({
  events,
  running,
}: {
  events: LogEvent[];
  running: boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [events]);

  function onScroll() {
    const el = scroller.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-[15px] font-semibold text-ink-900 tracking-tightish">
          Activity
        </h2>
        {running ? <Dot tone="brand" /> : null}
      </div>
      <Card>
        <div
          ref={scroller}
          onScroll={onScroll}
          className="h-[320px] overflow-y-auto px-5 py-4 font-mono text-[12px] leading-relaxed"
        >
          {events.length === 0 ? (
            <div className="text-ink-400">
              No activity yet. Lines appear here while a run is going.
            </div>
          ) : (
            events.map((ev) => {
              const f = formatEvent(ev);
              return (
                <div key={ev.seq} className={`whitespace-pre-wrap ${f.cls}`}>
                  {f.text}
                </div>
              );
            })
          )}
        </div>
      </Card>
    </section>
  );
}

// ---- Recent episodes -------------------------------------------------------

function RecentEpisodes({
  episodes,
  channels,
}: {
  episodes: Episode[];
  channels: Channel[];
}) {
  const nameBySlug = new Map(channels.map((c) => [c.slug, c.name]));
  return (
    <section className="space-y-4">
      <h2 className="text-[15px] font-semibold text-ink-900 tracking-tightish">
        Recently posted
      </h2>
      <Card>
        <div className="h-[320px] overflow-y-auto">
          {episodes.length === 0 ? (
            <div className="px-6 py-10 text-center text-[13.5px] text-ink-500">
              Nothing posted yet.
            </div>
          ) : (
            <ul className="divide-y divide-ink-100">
              {episodes.map((ep, i) => (
                <li
                  key={`${ep.episode_id ?? ep.video_id ?? i}`}
                  className="px-5 py-3"
                >
                  <div className="text-[13px] font-medium text-ink-900 truncate">
                    {ep.title || ep.video_id || "Episode"}
                  </div>
                  <div className="text-[11.5px] text-ink-500 mt-0.5 flex items-center gap-2">
                    <span className="truncate">
                      {nameBySlug.get(ep.channel_slug) ?? ep.channel_slug}
                    </span>
                    {ep.posted_at_iso ? (
                      <>
                        <span className="text-ink-300">·</span>
                        <span>{formatIso(ep.posted_at_iso)}</span>
                      </>
                    ) : null}
                    {ep.status ? (
                      <Badge
                        tone={ep.status === "processing" ? "warning" : "success"}
                      >
                        {ep.status}
                      </Badge>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </section>
  );
}

// ---- Channels --------------------------------------------------------------

function ChannelsSection({
  channels,
  onToggle,
  onDelete,
  onAdded,
  flash,
}: {
  channels: Channel[];
  onToggle: (c: Channel) => void | Promise<void>;
  onDelete: (c: Channel) => void;
  onAdded: () => void;
  flash: (t: Tone, s: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Channel | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function closeForm() {
    setAdding(false);
    setEditing(null);
  }

  async function handleToggle(c: Channel) {
    if (busy) return;
    setBusy(c.slug);
    try {
      await onToggle(c);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-ink-900 tracking-tightish">
          Channels
        </h2>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setEditing(null);
            setAdding((v) => !v);
          }}
        >
          {adding ? "Cancel" : "Add channel"}
        </Button>
      </div>

      {adding || editing ? (
        <ChannelForm
          key={editing?.slug ?? "add"}
          existing={editing ?? undefined}
          onCancel={closeForm}
          onSaved={() => {
            closeForm();
            onAdded();
          }}
          flash={flash}
        />
      ) : null}

      <Card>
        <CardBody className="p-0">
          {channels.length === 0 ? (
            <div className="px-6 py-10 text-center text-[13.5px] text-ink-500">
              No channels configured yet.
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Channel</TH>
                  <TH className="text-right">Today</TH>
                  <TH className="text-right">Total</TH>
                  <TH>Mode</TH>
                  <TH>Account</TH>
                  <TH className="text-right">Status</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {channels.map((c) => (
                  <TR
                    key={c.slug}
                    className={c.enabled ? "" : "opacity-55"}
                  >
                    <TD>
                      <div className="font-medium text-ink-900">{c.name}</div>
                      <a
                        href={c.youtube_url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-[12px] text-ink-500 hover:text-brand truncate block max-w-[260px]"
                      >
                        {c.youtube_url}
                      </a>
                    </TD>
                    <TD className="text-right tabular-nums">
                      <span className="text-ink-900 font-medium">
                        {c.posted_today}
                      </span>
                      <span className="text-ink-400">/{c.posts_per_day}</span>
                    </TD>
                    <TD className="text-right tabular-nums text-ink-700">
                      {c.total_posted}
                    </TD>
                    <TD>
                      <Badge tone="neutral">{c.mode}</Badge>
                    </TD>
                    <TD className="tabular-nums text-ink-700">
                      #{c.megaphone_account}
                    </TD>
                    <TD className="text-right">
                      <div className="inline-flex items-center gap-2.5">
                        <span
                          className={`text-[12px] font-medium w-[44px] text-right ${
                            c.enabled ? "text-emerald-700" : "text-ink-500"
                          }`}
                        >
                          {c.enabled ? "Active" : "Paused"}
                        </span>
                        <Switch
                          on={c.enabled}
                          busy={busy === c.slug}
                          onToggle={() => handleToggle(c)}
                        />
                      </div>
                    </TD>
                    <TD className="text-right whitespace-nowrap">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setAdding(false);
                          setEditing(c);
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onDelete(c)}
                        className="text-ink-500 hover:text-red-600"
                      >
                        Remove
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </section>
  );
}

function ChannelForm({
  existing,
  onCancel,
  onSaved,
  flash,
}: {
  existing?: Channel;
  onCancel: () => void;
  onSaved: () => void;
  flash: (t: Tone, s: string) => void;
}) {
  const [form, setForm] = useState({
    name: existing?.name ?? "",
    youtube_url: existing?.youtube_url ?? "",
    megaphone_network_id: existing?.megaphone_network_id ?? "",
    megaphone_podcast_id: existing?.megaphone_podcast_id ?? "",
    start_video_id: existing?.start_video_id ?? "",
    posts_per_day: String(existing?.posts_per_day ?? 1),
    mode: existing?.mode ?? "backfill",
    megaphone_account: String(existing?.megaphone_account ?? 1),
    include_shorts: existing?.include_shorts ?? false,
    author: existing?.author ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [looking, setLooking] = useState(false);
  const isEdit = !!existing;
  const formRef = useRef<HTMLDivElement>(null);

  // The form renders above the (long) channels table, so scroll it into view
  // when it opens — otherwise clicking Edit on a lower row looks like a no-op.
  useEffect(() => {
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function lookup() {
    if (!form.youtube_url && !form.start_video_id) return;
    setLooking(true);
    const res = await api<{
      channel_name?: string;
      latest_video_id?: string;
      video_title?: string;
    }>("/lookup", {
      method: "POST",
      body: JSON.stringify({
        youtube_url: form.youtube_url,
        start_video_id: form.start_video_id,
      }),
    });
    setLooking(false);
    if (res.ok && res.data) {
      if (res.data.channel_name && !form.name)
        set("name", res.data.channel_name);
      if (res.data.video_title)
        flash("neutral", `Start video: “${res.data.video_title}”`);
      else if (res.data.channel_name)
        flash("neutral", `Resolved channel: ${res.data.channel_name}`);
    } else {
      flash("danger", res.error ?? "Lookup failed");
    }
  }

  async function save() {
    setSaving(true);
    const payload = {
      ...form,
      posts_per_day: Number(form.posts_per_day),
      megaphone_account: Number(form.megaphone_account),
    };
    const res = isEdit
      ? await api(`/channels/${existing!.slug}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        })
      : await api("/channels", {
          method: "POST",
          body: JSON.stringify(payload),
        });
    setSaving(false);
    if (res.ok) {
      flash("success", `${isEdit ? "Saved" : "Added"} “${form.name}”.`);
      onSaved();
    } else {
      flash("danger", res.error ?? `Couldn't ${isEdit ? "save" : "add"} channel`);
    }
  }

  return (
    <div ref={formRef} className="scroll-mt-20">
    <Card className="ring-2 ring-brand/30">
      <CardHeader>
        <CardTitle>{isEdit ? `Edit ${existing!.name}` : "Add a channel"}</CardTitle>
      </CardHeader>
      <CardBody className="p-6 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="YouTube URL">
            <Input
              value={form.youtube_url}
              onChange={(e) => set("youtube_url", e.target.value)}
              placeholder="https://www.youtube.com/@channel"
              onBlur={lookup}
            />
          </Field>
          <Field label="Channel name">
            <Input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Auto-filled from the URL"
            />
          </Field>
          <Field label="Megaphone network ID">
            <Input
              value={form.megaphone_network_id}
              onChange={(e) => set("megaphone_network_id", e.target.value)}
              placeholder="UUID"
            />
          </Field>
          <Field label="Megaphone podcast ID">
            <Input
              value={form.megaphone_podcast_id}
              onChange={(e) => set("megaphone_podcast_id", e.target.value)}
              placeholder="UUID"
            />
          </Field>
          <Field label="Start video (ID or URL)">
            <Input
              value={form.start_video_id}
              onChange={(e) => set("start_video_id", e.target.value)}
              placeholder="dQw4w9WgXcQ"
            />
          </Field>
          <Field label="Posts per day">
            <Input
              type="number"
              min={1}
              max={50}
              value={form.posts_per_day}
              onChange={(e) => set("posts_per_day", e.target.value)}
            />
          </Field>
          <Field label="Mode">
            <Select
              value={form.mode}
              onChange={(e) => set("mode", e.target.value)}
            >
              <option value="backfill">Backfill (oldest → newest)</option>
              <option value="watch">Watch (only new uploads)</option>
              <option value="split">Split (half old, half new)</option>
            </Select>
          </Field>
          <Field label="Megaphone account">
            <Input
              type="number"
              min={1}
              value={form.megaphone_account}
              onChange={(e) => set("megaphone_account", e.target.value)}
            />
          </Field>
          <Field label="Author (optional)">
            <Input
              value={form.author}
              onChange={(e) => set("author", e.target.value)}
              placeholder="Shown as the episode author on Megaphone"
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-[13px] text-ink-700">
          <input
            type="checkbox"
            checked={form.include_shorts}
            onChange={(e) => set("include_shorts", e.target.checked)}
          />
          Include Shorts (videos under ~60s)
        </label>
        <div className="flex items-center gap-2 pt-1">
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : isEdit ? "Save changes" : "Save channel"}
          </Button>
          <Button variant="secondary" onClick={lookup} disabled={looking}>
            {looking ? "Looking up…" : "Look up"}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </CardBody>
    </Card>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block [&_input]:w-full [&_select]:w-full">
      <div className="text-[12.5px] font-medium text-ink-600 mb-1.5">
        {label}
      </div>
      {children}
    </label>
  );
}

function Switch({
  on,
  busy,
  onToggle,
}: {
  on: boolean;
  busy?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={on ? "Disable channel" : "Enable channel"}
      disabled={busy}
      onClick={onToggle}
      className={`relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full transition-colors duration-150 disabled:opacity-50 disabled:cursor-wait focus:outline-none focus:ring-2 focus:ring-brand/40 ${
        on ? "bg-emerald-500" : "bg-ink-300"
      }`}
    >
      <span
        className={`inline-block h-[18px] w-[18px] transform rounded-full bg-white shadow-sm transition-transform duration-150 ${
          on ? "translate-x-[18px]" : "translate-x-[2px]"
        }`}
      />
    </button>
  );
}

// ---- Not connected ---------------------------------------------------------

function NotConnected() {
  return (
    <div className="animate-rise space-y-6">
      <header className="pt-4">
        <h1 className="text-[28px] font-semibold text-ink-900 tracking-tightish leading-tight">
          Spotify Poster
        </h1>
        <p className="text-[14px] text-ink-500 mt-1.5 max-w-xl">
          The poster isn’t connected to this dashboard yet.
        </p>
      </header>
      <Card>
        <CardBody className="p-6 space-y-3 text-[13.5px] text-ink-700">
          <p>To connect it, set two environment variables and redeploy:</p>
          <ul className="space-y-2">
            <li>
              <code className="text-[12.5px] bg-ink-100 rounded px-1.5 py-0.5">
                POSTER_API_URL
              </code>{" "}
              — the public tunnel URL pointing at the poster’s web UI
              (port 8765).
            </li>
            <li>
              <code className="text-[12.5px] bg-ink-100 rounded px-1.5 py-0.5">
                POSTER_API_TOKEN
              </code>{" "}
              — the shared secret, identical to the one in the poster’s{" "}
              <code className="text-[12.5px] bg-ink-100 rounded px-1.5 py-0.5">
                .env
              </code>
              .
            </li>
          </ul>
          <p className="text-ink-500">
            Run the poster behind a Cloudflare tunnel to its web UI, set the
            same token on both ends, and this tab lights up for every admin.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

// ---- Formatting ------------------------------------------------------------

type Tone = "neutral" | "brand" | "success" | "warning" | "danger";

const BANNER_TONE: Record<Tone, string> = {
  neutral: "bg-ink-100 text-ink-700",
  brand: "bg-brand/10 text-brand-dark",
  success: "bg-emerald-50 text-emerald-800",
  warning: "bg-amber-50 text-amber-900",
  danger: "bg-red-50 text-red-700",
};

function formatDuration(sec: number): string {
  if (!sec || sec < 0) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}:${String(m % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatYmd(ymd: string): string {
  // yt-dlp upload_date is "YYYYMMDD".
  if (/^\d{8}$/.test(ymd)) {
    return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
  }
  return ymd;
}

function formatIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Render one log event as a readable line + a tone class. */
function formatEvent(ev: LogEvent): { text: string; cls: string } {
  const s = (k: string) => String((ev as any)[k] ?? "");
  const ink = "text-ink-600";
  const ok = "text-emerald-700";
  const warn = "text-amber-700";
  const err = "text-red-600";
  const hi = "text-ink-900 font-medium";
  switch (ev.type) {
    case "run_started":
      return { text: `▶ Run started — ${s("count")} videos queued`, cls: hi };
    case "download_start":
      return {
        text: `↓ [${Number(ev.index ?? 0) + 1}/${s("total")}] downloading ${s("video_id")} — ${s("title").slice(0, 80)}`,
        cls: ink,
      };
    case "download_done":
      return { text: `✓ downloaded ${s("video_id")} (${s("size_mb")} MB)`, cls: ok };
    case "download_error":
      return { text: `✗ download failed ${s("video_id")}: ${s("message").slice(0, 200)}`, cls: err };
    case "download_retry":
      return { text: `↻ retry ${s("attempt")}/${s("max")} ${s("video_id")}`, cls: warn };
    case "tunnel_ready":
      return { text: `🌐 tunnel ready`, cls: ink };
    case "megaphone_submitted":
      return { text: `→ submitted to Megaphone: ${s("title").slice(0, 80)}`, cls: ok };
    case "megaphone_error":
      return { text: `✗ Megaphone error ${s("video_id")}: ${s("message").slice(0, 200)}`, cls: err };
    case "status_update":
      return { text: `· episode ${s("episode_id")}: ${s("status")}`, cls: ink };
    case "dedup_skipped":
      return { text: `⊘ already on Megaphone, skipping ${s("title").slice(0, 80)}`, cls: ink };
    case "dedup_summary":
      return { text: `⊘ deduped ${s("skipped")}; ${s("kept")} remain`, cls: ink };
    case "channel_no_access":
      return { text: `⛔ ${s("channel")}: ${s("message").slice(0, 160)} — skipped`, cls: err };
    case "format_mismatch":
      return { text: `⚠ format mismatch ${s("video_id")} — processed as audio-only`, cls: warn };
    case "thumbnail_missing":
      return { text: `⚠ thumbnail missing for ${s("video_id")}`, cls: warn };
    case "run_error":
      return { text: `✗ run error: ${s("message").slice(0, 240)}`, cls: err };
    case "run_done":
      return { text: `✅ run complete — idle`, cls: ok };
    case "run_empty":
      return { text: `• nothing to post`, cls: ink };
    case "egress_budget_reached":
      return {
        text: `⛔ monthly data budget (${s("budget_gb")} GB) reached — posting paused until next month`,
        cls: err,
      };
    case "scheduled_trigger": {
      const r = (ev as any).result || {};
      const detail = r.started
        ? `started ${r.count ?? ""} video(s)`
        : `skipped (${r.reason ?? "—"})`;
      return { text: `⏰ scheduled ${s("time")} — ${detail}`, cls: "text-ink-600" };
    }
    case "hello":
      return { text: `— connected —`, cls: "text-ink-400" };
    default:
      return { text: `· ${ev.type}`, cls: "text-ink-400" };
  }
}

// ---- Per-episode run progress (derived from the event stream) ---------------

type RunStage =
  | "downloading"
  | "downloaded"
  | "submitted"
  | "processing"
  | "done"
  | "failed"
  | "skipped";

const TERMINAL_STAGES = new Set<RunStage>(["done", "failed", "skipped"]);

type RunRow = {
  videoId: string;
  title?: string;
  channel?: string;
  stage: RunStage;
  pct: number;
  speed?: number;
  eta?: number;
  mergeStatus?: string;
  sizeMb?: string;
  episodeId?: string;
  status?: string;
  outcome?: string;
  order: number;
};

/** Fold the event log into one row per video, tracking its pipeline stage. */
function deriveRun(events: LogEvent[]): RunRow[] {
  const map = new Map<string, RunRow>();
  const epToVid = new Map<string, string>();
  let order = 0;
  const get = (vid: string): RunRow => {
    let r = map.get(vid);
    if (!r) {
      r = { videoId: vid, stage: "downloading", pct: 0, order: order++ };
      map.set(vid, r);
    }
    return r;
  };
  const f = (ev: LogEvent, k: string) => (ev as any)[k];

  for (const ev of events) {
    const vid = String(f(ev, "video_id") ?? "");
    switch (ev.type) {
      case "download_start": {
        if (!vid) break;
        const r = get(vid);
        r.stage = "downloading";
        r.title = String(f(ev, "title") ?? r.title ?? "");
        r.channel = String(f(ev, "channel") ?? r.channel ?? "");
        break;
      }
      case "download_progress": {
        if (!vid) break;
        const r = get(vid);
        if (TERMINAL_STAGES.has(r.stage)) break;
        const merge = f(ev, "merge_status");
        if (merge) {
          r.mergeStatus = String(merge);
          const mp = Number(f(ev, "merge_percent"));
          if (!Number.isNaN(mp) && mp > 0) r.pct = mp;
        } else {
          const dl = Number(f(ev, "downloaded") ?? 0);
          const tot = Number(f(ev, "total") ?? 0);
          if (tot > 0) r.pct = Math.min(99, (dl / tot) * 100);
          r.speed = Number(f(ev, "speed") ?? 0);
          r.eta = Number(f(ev, "eta") ?? 0);
          r.mergeStatus = undefined;
        }
        r.stage = "downloading";
        break;
      }
      case "download_done": {
        if (!vid) break;
        const r = get(vid);
        r.stage = "downloaded";
        r.pct = 100;
        r.sizeMb = String(f(ev, "size_mb") ?? "");
        break;
      }
      case "download_error":
      case "download_aborted": {
        if (!vid) break;
        const r = get(vid);
        r.stage = "failed";
        r.outcome = ev.type === "download_aborted" ? "aborted" : "download failed";
        break;
      }
      case "dedup_skipped": {
        if (!vid) break;
        const r = get(vid);
        r.stage = "skipped";
        r.outcome = "already on Megaphone";
        if (!r.title) r.title = String(f(ev, "title") ?? "");
        break;
      }
      case "megaphone_submitted": {
        if (!vid) break;
        const r = get(vid);
        r.stage = "submitted";
        r.episodeId = String(f(ev, "episode_id") ?? "");
        if (r.episodeId) epToVid.set(r.episodeId, vid);
        if (!r.title) r.title = String(f(ev, "title") ?? "");
        break;
      }
      case "status_update": {
        const eid = String(f(ev, "episode_id") ?? "");
        const v = epToVid.get(eid);
        if (!v) break;
        const r = map.get(v);
        if (!r || TERMINAL_STAGES.has(r.stage)) break;
        r.status = String(f(ev, "status") ?? "");
        r.stage = "processing";
        break;
      }
      case "megaphone_error": {
        if (!vid) break;
        const r = get(vid);
        r.stage = "failed";
        r.outcome = "Megaphone error";
        break;
      }
      case "episode_terminal": {
        if (!vid) break;
        const r = get(vid);
        const outcome = String(f(ev, "outcome") ?? "");
        r.outcome = outcome;
        if (outcome === "success") r.stage = "done";
        else if (outcome.includes("skip") || outcome.includes("unavailable"))
          r.stage = "skipped";
        else r.stage = "failed";
        break;
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => a.order - b.order);
}

function RunProgress({ rows, active }: { rows: RunRow[]; active: boolean }) {
  const done = rows.filter((r) => r.stage === "done").length;
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-[15px] font-semibold text-ink-900 tracking-tightish">
          This run
        </h2>
        {active ? <Dot tone="brand" /> : null}
        <Badge tone={done === rows.length ? "success" : "brand"}>
          {done}/{rows.length} live
        </Badge>
      </div>
      <Card>
        <CardBody className="p-0">
          <ul className="divide-y divide-ink-100">
            {rows.map((r) => (
              <RunRowItem key={r.videoId} r={r} />
            ))}
          </ul>
        </CardBody>
      </Card>
    </section>
  );
}

function RunRowItem({ r }: { r: RunRow }) {
  return (
    <li className="flex items-center gap-4 px-5 py-3.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`https://i.ytimg.com/vi/${r.videoId}/mqdefault.jpg`}
        alt=""
        className="w-[80px] h-[45px] rounded-md object-cover bg-ink-100 shrink-0"
        loading="lazy"
      />
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-medium text-ink-900 truncate">
          {r.title || r.videoId}
        </div>
        {r.channel ? (
          <div className="text-[12px] text-ink-500 truncate">{r.channel}</div>
        ) : null}
        <div className="mt-2">
          {r.stage === "downloading" ? (
            <DownloadBar r={r} />
          ) : (
            <StageLine r={r} />
          )}
        </div>
      </div>
      <StageBadge stage={r.stage} />
    </li>
  );
}

function DownloadBar({ r }: { r: RunRow }) {
  const pct = Math.round(r.pct);
  return (
    <div>
      <div className="flex items-center justify-between text-[11.5px] text-ink-500 mb-1">
        <span>{r.mergeStatus ? `Merging — ${r.mergeStatus}` : "Downloading"}</span>
        <span className="tabular-nums">
          {r.mergeStatus
            ? `${pct}%`
            : `${pct}%  ·  ${formatSpeed(r.speed)}  ·  ETA ${formatEta(r.eta)}`}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-ink-100 overflow-hidden">
        <div
          className="h-full rounded-full bg-brand transition-all duration-200"
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </div>
    </div>
  );
}

function StageLine({ r }: { r: RunRow }) {
  switch (r.stage) {
    case "downloaded":
      return (
        <div className="text-[12.5px] text-ink-600">
          Downloaded{r.sizeMb ? ` ${r.sizeMb} MB` : ""} — submitting to Megaphone…
        </div>
      );
    case "submitted":
      return (
        <div className="text-[12.5px] text-ink-700">
          Submitted to Megaphone
          {r.episodeId ? ` · ${r.episodeId.slice(0, 8)}…` : ""} — queued for
          processing
        </div>
      );
    case "processing":
      return (
        <div className="text-[12.5px] text-amber-700">
          Processing on Megaphone{r.status ? ` — ${r.status}` : ""}
        </div>
      );
    case "done":
      return (
        <div className="text-[12.5px] text-emerald-700 font-medium">
          ✓ Live on Megaphone
        </div>
      );
    case "failed":
      return (
        <div className="text-[12.5px] text-red-600">
          Failed{r.outcome ? ` — ${r.outcome}` : ""}
        </div>
      );
    case "skipped":
      return (
        <div className="text-[12.5px] text-ink-500">
          {r.outcome || "Skipped"}
        </div>
      );
    default:
      return null;
  }
}

function StageBadge({ stage }: { stage: RunStage }) {
  const map: Record<RunStage, { tone: Tone; label: string }> = {
    downloading: { tone: "brand", label: "Downloading" },
    downloaded: { tone: "neutral", label: "Downloaded" },
    submitted: { tone: "brand", label: "Submitted" },
    processing: { tone: "warning", label: "Processing" },
    done: { tone: "success", label: "Live" },
    failed: { tone: "danger", label: "Failed" },
    skipped: { tone: "neutral", label: "Skipped" },
  };
  const m = map[stage];
  return (
    <span className="shrink-0">
      <Badge tone={m.tone}>{m.label}</Badge>
    </span>
  );
}

function formatSpeed(bytesPerSec?: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return "—";
  const mb = bytesPerSec / 1_000_000;
  if (mb >= 1) return `${mb.toFixed(1)} MB/s`;
  return `${(bytesPerSec / 1000).toFixed(0)} KB/s`;
}

function formatEta(sec?: number): string {
  if (!sec || sec <= 0) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
