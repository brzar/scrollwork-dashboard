-- Per-podcast revenue splits.
--
-- Every show can have a different deal: how much of creator revenue we
-- take (gross share) and how much of our cut goes to partners (partner
-- fee). Previously these were global constants in src/lib/profit.ts.
--
-- Stored as fractions in [0, 1]. Defaults match the historical global
-- constants (GROSS_SHARE_PCT = 0.30, PARTNER_FEE_PCT = 0.20) so existing
-- rows behave exactly as before until edited.
--
-- Founder split (how company net divides between founders) stays global —
-- it isn't a per-podcast deal term.

alter table public.podcast
  add column if not exists gross_share_pct numeric not null default 0.30
    check (gross_share_pct >= 0 and gross_share_pct <= 1);

alter table public.podcast
  add column if not exists partner_fee_pct numeric not null default 0.20
    check (partner_fee_pct >= 0 and partner_fee_pct <= 1);
