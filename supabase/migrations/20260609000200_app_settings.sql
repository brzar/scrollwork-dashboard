-- ============================================================================
-- App settings — singleton row, super-admin-controlled toggles that apply
-- to the entire dashboard. First inhabitant: dark-mode.
--
-- Read by every authenticated user (theme needs to apply to everyone),
-- writable only by super_admin.
-- ============================================================================

create table if not exists public.app_settings (
  id          boolean     primary key default true check (id = true),
  dark_mode   boolean     not null default false,
  updated_by  uuid        references public.user_profile(user_id) on delete set null,
  updated_at  timestamptz not null default now()
);

-- Bootstrap the singleton row.
insert into public.app_settings (id, dark_mode)
values (true, false)
on conflict (id) do nothing;

drop trigger if exists app_settings_set_updated on public.app_settings;
create trigger app_settings_set_updated
  before update on public.app_settings
  for each row execute function public.set_updated_at();

alter table public.app_settings enable row level security;

drop policy if exists "app_settings authed select" on public.app_settings;
drop policy if exists "app_settings super write"  on public.app_settings;

-- Theme has to apply to everyone, so anyone authenticated reads it.
create policy "app_settings authed select"
  on public.app_settings for select
  using (auth.uid() is not null);

-- Only super_admin flips toggles.
create policy "app_settings super write"
  on public.app_settings for all
  using (public.current_user_role() = 'super_admin')
  with check (public.current_user_role() = 'super_admin');
