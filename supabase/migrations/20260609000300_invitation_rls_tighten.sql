-- Tighten invitation RLS.
--
-- Background: the original `invitation admin write` policy granted
-- super_admin AND admin a blanket `for all` with `using` and `with check`
-- only checking the caller's role. An admin could therefore insert
-- `{ email: 'x@example.com', role: 'super_admin' }` directly via the
-- supabase-js client (using their own anon-key session) and the auth
-- trigger `handle_new_auth_user` would consume that invite on first
-- sign-in, granting the invited account super_admin. That bypassed the
-- API-layer check in `/api/admin/users` POST.
--
-- Fix: split the write policies in two.
--   - super_admin keeps full write access to the invitation table.
--   - admin can only write rows whose `role` is NOT super_admin.
--
-- For UPDATE, both the old row (USING) and the new row (WITH CHECK) must
-- pass the constraint, so an admin cannot promote an existing pending
-- admin invitation to super_admin either.

alter table public.invitation enable row level security;

drop policy if exists "invitation admin write" on public.invitation;

create policy "invitation super_admin write"
  on public.invitation for all
  using (public.current_user_role() = 'super_admin')
  with check (public.current_user_role() = 'super_admin');

create policy "invitation admin insert non-super"
  on public.invitation for insert
  with check (
    public.current_user_role() = 'admin'
    and role <> 'super_admin'
  );

create policy "invitation admin update non-super"
  on public.invitation for update
  using (
    public.current_user_role() = 'admin'
    and role <> 'super_admin'
  )
  with check (
    public.current_user_role() = 'admin'
    and role <> 'super_admin'
  );

create policy "invitation admin delete non-super"
  on public.invitation for delete
  using (
    public.current_user_role() = 'admin'
    and role <> 'super_admin'
  );
