import "server-only";
import { createAdminClient } from "./supabase/admin";
import { runRefresh, type RefreshResult } from "./megaphone-refresh-core";
import { listMegaphoneAccounts } from "./megaphone-accounts";
import { sendAlert } from "./email";

/**
 * Server-only wrapper around the Playwright refresh. Reads a saved storage
 * state from `megaphone_session` (per account), runs the headless dance,
 * and persists the new cookies/CSRF/state + audit fields back to the row.
 */

type SessionRow = {
  organization_id: string | null;
  storage_state: any | null;
  last_refresh_message: string | null;
};

const SESSION_COLS = "organization_id, storage_state, last_refresh_message";

/** Refresh one account's session. */
export async function refreshAndPersist(
  account: string = "primary",
): Promise<RefreshResult> {
  const supabase = createAdminClient();

  // Read by account; fall back to the legacy singleton if not migrated.
  let sess: SessionRow | null = null;
  let useLegacyKey = false;
  const byAccount = await supabase
    .from("megaphone_session")
    .select(SESSION_COLS)
    .eq("account", account)
    .maybeSingle<SessionRow>();
  if (byAccount.error) {
    useLegacyKey = true;
    const legacy = await supabase
      .from("megaphone_session")
      .select(SESSION_COLS)
      .eq("id", true)
      .maybeSingle<SessionRow>();
    if (legacy.error) {
      return { ok: false, message: `DB read failed: ${legacy.error.message}` };
    }
    sess = legacy.data;
  } else {
    sess = byAccount.data;
  }

  if (!sess || !sess.organization_id) {
    return {
      ok: false,
      message: `No session for account "${account}". Run \`npm run megaphone:auth -- ${account}\`.`,
    };
  }
  if (!sess.storage_state) {
    return {
      ok: false,
      message: `No storage_state for "${account}". Run \`npm run megaphone:auth -- ${account}\`.`,
    };
  }

  const result = await runRefresh({
    organizationId: sess.organization_id,
    storageState: sess.storage_state,
  });

  const patch = {
    ...(result.ok
      ? {
          cookie_header: result.cookieHeader,
          csrf_token: result.csrfToken,
          storage_state: result.storageState,
        }
      : {}),
    last_refresh_at: new Date().toISOString(),
    last_refresh_status: result.ok ? "ok" : ("failed" as "ok" | "failed"),
    last_refresh_message: result.message,
  };
  const writer = supabase.from("megaphone_session").update(patch);
  await (useLegacyKey ? writer.eq("id", true) : writer.eq("account", account));

  // Alert only on the TRANSITION into the "expired" state — so a transient
  // timeout doesn't spam, and we fire exactly when a re-seed becomes needed.
  const wasExpired = /expired/i.test(sess.last_refresh_message ?? "");
  const nowExpired = !result.ok && /expired/i.test(result.message ?? "");
  if (nowExpired && !wasExpired) {
    await sendAlert(
      `⚠️ Megaphone login needs re-seeding (${account})`,
      `The dashboard can no longer auto-refresh the Megaphone session for ` +
        `account "${account}" — the saved login has fully expired.\n\n` +
        `${result.message}\n\n` +
        `Data syncs may keep running on cached cookies for a while, then stop. ` +
        `To restore auto-refresh, run:\n\n  npm run megaphone:auth -- ${account}\n`,
    );
  } else if (result.ok && wasExpired) {
    await sendAlert(
      `✅ Megaphone login restored (${account})`,
      `Auto-refresh is healthy again for account "${account}".`,
    );
  }

  // Don't ship the (huge) storage state back to the caller.
  if (result.storageState) result.storageState = undefined;
  return result;
}

/** Refresh every configured account; returns one result per account. */
export async function refreshAllAccounts(): Promise<
  Array<{ account: string; label: string; result: RefreshResult }>
> {
  const accounts = listMegaphoneAccounts();
  const out: Array<{ account: string; label: string; result: RefreshResult }> =
    [];
  for (const a of accounts) {
    out.push({
      account: a.key,
      label: a.label,
      result: await refreshAndPersist(a.key),
    });
  }
  return out;
}

export type { RefreshResult } from "./megaphone-refresh-core";