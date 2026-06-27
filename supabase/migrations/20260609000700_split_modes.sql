-- Split modes — reusable revenue-split templates assigned per podcast.
--
-- Model: for each podcast's revenue R,
--   portal fee = R × portal_fee_pct          (e.g. Viewly 20%, Scrollwork 0%)
--   creator    = R × creator_share_pct        (per-podcast override, else mode default; 0 for owned-and-operated)
--   remaining  = R − portal fee − creator
--   each beneficiary gets remaining × their pct (pcts sum to 1)
--
-- Non-monetizable podcasts are excluded from all profit math.

create table if not exists public.split_mode (
  id            uuid        primary key default gen_random_uuid(),
  name          text        not null unique,
  portal        text,                 -- 'Viewly' | 'Scrollwork' | null
  portal_fee_pct            numeric not null default 0
                check (portal_fee_pct >= 0 and portal_fee_pct <= 1),
  default_creator_share_pct numeric not null default 0.70
                check (default_creator_share_pct >= 0 and default_creator_share_pct <= 1),
  -- [{ "name": "Jonathan", "pct": 0.7 }, ...] — pcts are fractions of the
  -- remaining and should sum to 1.
  beneficiaries jsonb       not null default '[]'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.split_mode enable row level security;

drop policy if exists "split_mode admin read"  on public.split_mode;
drop policy if exists "split_mode admin write" on public.split_mode;

create policy "split_mode admin read"
  on public.split_mode for select
  using (public.current_user_role() in ('super_admin','admin'));

create policy "split_mode admin write"
  on public.split_mode for all
  using (public.current_user_role() in ('super_admin','admin'))
  with check (public.current_user_role() in ('super_admin','admin'));

-- Per-podcast config.
alter table public.podcast
  add column if not exists monetizable boolean not null default true;

alter table public.podcast
  add column if not exists split_mode_id uuid
    references public.split_mode(id) on delete set null;

-- Override of the mode's default creator share. NULL = use the mode default.
-- 0 = owned-and-operated (no creator cut).
alter table public.podcast
  add column if not exists creator_share_pct numeric
    check (creator_share_pct is null
           or (creator_share_pct >= 0 and creator_share_pct <= 1));

-- Seed the four modes. Re-running is a no-op (unique name).
insert into public.split_mode
  (name, portal, portal_fee_pct, default_creator_share_pct, beneficiaries)
values
  ('Viewly + King', 'Viewly', 0.20, 0.70,
   '[{"name":"Jonathan","pct":0.70},{"name":"King","pct":0.30}]'::jsonb),
  ('Liam', null, 0, 0,
   '[{"name":"Liam","pct":0.80},{"name":"Jonathan","pct":0.10},{"name":"King","pct":0.10}]'::jsonb),
  ('Scrollwork + King', 'Scrollwork', 0, 0.70,
   '[{"name":"Jonathan","pct":0.70},{"name":"King","pct":0.30}]'::jsonb),
  ('Scrollwork + Lazarus', 'Scrollwork', 0, 0.70,
   '[{"name":"Jonathan","pct":0.50},{"name":"Lazarus","pct":0.50}]'::jsonb)
on conflict (name) do nothing;
