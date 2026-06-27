-- Editable founder share.
--
-- How company net divides to each founder's take-home was the global
-- constant FOUNDER_SHARE_PCT (0.5 = a 50% slice). Make it editable from
-- the Profit tab by storing it on the app_settings singleton.
--
-- Stored as a fraction in [0, 1]. Default 0.5 matches the old constant.

alter table public.app_settings
  add column if not exists founder_share_pct numeric not null default 0.5
    check (founder_share_pct >= 0 and founder_share_pct <= 1);
