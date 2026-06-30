/* eslint-disable no-console */
/**
 * Headless Megaphone session refresh. Run unattended (cron / GitHub Actions).
 *
 *   npm run megaphone:refresh            # all accounts
 *   npm run megaphone:refresh -- secondary
 *
 * Probes the authenticated private API (which works from datacenter IPs) and
 * rolls the session cookies forward — no headless browser, so it can't be
 * false-bounced to Megaphone's sign-in page. Requires `npm run megaphone:auth`
 * to have seeded a session at least once.
 */

import * as path from "node:path";
import * as dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { apiRefresh } from "../src/lib/megaphone-refresh-api";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function emailAlert(subject: string, text: string) {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.ALERT_EMAIL_TO;
  if (!key || !to) return;
  const from = process.env.ALERT_EMAIL_FROM || "Scrollwork <onboarding@resend.dev>";
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, text }),
    });
  } catch {
    /* never throw from alerting */
  }
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.",
    );
    process.exit(1);
  }

  const supabase = createClient(url, key);

  const only = (process.argv[2] || "").trim();
  const query = supabase
    .from("megaphone_session")
    .select(
      "account, organization_id, csrf_token, cookie_header, last_refresh_message",
    );
  const { data: rows, error } = only ? await query.eq("account", only) : await query;
  if (error) {
    console.error("✗ DB read failed:", error.message);
    process.exit(2);
  }
  if (!rows || rows.length === 0) {
    console.error("✗ No stored sessions. Run `npm run megaphone:auth` once first.");
    process.exit(2);
  }

  let anyFailed = false;
  for (const sess of rows) {
    const account = sess.account ?? "primary";
    if (!sess.organization_id || !sess.csrf_token || !sess.cookie_header) {
      console.error(`✗ ${account}: incomplete session — run megaphone:auth.`);
      anyFailed = true;
      continue;
    }
    console.log(`→ Refreshing "${account}"…`);
    const result = await apiRefresh({
      organizationId: sess.organization_id,
      csrfToken: sess.csrf_token,
      cookieHeader: sess.cookie_header,
    });

    await supabase
      .from("megaphone_session")
      .update({
        ...(result.ok
          ? { cookie_header: result.cookieHeader, csrf_token: result.csrfToken }
          : {}),
        last_refresh_at: new Date().toISOString(),
        last_refresh_status: result.ok ? "ok" : "failed",
        last_refresh_message: result.message,
      })
      .eq("account", account);

    // Alert only on the transition into a genuine auth failure.
    const wasExpired = /expired/i.test(sess.last_refresh_message ?? "");
    const nowExpired = !result.ok && /expired/i.test(result.message);
    if (nowExpired && !wasExpired) {
      await emailAlert(
        `⚠️ Megaphone login needs re-seeding (${account})`,
        `Megaphone is rejecting the saved session for "${account}". Run:\n\n` +
          `  npm run megaphone:auth -- ${account}\n`,
      );
    } else if (result.ok && wasExpired) {
      await emailAlert(
        `✅ Megaphone login restored (${account})`,
        `Auto-refresh is healthy again for "${account}".`,
      );
    }

    if (result.ok) {
      console.log(`✓ ${account}: refreshed.`);
    } else {
      console.error(`✗ ${account}: ${result.message}`);
      // A transient probe error isn't a hard failure; only fail on real expiry.
      if (/expired/i.test(result.message)) anyFailed = true;
    }
  }

  process.exit(anyFailed ? 2 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
