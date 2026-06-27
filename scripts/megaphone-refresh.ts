/* eslint-disable no-console */
/**
 * Headless Megaphone session refresh. Run unattended.
 *
 *   npm run megaphone:refresh
 *
 * Schedule it (macOS launchd, Linux cron, etc.) every ~45 min and the
 * dashboard's metrics will stay fresh without manual intervention.
 *
 * Requires that `npm run megaphone:auth` has been run at least once.
 */

import * as path from "node:path";
import * as dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { runRefresh } from "../src/lib/megaphone-refresh-core";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local.",
    );
    process.exit(1);
  }

  const supabase = createClient(url, key);

  // Refresh every account row that has a stored session. (Pass an account
  // arg to refresh just one: npm run megaphone:refresh -- secondary)
  const only = (process.argv[2] || "").trim();
  const query = supabase
    .from("megaphone_session")
    .select("account, organization_id, storage_state");
  const { data: rows, error } = only
    ? await query.eq("account", only)
    : await query;
  if (error) {
    console.error("✗ DB read failed:", error.message);
    process.exit(2);
  }
  if (!rows || rows.length === 0) {
    console.error(
      "✗ No stored sessions. Run `npm run megaphone:auth` once first.",
    );
    process.exit(2);
  }

  let anyFailed = false;
  for (const sess of rows) {
    const account = sess.account ?? "primary";
    if (!sess.storage_state || !sess.organization_id) {
      console.error(`✗ ${account}: no stored session — run megaphone:auth.`);
      anyFailed = true;
      continue;
    }
    console.log(`→ Refreshing "${account}"…`);
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
      .eq("account", account);
    if (result.ok) {
      console.log(`✓ ${account}: refreshed.`);
    } else {
      console.error(`✗ ${account}: ${result.message}`);
      anyFailed = true;
    }
  }

  process.exit(anyFailed ? 2 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
