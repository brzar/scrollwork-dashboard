# Deployment notes

This is a checklist to walk through **when you deploy to production** (Vercel
or similar). It's not needed for local development.

## TL;DR — open decisions to make at hosting time

These don't need answers yet, but mark them now so you don't forget:

- [ ] **Where will Megaphone session auto-refresh run?** Playwright doesn't
      fit in a Vercel function. Pick one at deploy time (see §5).
- [ ] **Where will the metrics cron run?** Either a Vercel Cron hitting
      `/api/admin/sync-metrics`, or the same worker as the refresh job
      (see §5).
- [ ] **Rotate the service-role key** before any real data lands (§7).
- [ ] **Custom domain?** Update env + OAuth redirects after (§8).

---

## 1. Push to GitHub

```bash
cd /Users/jonathan/Desktop/Claude/megaphone-dashboard
git init
git add .
git commit -m "Initial commit"
gh repo create megaphone-dashboard --private --source=. --push
# (or create the repo manually on github.com and `git push` to it)
```

`.gitignore` already excludes `.env.local`, so secrets stay on your machine.

---

## 2. Import into Vercel

1. https://vercel.com/new → pick the GitHub repo.
2. **Framework preset**: Next.js (auto-detected).
3. **Build command / output**: leave defaults.
4. Hit **Deploy**. The first build will fail because env vars aren't set yet —
   that's expected.

---

## 3. Set environment variables in Vercel

Project → **Settings → Environment Variables**. Add all of these for
**Production** (and copy to Preview if you want PR deploys to work):

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | from Supabase API settings |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from Supabase API settings |
| `SUPABASE_SERVICE_ROLE_KEY` | from Supabase API settings |
| `MEGAPHONE_API_TOKEN` | the token from `.env.local` |
| `MEGAPHONE_NETWORK_ID` | `4d84bafe-f5c3-11f0-8bfe-8b8eece1265b` |
| `NEXT_PUBLIC_APP_URL` | `https://your-domain.vercel.app` (or custom) |
| `SUPER_ADMIN_BOOTSTRAP_EMAIL` | leave **empty** (already bootstrapped) |
| `CRON_SECRET` | generate one (`openssl rand -hex 32`) — see step 5 |

Redeploy once vars are set.

---

## 4. Update OAuth + Supabase URLs

After the first successful deploy:

1. **Google Cloud Console** → your OAuth client → **Authorized redirect URIs** →
   add `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`
   (you might already have this — confirm it).
2. **Supabase** → **Authentication → URL Configuration**:
   - **Site URL**: `https://your-prod-domain.com`
   - **Redirect URLs**: add `https://your-prod-domain.com/auth/callback`
   (keep the localhost one so dev still works).

---

## 5. Schedule the metrics cron ⚠️ TODO when deploying

Once deployed, add a Vercel Cron that hits `/api/admin/sync-metrics` every few
hours. This keeps the cached_metric table fresh without anyone clicking the
button.

Create `vercel.json` at the repo root:

```json
{
  "crons": [
    {
      "path": "/api/admin/sync-metrics",
      "schedule": "0 */6 * * *"
    }
  ]
}
```

That cron runs every 6 hours. Vercel automatically sends an
`Authorization: Bearer $CRON_SECRET` header on its own cron invocations — our
endpoint already checks for that.

**Important caveat — Megaphone session refresh on serverless:**

The Megaphone analytics JWT expires every ~1 hour and has to be refreshed
by a real browser. The repo includes Playwright-based auto-refresh
(`/api/admin/megaphone-refresh`, see SETUP.md §4b), but Playwright ships
~500 MB of Chromium binaries and **won't fit in Vercel's 50 MB function
limit**.

### Recommended pattern: small worker on Fly.io / Railway

This keeps everything automated and doesn't depend on your laptop being
awake. Roughly:

1. Spin up a $0–5/month container on Fly.io, Railway, Render, or any
   small VPS (256 MB RAM is plenty).
2. Deploy the same repo to that worker. Set the same env vars.
3. On the worker, run a single cron:
   ```
   */45 * * * * cd /app && npm run megaphone:refresh
   ```
4. Optionally on the same worker, every few hours:
   ```
   0 */6 * * * curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://your-app.com/api/admin/sync-metrics
   ```
   (or call the local `syncMetrics` function directly).

The worker never serves traffic — it just keeps Supabase fresh. Vercel
keeps serving the actual dashboard.

### Alternative patterns

- **Run refresh on your own laptop** if it's always-on. Add to crontab:
  ```
  */45 * * * * cd /Users/you/megaphone-dashboard && /opt/homebrew/bin/npm run megaphone:refresh
  ```
  Simplest, no extra infra, but breaks when the laptop sleeps.
- **Skip auto-refresh entirely** — paste cookies manually from DevTools
  every few hours via Admin → Megaphone session. Fine for personal /
  occasional use.

---

## 6. Production smoke test

After deploying:

- [ ] Sign in via Google.
- [ ] Hit `/api/podcasts` while logged-out → 401.
- [ ] Sign in as a low-privilege test user → `/admin/users` → 403.
- [ ] Run the sync button → metrics populate.
- [ ] Wait 6 hours, confirm the Vercel Cron runs and the "last synced" time
      on the dashboard updates.
- [ ] Open Supabase → audit_log table → verify `auth.login`, `metrics.sync`,
      `access.grant` rows appear with correct `actor_email` and IP.

---

## 7. Rotate the service-role key (one-time, important)

The Supabase service-role key has been visible in this Claude conversation's
transcript. Before going to production with real data:

1. Supabase → **Project Settings → API → Reset service_role secret**.
2. Update `SUPABASE_SERVICE_ROLE_KEY` in Vercel env vars.
3. Redeploy.
4. Update your local `.env.local` too.

The anon key doesn't need rotation (it's public by design).

---

## 8. Custom domain (optional)

Vercel → Project → **Settings → Domains** → add your domain. Then update:

- `NEXT_PUBLIC_APP_URL` env var → new domain
- Supabase auth redirect URLs → add the new domain's `/auth/callback`
- Google OAuth → no change needed (the redirect is to Supabase, not your app)

Redeploy after env changes.
