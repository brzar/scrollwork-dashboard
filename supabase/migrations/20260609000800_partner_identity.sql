-- Partner identity.
--
-- Links a user account to a beneficiary name used in split modes (e.g.
-- "King", "Lazarus"). It does NOT change what they can access — King and
-- Lazarus are full admins — it just personalizes the Profit view so their
-- "your take" shows their own cut and the payouts table marks them as "you".
--
-- Assigned at invite time (stashed on the invitation, consumed by the
-- signup trigger) and editable later from the Users admin page.

alter table public.user_profile
  add column if not exists partner_name text;

alter table public.invitation
  add column if not exists partner_name text;

-- Recreate the signup trigger so it also copies the invited partner_name
-- into the new user_profile row. (Same uninvited-rejection behavior as
-- 20260609000400.)
create or replace function public.handle_new_auth_user() returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_invited     public.invitation%rowtype;
  v_full_name   text;
  v_avatar_url  text;
  v_pa          jsonb;
begin
  v_full_name  := coalesce(new.raw_user_meta_data->>'full_name',
                           new.raw_user_meta_data->>'name');
  v_avatar_url := coalesce(new.raw_user_meta_data->>'avatar_url',
                           new.raw_user_meta_data->>'picture');

  select * into v_invited
  from public.invitation
  where lower(email) = lower(new.email)
    and accepted_at is null
    and revoked_at is null
  order by created_at desc
  limit 1;

  -- No invitation? Don't create a profile (uninvited users are rejected
  -- at the auth callback).
  if not found then
    return new;
  end if;

  update public.invitation
  set accepted_at = now()
  where id = v_invited.id;

  insert into public.user_profile
    (user_id, email, full_name, avatar_url, role, active, partner_name)
  values
    (new.id, new.email, v_full_name, v_avatar_url, v_invited.role, true,
     v_invited.partner_name)
  on conflict (user_id) do nothing;

  if v_invited.podcast_access is not null then
    for v_pa in select * from jsonb_array_elements(v_invited.podcast_access) loop
      begin
        insert into public.user_podcast_access (user_id, podcast_id, access_level, granted_by)
        values (
          new.id,
          (v_pa->>'podcast_id')::uuid,
          coalesce(v_pa->>'access_level', 'read'),
          v_invited.invited_by
        )
        on conflict (user_id, podcast_id) do nothing;
      exception when others then
        null;
      end;
    end loop;
  end if;

  return new;
end;
$$;
