import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { supabaseServiceKey, supabaseUrl } from "./env";
import type { Database } from "./database.types";

/**
 * Service-role Supabase client. BYPASSES ROW-LEVEL SECURITY.
 *
 * Allowed callers:
 *   - server-only admin Route Handlers (after requireRole('super_admin'))
 *   - the cron sync endpoint (after auth check)
 *   - the audit-log writer
 *
 * NEVER import from a Client Component. The `server-only` import turns that
 * into a build-time error.
 */
let cached: ReturnType<typeof createSupabaseClient<Database>> | null = null;

export function createAdminClient() {
  if (cached) return cached;
  cached = createSupabaseClient<Database>(supabaseUrl(), supabaseServiceKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cached;
}
