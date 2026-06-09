# Megaphone Dashboard

A production-grade dashboard for podcast analytics and revenue from
[Megaphone](https://megaphone.fm). Users log in with Google, and only see
the podcasts they've been explicitly assigned to.

## Highlights

- **Next.js 14 (App Router)** + React + TypeScript.
- **Supabase** for auth, database, and row-level security.
- **Google OAuth** via Supabase.
- **Server-only** Megaphone API integration — the API token never
  reaches the browser.
- **Four roles** (super admin / admin / creator / viewer) and a
  per-user-per-podcast access table.
- **Audit log** of every admin action.
- **Rate-limited API routes**, **Zod-validated** inputs, **same-origin
  CSRF guard**, and a nonce-based **Content Security Policy**.

## Repository layout

```
megaphone-dashboard/
├── supabase/migrations/         # Schema + RLS (run on a fresh project)
├── src/
│   ├── middleware.ts            # Session refresh + CSP + auth gate
│   ├── lib/
│   │   ├── supabase/            # Client / server / admin clients
│   │   ├── megaphone.ts         # Megaphone API client (server-only)
│   │   ├── permissions.ts       # Roles + capability predicates
│   │   ├── session-server.ts    # Loads the current session (auth.getUser)
│   │   ├── security.ts          # requireAuth/requireRole, rate limit, CSP
│   │   ├── audit.ts             # Audit log writer
│   │   └── date-ranges.ts       # Preset date ranges + Zod schemas
│   ├── components/              # UI primitives + sidebar / topbar / chart
│   └── app/
│       ├── (auth)/login         # Google sign-in
│       ├── auth/callback        # OAuth code exchange + super-admin bootstrap
│       ├── pending              # "Awaiting access" landing for new users
│       ├── (app)/               # Dashboard, podcasts, admin
│       └── api/                 # All Megaphone access goes through here
└── .env.example
```

## Megaphone limitations found

These are documented in `src/lib/megaphone.ts` and surfaced in the UI
where relevant:

1. **Programmatic revenue isn't on every plan.** The `/podcasts/{id}/revenue`
   endpoint returns 403/404 on lower-tier networks. When that happens, the
   client falls back to an eCPM × downloads estimate and the UI tags the
   value with an `est` badge.
2. **Response shape drift.** Different network plans / API versions
   sometimes return `{ data: [...] }`, `{ downloads: [...] }`, or a bare
   array. `normalizeDownloads()` / `normalizeRevenue()` accept all three.
3. **No bulk downloads endpoint.** Per-episode trends require one call
   per episode; we cap concurrency on the detail page (top 10 episodes).
4. **No webhooks for revenue.** The cron sync (`/api/admin/sync`)
   refreshes the podcast list; per-call rate-limit handling lives in
   `callMegaphone()` (handles 429 + 5xx with exponential backoff and
   `Retry-After`).

## Setup

See [SETUP.md](./SETUP.md) for a step-by-step guide.

TL;DR:

```bash
cp .env.example .env.local
# Fill in Supabase + Megaphone credentials
npm install
# Run the SQL migration in your Supabase project
npm run dev
```

## Security

See [SECURITY.md](./SECURITY.md). Highlights:

- Megaphone token is server-only and never logged.
- All API routes start with `requireAuth()` or `requireRole(...)`.
- Mutating routes require a same-origin request.
- RLS enforces access control regardless of what the API does.
- Audit log captures every admin action (super_admin + admin reads).
- CSP uses a per-request nonce + `strict-dynamic`.
- Strict security headers (`X-Frame-Options`, `Referrer-Policy`,
  HSTS in production).

## What still needs manual configuration

A short checklist after deploy:

- [ ] Create the Supabase project and run `supabase/migrations/*.sql`.
- [ ] Enable **Google** as an auth provider in Supabase and add the
      OAuth client ID / secret from Google Cloud Console.
- [ ] In Supabase auth settings, add `https://YOUR-DOMAIN/auth/callback`
      to the allowed redirect URLs.
- [ ] Get a Megaphone API token + network ID from Megaphone support.
- [ ] Fill `.env.local` (or your hosting env) with the values from
      `.env.example`.
- [ ] Set `SUPER_ADMIN_BOOTSTRAP_EMAIL` to your own email, sign in once,
      then unset it.
- [ ] In the dashboard → Admin → trigger one sync (POST `/api/admin/sync`
      from the UI button, or via a one-off `curl`). This populates the
      `podcast` table from Megaphone.
- [ ] Optionally schedule a cron call to `/api/admin/sync` (Vercel Cron
      or external scheduler) with `Authorization: Bearer $CRON_SECRET`.
- [ ] Promote / invite other users from the Admin → Users panel.
