-- Fifth split mode: Scrollwork + King, 50/50.
--
-- Same shape as "Scrollwork + Lazarus": own portal (0% fee), 70% creator
-- by default, and the remaining 30% split evenly — here between Jonathan
-- and King. Creator % stays editable per podcast.

insert into public.split_mode
  (name, portal, portal_fee_pct, default_creator_share_pct, beneficiaries)
values
  ('Scrollwork + King (50/50)', 'Scrollwork', 0, 0.70,
   '[{"name":"Jonathan","pct":0.50},{"name":"King","pct":0.50}]'::jsonb)
on conflict (name) do nothing;
