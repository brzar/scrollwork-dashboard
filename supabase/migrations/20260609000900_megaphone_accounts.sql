-- Multi-account Megaphone.
--
-- The dashboard now combines two Megaphone logins. Each account has its
-- own CMS token + network ID (env: MEGAPHONE_*_2) and its own private web
-- session. This migration turns the single-row megaphone_session table
-- into one-row-per-account and tags each podcast with its account.

-- 1) megaphone_session: singleton -> keyed by account.
alter table public.megaphone_session
  add column if not exists account text;

update public.megaphone_session set account = 'primary' where account is null;

-- Drop the singleton constraints (PK on id + the id=true check) so we can
-- hold one row per account. Constraint names are the Postgres defaults.
alter table public.megaphone_session drop constraint if exists megaphone_session_pkey;
alter table public.megaphone_session drop constraint if exists megaphone_session_id_check;

alter table public.megaphone_session alter column account set not null;
alter table public.megaphone_session
  add constraint megaphone_session_pkey primary key (account);

-- A freshly-added account has no session yet, so these can be null until
-- its first auth.
alter table public.megaphone_session alter column id drop not null;
alter table public.megaphone_session alter column organization_id drop not null;
alter table public.megaphone_session alter column csrf_token drop not null;
alter table public.megaphone_session alter column cookie_header drop not null;

-- 2) Tag podcasts with the account they came from.
alter table public.podcast
  add column if not exists megaphone_account text not null default 'primary';
