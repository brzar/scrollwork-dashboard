-- ============================================================================
-- Megaphone Dashboard — initial schema
--
-- Tables: user_profile, podcast, user_podcast_access, audit_log,
--         cached_metric, invitation.
--
-- Roles (highest → lowest privilege):
--   super_admin  : full read/write across users, podcasts, settings, metrics.
--   admin        : manages users + access mappings for podcasts they admin.
--   creator      : sees only podcasts explicitly assigned to them (RW on
--                  their own annotations; READ on metrics).
--   viewer       : read-only on assigned podcasts.
--
-- Access is gated by user_podcast_access. A user with NO matching row in
-- user_podcast_access sees NO podcast/metric rows. RLS enforces this server-
-- side regardless of what the API does.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ============================================================================
-- Tables
-- ============================================================================

create table if not exists public.user_profile (
  user_id     uuid        primary key references auth.users(id) on delete cascade,
  email       text        not null,
  full_name   text,
  avatar_url  text,
  role        text        not null
              check (role in ('super_admin','admin','creator','viewer')),
  active      boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists user_profile_email_idx
  on public.user_profile (lower(email));

create table if not exists public.podcast (
  id              uuid        primary key default gen_random_uuid(),
  megaphone_id    text        unique not null,         -- Megaphone podcast UUID
  title           text        not null,
  subtitle        text,
  author          text,
  image_url       text,
  network_id      text,
  active          boolean     not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists podcast_title_idx on public.podcast (lower(title));

-- Per-user access mapping. Presence = access; absence = no access.
-- `access_level` lets us reduce a creator/viewer's effective level on a
-- specific podcast (e.g. give a creator read-only access to a second show).
create table if not exists public.user_podcast_access (
  user_id      uuid        not null references public.user_profile(user_id) on delete cascade,
  podcast_id   uuid        not null references public.podcast(id) on delete cascade,
  access_level text        not null default 'read'
               check (access_level in ('read','write','admin')),
  granted_by   uuid        references public.user_profile(user_id) on delete set null,
  granted_at   timestamptz not null default now(),
  primary key (user_id, podcast_id)
);

create index if not exists upa_podcast_idx on public.user_podcast_access (podcast_id);

-- Append-only audit log. Inserts only via SECURITY DEFINER fn or service key.
create table if not exists public.audit_log (
  id           bigserial   primary key,
  actor_id     uuid        references public.user_profile(user_id) on delete set null,
  actor_email  text,
  action       text        not null,    -- e.g. 'user.invite', 'access.grant'
  target_type  text,                    -- 'user' | 'podcast' | 'access' | ...
  target_id    text,
  metadata     jsonb       not null default '{}'::jsonb,
  ip           text,
  user_agent   text,
  created_at   timestamptz not null default now()
);

create index if not exists audit_log_created_idx on public.audit_log (created_at desc);
create index if not exists audit_log_actor_idx   on public.audit_log (actor_id);
create index if not exists audit_log_action_idx  on public.audit_log (action);

-- Optional cached metrics (Megaphone responses, daily roll-ups).
-- Key: (podcast_id, metric, granularity, bucket_start). Body is jsonb so
-- we can add metric shapes without migrations.
create table if not exists public.cached_metric (
  podcast_id    uuid        not null references public.podcast(id) on delete cascade,
  metric        text        not null,   -- 'downloads' | 'revenue' | 'listens' | ...
  granularity   text        not null check (granularity in ('day','week','month','total')),
  bucket_start  date        not null,
  bucket_end    date        not null,
  value         jsonb       not null,   -- { value: number, currency?: 'USD', ... }
  fetched_at    timestamptz not null default now(),
  primary key (podcast_id, metric, granularity, bucket_start)
);

create index if not exists cached_metric_pod_idx
  on public.cached_metric (podcast_id, metric, granularity);

create table if not exists public.invitation (
  id            uuid        primary key default gen_random_uuid(),
  email         text        not null,
  role          text        not null
                check (role in ('super_admin','admin','creator','viewer')),
  invited_by    uuid        references public.user_profile(user_id) on delete set null,
  accepted_at   timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now()
);

create unique index if not exists invitation_pending_idx
  on public.invitation (lower(email))
  where accepted_at is null and revoked_at is null;

-- ============================================================================
-- Helper functions (SECURITY DEFINER → avoid RLS recursion)
-- ============================================================================

create or replace function public.current_user_role() returns text
  language sql
  stable
  security definer
  set search_path = public
as $$
  select role from public.user_profile
  where user_id = auth.uid() and active = true
  limit 1;
$$;

revoke all on function public.current_user_role() from public;
grant execute on function public.current_user_role() to anon, authenticated;

create or replace function public.user_has_podcast_access(p_podcast_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select
    -- super_admin & admin see everything
    (select role in ('super_admin','admin') and active
       from public.user_profile where user_id = auth.uid())
    or exists (
      select 1 from public.user_podcast_access
      where user_id = auth.uid() and podcast_id = p_podcast_id
    );
$$;

revoke all on function public.user_has_podcast_access(uuid) from public;
grant execute on function public.user_has_podcast_access(uuid) to anon, authenticated;

-- updated_at trigger
create or replace function public.set_updated_at() returns trigger
  language plpgsql as
$$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists user_profile_set_updated on public.user_profile;
create trigger user_profile_set_updated
  before update on public.user_profile
  for each row execute function public.set_updated_at();

drop trigger if exists podcast_set_updated on public.podcast;
create trigger podcast_set_updated
  before update on public.podcast
  for each row execute function public.set_updated_at();

-- ============================================================================
-- Auto-bootstrap user_profile on new auth.users row
-- ============================================================================
create or replace function public.handle_new_auth_user() returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_role        text := 'viewer';
  v_invited     public.invitation%rowtype;
  v_full_name   text;
  v_avatar_url  text;
begin
  -- Pull display info from OAuth metadata (Google).
  v_full_name  := coalesce(new.raw_user_meta_data->>'full_name',
                           new.raw_user_meta_data->>'name');
  v_avatar_url := coalesce(new.raw_user_meta_data->>'avatar_url',
                           new.raw_user_meta_data->>'picture');

  -- If there's a pending invitation for this email, adopt its role.
  select * into v_invited
  from public.invitation
  where lower(email) = lower(new.email)
    and accepted_at is null
    and revoked_at is null
  order by created_at desc
  limit 1;

  if found then
    v_role := v_invited.role;
    update public.invitation
    set accepted_at = now()
    where id = v_invited.id;
  end if;

  insert into public.user_profile (user_id, email, full_name, avatar_url, role, active)
  values (new.id, new.email, v_full_name, v_avatar_url, v_role, true)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ============================================================================
-- Row-Level Security
-- ============================================================================

alter table public.user_profile         enable row level security;
alter table public.podcast              enable row level security;
alter table public.user_podcast_access  enable row level security;
alter table public.audit_log            enable row level security;
alter table public.cached_metric        enable row level security;
alter table public.invitation           enable row level security;

-- ---- user_profile -------------------------------------------------------
drop policy if exists "user_profile self select"  on public.user_profile;
drop policy if exists "user_profile admin select" on public.user_profile;
drop policy if exists "user_profile super update" on public.user_profile;
drop policy if exists "user_profile self update"  on public.user_profile;

-- Self-read.
create policy "user_profile self select"
  on public.user_profile for select
  using (auth.uid() = user_id);

-- Admins read everyone.
create policy "user_profile admin select"
  on public.user_profile for select
  using (public.current_user_role() in ('super_admin','admin'));

-- No "self update" policy is exposed at the RLS layer. Letting users
-- update their own profile via the anon key would require a trigger to
-- prevent role/active escalation; we instead route any future self-edit
-- through a server route that uses the service-role key after re-checking
-- the caller's identity. This keeps the policy tree simple and auditable.
--
-- Super-admin can change roles / active flag.
create policy "user_profile super update"
  on public.user_profile for update
  using (public.current_user_role() = 'super_admin')
  with check (public.current_user_role() = 'super_admin');

-- No public insert/delete — those go through service-role admin endpoints.

-- ---- podcast ------------------------------------------------------------
drop policy if exists "podcast scoped select" on public.podcast;
drop policy if exists "podcast admin write"   on public.podcast;

-- Visible if the caller is super_admin/admin OR has an access mapping.
create policy "podcast scoped select"
  on public.podcast for select
  using (
    public.current_user_role() in ('super_admin','admin')
    or exists (
      select 1 from public.user_podcast_access a
      where a.podcast_id = podcast.id and a.user_id = auth.uid()
    )
  );

-- Only super_admin/admin can modify podcast rows (sync writes via service key).
create policy "podcast admin write"
  on public.podcast for all
  using (public.current_user_role() in ('super_admin','admin'))
  with check (public.current_user_role() in ('super_admin','admin'));

-- ---- user_podcast_access ------------------------------------------------
drop policy if exists "upa self select"  on public.user_podcast_access;
drop policy if exists "upa admin select" on public.user_podcast_access;
drop policy if exists "upa admin write"  on public.user_podcast_access;

create policy "upa self select"
  on public.user_podcast_access for select
  using (user_id = auth.uid());

create policy "upa admin select"
  on public.user_podcast_access for select
  using (public.current_user_role() in ('super_admin','admin'));

create policy "upa admin write"
  on public.user_podcast_access for all
  using (public.current_user_role() in ('super_admin','admin'))
  with check (public.current_user_role() in ('super_admin','admin'));

-- ---- audit_log ----------------------------------------------------------
drop policy if exists "audit super select" on public.audit_log;
-- Reads: super_admin/admin. Writes: service-role only (no policy → blocked).
create policy "audit super select"
  on public.audit_log for select
  using (public.current_user_role() in ('super_admin','admin'));

-- ---- cached_metric ------------------------------------------------------
drop policy if exists "cached scoped select" on public.cached_metric;
drop policy if exists "cached admin write"   on public.cached_metric;

-- Reuses the helper, so cached metrics inherit the podcast's access rules.
create policy "cached scoped select"
  on public.cached_metric for select
  using (public.user_has_podcast_access(podcast_id));

create policy "cached admin write"
  on public.cached_metric for all
  using (public.current_user_role() in ('super_admin','admin'))
  with check (public.current_user_role() in ('super_admin','admin'));

-- ---- invitation ---------------------------------------------------------
drop policy if exists "invitation admin select" on public.invitation;
drop policy if exists "invitation admin write"  on public.invitation;

create policy "invitation admin select"
  on public.invitation for select
  using (public.current_user_role() in ('super_admin','admin'));

create policy "invitation admin write"
  on public.invitation for all
  using (public.current_user_role() in ('super_admin','admin'))
  with check (public.current_user_role() in ('super_admin','admin'));
