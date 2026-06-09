/**
 * Fail-fast accessors for Supabase env vars.
 *
 * The anon/url pair ships to the client (NEXT_PUBLIC_* prefix). The
 * service role key is server-only — `admin.ts` enforces this with the
 * `server-only` import.
 */

export function supabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL is not set. Add it to .env.local or your hosting env vars.",
    );
  }
  return url;
}

export function supabaseAnonKey(): string {
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY is not set. Add it to .env.local or your hosting env vars.",
    );
  }
  return key;
}

export function supabaseServiceKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. This key bypasses RLS and must only live in server env.",
    );
  }
  return key;
}
