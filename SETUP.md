# Setup

## 1. Supabase project

1. Create a new project at [supabase.com](https://supabase.com).
2. In **Project Settings → API**, copy:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY`

3. Run the migration. Either:

   - **SQL Editor** in the Supabase dashboard: paste the contents of
     `supabase/migrations/20260608000000_initial.sql` and run, OR

   - **Supabase CLI** (recommended for repeatable deploys):
     ```bash
     supabase link --project-ref YOUR-REF
     supabase db push
     ```

4. **Auth → Providers → Google**: enable Google.
   - In Google Cloud Console, create an OAuth 2.0 Client.
   - Authorized redirect URI:
     `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`
   - Paste the client ID + secret into Supabase.
5. **Auth → URL Configuration**: add your app's callback URL.
   - `Site URL`: `https://your-app.com` (or `http://localhost:3000` for dev)
   - `Redirect URLs`: include `https://your-app.com/auth/callback` and the
     localhost equivalent.

## 2. Megaphone credentials

Megaphone requires per-network API tokens — request one from your
Megaphone account manager. You'll receive a token and your network UUID.

Set:
```
MEGAPHONE_API_TOKEN=...
MEGAPHONE_NETWORK_ID=...
```

> The token is server-only. Never prefix it with `NEXT_PUBLIC_`, and
> never log the `Authorization` header.

## 3. Local environment

```bash
cp .env.example .env.local
# Fill in the values from steps 1 and 2.
npm install
npm run dev
# Open http://localhost:3000
```

Set `SUPER_ADMIN_BOOTSTRAP_EMAIL=you@example.com` before your first
sign-in. The OAuth callback promotes you to `super_admin` if there are
no super admins yet. After you've confirmed it worked, clear the env
var.

## 4. First-time admin flow

1. Sign in with your Google account. You should land on the dashboard.
2. Open **Admin → Users** to confirm your account shows as Super Admin.
3. Open **Admin (overview)** and click **Sync podcasts** (or POST
   `/api/admin/sync`) to pull every podcast in your Megaphone network
   into the `podcast` table.
4. Invite other users from **Admin → Users**. Pick the lowest role that
   makes sense; you can always promote later.
5. For each creator/viewer, click **Manage access** and select which
   podcasts they can see.

## 4b. Auto-refresh Megaphone session with Playwright (recommended)

Megaphone's analytics live behind cookies that expire roughly every hour.
You can paste fresh ones manually from DevTools, but the better path is a
one-time interactive login that lets the dashboard refresh itself.

```bash
# One-time install of Chromium for Playwright
npx playwright install chromium

# Interactive login (opens a real Chrome window)
npm run megaphone:auth
```

When the window opens:
1. Sign in to cms.megaphone.fm normally (Google OAuth, 2FA, all of it).
2. Click into **Insights → Delivery**.
3. The script will detect the dashboard, capture cookies, save the full
   browser state to Supabase, and close the window automatically.

From then on, the dashboard's **Refresh now** button (Admin → Megaphone
session) and the **Sync everything** button will auto-refresh before
syncing. You can also schedule it from the command line:

```bash
# Test it manually
npm run megaphone:refresh

# Schedule it with launchd / cron / systemd timers, e.g.:
# */45 * * * * cd /path/to/repo && npm run megaphone:refresh
```

The captured browser session lives for weeks. You'll only need to re-run
`npm run megaphone:auth` if Megaphone explicitly signs you out.

## 5. Scheduling a metrics cache (optional)

If you hit Megaphone rate limits or want faster dashboards:

1. Generate a strong random string and set `CRON_SECRET=...`.
2. Configure your scheduler (Vercel Cron, GitHub Actions, etc.) to POST
   to `/api/admin/sync` with header:
   ```
   Authorization: Bearer $CRON_SECRET
   ```
3. (Future) The same pattern can populate the `cached_metric` table for
   long date-range queries.

## 6. Production deploy

- Set every variable from `.env.example` in your hosting provider's
  environment dashboard. **Never** commit `.env.local`.
- Vercel: project is auto-detected as Next.js. No special build settings.
- Confirm `NEXT_PUBLIC_APP_URL` points at the canonical production
  hostname and that the Google OAuth redirect URI in both Google Cloud
  Console and Supabase Auth Settings matches exactly.

## 7. Smoke test checklist

- [ ] `npm run typecheck` is clean.
- [ ] `npm run build` succeeds.
- [ ] Hitting `/` while logged-out redirects to `/login?next=/`.
- [ ] Hitting `/api/podcasts` while logged-out returns `401`.
- [ ] After login, a creator account with NO assigned podcasts sees an
      empty list, and hitting `/api/podcasts/<some-id>/metrics` for an
      unassigned podcast returns `404`.
- [ ] Audit log records `auth.login`, `user.invite`, `access.grant`,
      `access.revoke`, `podcast.sync`.
