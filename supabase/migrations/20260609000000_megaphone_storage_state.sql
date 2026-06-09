-- ============================================================================
-- Megaphone storage state — Playwright session for headless refresh
--
-- The first time you run `npm run megaphone:auth`, Playwright opens a
-- real Chrome window and waits for you to sign in to cms.megaphone.fm
-- (Google OAuth, 2FA, all of it). After login, the full browser storage
-- state (cookies + localStorage + sessionStorage) is captured and saved
-- into this column.
--
-- The headless refresh (`/api/admin/megaphone-refresh`) loads that state,
-- navigates to /reports/dashboard, captures a fresh CSRF token + cookies,
-- and writes them back into `cookie_header` + `csrf_token` so the rest
-- of the dashboard keeps working.
--
-- This column can grow to ~50KB. Restricted to super_admin via the
-- existing RLS policies (no new policy needed — they cover ALL columns).
-- ============================================================================

alter table public.megaphone_session
  add column if not exists storage_state jsonb;

alter table public.megaphone_session
  add column if not exists last_refresh_at timestamptz;

alter table public.megaphone_session
  add column if not exists last_refresh_status text
    check (last_refresh_status is null or last_refresh_status in ('ok', 'failed'));

alter table public.megaphone_session
  add column if not exists last_refresh_message text;
