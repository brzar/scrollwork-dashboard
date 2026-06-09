# Security notes

The dashboard is built around the principle that **every access decision
is enforced server-side**. Frontend hiding is purely UX; the backend
never trusts the client.

## Trust boundaries

| Boundary               | Enforced by                                       |
| ---------------------- | ------------------------------------------------- |
| Browser ↔ Next.js      | Same-origin check on mutating routes; CSP nonce.  |
| Next.js ↔ Supabase     | RLS policies (anon key) or service-role (admin).  |
| Next.js ↔ Megaphone    | Server-only token; no Megaphone calls from client.|
| Admin → privileged ops | `requireRole(canManageUsers / canChangeRoles)`.   |

## Megaphone token handling

- Read once from `MEGAPHONE_API_TOKEN` in `src/lib/megaphone.ts`, which
  imports `server-only`. Bundling it into a client component would
  fail at build time.
- Sent only in the outbound `Authorization` header to
  `cms.megaphone.fm/api`. Never logged.
- Error responses from Megaphone include the request URL in `details`,
  but `safeError()` never forwards `details` to the client — only a
  generic `"Upstream metrics unavailable"`.

## Supabase keys

- `NEXT_PUBLIC_SUPABASE_ANON_KEY` ships to the client (intended). RLS
  policies enforce authorization regardless.
- `SUPABASE_SERVICE_ROLE_KEY` is loaded only via `createAdminClient()`
  in `src/lib/supabase/admin.ts`, which imports `server-only`. Used
  for:
  - admin user / access management (after `requireRole`)
  - the audit-log writer (so non-admin writes don't need an RLS policy)
  - the cron sync (after CRON_SECRET check OR admin role)

## API route checklist

Every non-public route handler in `src/app/api/**` follows the same
shape:

```ts
export async function POST(req: Request) {
  const originBlock = requireSameOrigin(req);       // CSRF guard
  if (originBlock) return originBlock;
  const auth = await requireRole(canManageUsers);   // Authentication + authorization
  if (auth.error) return auth.error;
  const rl = rateLimit(req, auth.session.userId, …); // Rate limit
  if (rl) return rl;

  const parsed = Schema.safeParse(await req.json()); // Zod validation
  if (!parsed.success) return safeError(400, "…");
  …
}
```

`safeError(status, message, internal?)` is the only sanctioned way to
return errors. It logs `internal` in dev and returns only the public
`message` to the client.

## Row-Level Security policies (summary)

- `user_profile`: self-select, admin-select; super_admin can change
  role/active; self-update of display fields only.
- `podcast`: visible if caller is admin OR has a matching row in
  `user_podcast_access`. Writes require admin.
- `user_podcast_access`: visible to self (read-only) + admins; writes
  require admin.
- `cached_metric`: visible iff `user_has_podcast_access(podcast_id)`.
- `audit_log`: visible to admin; writes via service-role only (no
  policy → blocked).
- `invitation`: admin-only.

The `current_user_role()` helper uses `SECURITY DEFINER` to avoid RLS
recursion. The `handle_new_auth_user()` trigger inserts a default
`viewer` profile (or consumes a pending invitation if one matches).

## Headers

Set in `applySecurityHeaders()`:

- `Content-Security-Policy`: nonce + `strict-dynamic` for scripts;
  inline styles allowed (Tailwind/Next requirement); `frame-ancestors
  'none'`; `object-src 'none'`.
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- `Permissions-Policy`: camera, microphone, geolocation, FLoC all denied.
- `Strict-Transport-Security` in production (2 years, includeSubDomains).

## Audit logging

Every mutating admin action calls `writeAudit()` (service-role insert
into `audit_log`). Captured fields:

- actor user_id + email
- action (`user.invite`, `user.role.change`, `user.deactivate`,
  `access.grant`, `access.revoke`, `podcast.sync`, `auth.login`,
  `auth.logout`)
- target type + id
- metadata (jsonb)
- client IP and user-agent

Audit failures are logged but never block the user request — losing a
single audit row is better than blocking a real action.

## Things to verify before going to production

- [ ] `SUPER_ADMIN_BOOTSTRAP_EMAIL` is **unset** in production after the
      first super admin has been created.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` and `MEGAPHONE_API_TOKEN` are stored
      in your hosting provider's secret manager, not in source control.
- [ ] Sign in as a low-privilege user and confirm:
      - `/api/admin/users` → 403
      - `/api/podcasts/<unassigned-id>/metrics` → 404
      - The user table in the Sidebar / Admin link is hidden
- [ ] `npm run build` produces no warnings about server-only modules
      being included in client bundles.
- [ ] The audit log records each of your test actions with the correct
      `actor_email` and IP.

## Known caveats

- The in-memory rate limiter in `security.ts` is per-process. On a
  multi-instance deploy you may want to swap it for Upstash Redis or
  Vercel KV. Per-IP throttling is best-effort, not a guarantee.
- Per-episode revenue is a network-plan feature on Megaphone. Where the
  endpoint isn't available, the client falls back to an eCPM estimate;
  the UI marks those values with an `est` badge.
