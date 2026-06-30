import "server-only";
import { createAdminClient } from "./supabase/admin";
import type { RefreshResult } from "./megaphone-refresh-core";
import { apiRefresh } from "./megaphone-refresh-api";
import { listMegaphoneAccounts } from "./megaphone-accounts";
import { sendAlert } from "./email";

/**
 * Session refresh via the PRIVATE API (not a headless browser).
 *
 * The old browser-based refresh got bounced to Megaphone's sign-in page from
 * datacenter IPs (bot detection) and false-reported "expired" even while the
 * saved cookies were perfectly valid for the data API. This probes the same
 * authenticated API the sync uses — the real health signal — and rolls the
 * session cookies forward (see ./megaphone-refresh-api).
 */

type SessionRow = {
  organization_id: string | null;
  csrf_token: string | null;
  cookie_header: string | null;
  last_refresh_message: string | null;
};

const SESSION_COLS =
  "organization_id, csrf_token, cookie_header, last_refresh_message";

/** Refresh one account's session. */
export async function refreshAndPersist(
  account: string = "primary",
): Promise<RefreshResult> {
  const supabase = createAdminClient();

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

  if (!sess || !sess.organization_id || !sess.csrf_token || !sess.cookie_header) {
    return {
      ok: false,
      message: `No session for account "${account}". Run \`npm run megaphone:auth -- ${account}\`.`,
    };
  }

  const result = await apiRefresh({
    organizationId: sess.organization_id,
    csrfToken: sess.csrf_token,
    cookieHeader: sess.cookie_header,
  });

  const patch = {
    ...(result.ok
      ? { cookie_header: result.cookieHeader, csrf_token: result.csrfToken }
      : {}),
    last_refresh_at: new Date().toISOString(),
    last_refresh_status: result.ok ? "ok" : ("failed" as "ok" | "failed"),
    last_refresh_message: result.message,
  };
  const writer = supabase.from("megaphone_session").update(patch);
  await (useLegacyKey ? writer.eq("id", true) : writer.eq("account", account));

  // Alert only on the TRANSITION into the "expired" state (a real auth failure
  // now, not a browser bounce) — so no spam and no false alarms.
  const wasExpired = /expired/i.test(sess.last_refresh_message ?? "");
  const nowExpired = !result.ok && /expired/i.test(result.message ?? "");
  if (nowExpired && !wasExpired) {
    await sendAlert(
      `⚠️ Megaphone login needs re-seeding (${account})`,
      `Megaphone is rejecting the saved session for account "${account}" — ` +
        `the data API returned an auth failure, so a re-seed is needed.\n\n` +
        `${result.message}\n\nRun:\n\n  npm run megaphone:auth -- ${account}\n`,
    );
  } else if (result.ok && wasExpired) {
    await sendAlert(
      `✅ Megaphone login restored (${account})`,
      `Auto-refresh is healthy again for account "${account}".`,
    );
  }

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
