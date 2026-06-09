import "server-only";
import { createAdminClient } from "./supabase/admin";
import { runRefresh, type RefreshResult } from "./megaphone-refresh-core";

/**
 * Server-only wrapper around the Playwright refresh. Reads the saved
 * storage state from `megaphone_session`, runs the headless dance, and
 * persists the new cookies/CSRF/state + audit fields back to the row.
 */

type SessionRow = {
  organization_id: string;
  storage_state: any | null;
};

export async function refreshAndPersist(): Promise<RefreshResult> {
  const supabase = createAdminClient();
  const { data: sess, error } = await supabase
    .from("megaphone_session")
    .select("organization_id, storage_state")
    .eq("id", true)
    .maybeSingle<SessionRow>();

  if (error) return { ok: false, message: `DB read failed: ${error.message}` };
  if (!sess) {
    return {
      ok: false,
      message: "No megaphone_session row. Run `npm run megaphone:auth` once to seed.",
    };
  }
  if (!sess.storage_state) {
    return {
      ok: false,
      message: "No storage_state on file. Run `npm run megaphone:auth` to seed it.",
    };
  }

  const result = await runRefresh({
    organizationId: sess.organization_id,
    storageState: sess.storage_state,
  });

  await supabase
    .from("megaphone_session")
    .update({
      ...(result.ok
        ? {
            cookie_header: result.cookieHeader,
            csrf_token: result.csrfToken,
            storage_state: result.storageState,
          }
        : {}),
      last_refresh_at: new Date().toISOString(),
      last_refresh_status: result.ok ? "ok" : "failed",
      last_refresh_message: result.message,
    })
    .eq("id", true);

  // Don't ship the (huge) storage state back to the caller.
  if (result.storageState) result.storageState = undefined;
  return result;
}

export type { RefreshResult } from "./megaphone-refresh-core";
