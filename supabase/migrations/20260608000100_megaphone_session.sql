-- ============================================================================
-- Megaphone web session — singleton row holding the cookies + CSRF token
-- needed to call Megaphone's private analytics API (`/api/v2/private/...`).
--
-- Why this exists: the documented CMS API token doesn't expose analytics.
-- The internal web app does, but it auth's via session cookies + JWT that
-- expire every ~24h. We store the latest known-good session here so the
-- server can use it; a super_admin refreshes it from the admin UI when it
-- expires.
--
-- Security: super_admin only (both read AND write). Everyone else is
-- blocked by RLS. The server-side code reads via the service-role client
-- to keep things explicit.
-- ============================================================================

create table if not exists public.megaphone_session (
  id              boolean     primary key default true check (id = true),  -- singleton: one row, id always true
  organization_id text        not null,
  csrf_token      text        not null,
  cookie_header   text        not null,           -- full Cookie: header value
  expires_at      timestamptz,
  updated_by      uuid        references public.user_profile(user_id) on delete set null,
  updated_at      timestamptz not null default now()
);

drop trigger if exists megaphone_session_set_updated on public.megaphone_session;
create trigger megaphone_session_set_updated
  before update on public.megaphone_session
  for each row execute function public.set_updated_at();

alter table public.megaphone_session enable row level security;

drop policy if exists "mg_session super select" on public.megaphone_session;
drop policy if exists "mg_session super write"  on public.megaphone_session;

create policy "mg_session super select"
  on public.megaphone_session for select
  using (public.current_user_role() = 'super_admin');

create policy "mg_session super write"
  on public.megaphone_session for all
  using (public.current_user_role() = 'super_admin')
  with check (public.current_user_role() = 'super_admin');
