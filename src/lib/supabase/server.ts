import "server-only";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { supabaseAnonKey, supabaseUrl } from "./env";
import type { Database } from "./database.types";

/**
 * Supabase client for Server Components, Server Actions, and Route Handlers.
 * Uses anon key — RLS enforces access.
 *
 * Cookie writes in Server Components throw; we swallow the error because
 * middleware already refreshes tokens. Route Handlers and Server Actions
 * get a mutable cookie store and can persist refreshed sessions.
 */
export function createClient() {
  const cookieStore = cookies();

  return createServerClient<Database>(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value, ...options });
        } catch {
          // Server Component context — safe to ignore.
        }
      },
      remove(name: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value: "", ...options });
        } catch {
          // Same.
        }
      },
    },
  });
}
