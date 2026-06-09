-- Reject uninvited Google sign-ins at the DB layer.
--
-- Background: the original `handle_new_auth_user` trigger always
-- inserted a user_profile row with role='viewer', active=true for any
-- new auth.users row. Combined with the OAuth flow this meant ANY
-- google account could sign in and land on the dashboard, even though
-- RLS hid all of the data. The user saw an empty dashboard rather than
-- being shut out.
--
-- Fix: the trigger now only creates the user_profile row when a
-- matching open invitation exists. Without an invitation, no profile
-- row is created. The auth callback then detects the missing profile,
-- signs the user out, and redirects them to /login?error=unauthorized.
--
-- The super-admin bootstrap path (SUPER_ADMIN_BOOTSTRAP_EMAIL) handles
-- its own profile insert via the service-role client in the callback,
-- so it doesn't depend on this trigger.

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

  -- No invitation? Don't create a profile. Let the auth.users row exist
  -- (Supabase needs it for the JWT exchange to succeed) but ensure the
  -- callback can detect this state and refuse the session.
  if not found then
    return new;
  end if;

  update public.invitation
  set accepted_at = now()
  where id = v_invited.id;

  insert into public.user_profile (user_id, email, full_name, avatar_url, role, active)
  values (new.id, new.email, v_full_name, v_avatar_url, v_invited.role, true)
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
        -- Bad podcast_id (e.g. deleted between invite and signup) shouldn't
        -- block account creation. Swallow.
        null;
      end;
    end loop;
  end if;

  return new;
end;
$$;
