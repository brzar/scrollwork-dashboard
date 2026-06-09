-- ============================================================================
-- Invite with pre-selected podcast access.
--
-- Adds a `podcast_access` jsonb column to `invitation` that holds
-- [{ podcast_id, access_level }] tuples. The new-auth-user trigger
-- consumes it on first sign-in, creating matching `user_podcast_access`
-- rows alongside the existing role assignment.
--
-- For invites that target an email already in `user_profile`, the API
-- route applies the access immediately (no trigger needed) — see
-- /src/app/api/admin/users/route.ts.
-- ============================================================================

alter table public.invitation
  add column if not exists podcast_access jsonb not null default '[]'::jsonb;

create or replace function public.handle_new_auth_user() returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_role        text := 'viewer';
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

  if found then
    v_role := v_invited.role;
    update public.invitation
    set accepted_at = now()
    where id = v_invited.id;
  end if;

  insert into public.user_profile (user_id, email, full_name, avatar_url, role, active)
  values (new.id, new.email, v_full_name, v_avatar_url, v_role, true)
  on conflict (user_id) do nothing;

  -- Pre-seeded podcast access (when invite included a podcast list).
  if found and v_invited.podcast_access is not null then
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
