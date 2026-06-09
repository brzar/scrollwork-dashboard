import "server-only";
import { cookies } from "next/headers";
import { createAdminClient } from "./supabase/admin";

/**
 * Resolved dashboard theme for the current request.
 *
 * The source of truth is `app_settings.dark_mode` in Supabase — that's
 * what super_admin flips. A short-lived `theme` cookie mirrors the
 * setting so the first paint never flashes the wrong color (no FOUC).
 *
 * Fallback order:
 *   1. `theme` cookie (`light` | `dark`)
 *   2. Supabase `app_settings.dark_mode`
 *   3. `light`
 */

export type Theme = "light" | "dark";

const THEME_COOKIE = "theme";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export async function resolveTheme(): Promise<Theme> {
  const cookieStore = cookies();
  const fromCookie = cookieStore.get(THEME_COOKIE)?.value;
  if (fromCookie === "light" || fromCookie === "dark") return fromCookie;

  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("app_settings")
      .select("dark_mode")
      .eq("id", true)
      .maybeSingle();
    return data?.dark_mode ? "dark" : "light";
  } catch {
    return "light";
  }
}

export { THEME_COOKIE, COOKIE_MAX_AGE };
