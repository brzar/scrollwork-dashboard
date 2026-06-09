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
  const { data: sess, error } = await supabase
    .from("megaphone_session")
    .select("organization_id, storage_state")
    .eq("id", true)
    .maybeSingle();
  if (error) {
    console.error("✗ DB read failed:", error.message);
    process.exit(2);
  }
  if (!sess?.storage_state) {
    console.error(
      "✗ No stored session. Run `npm run megaphone:auth` once first.",
    );
    process.exit(2);
  }

  console.log("→ Refreshing Megaphone session…");
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

  if (result.ok) {
    console.log("✓ Session refreshed.");
    process.exit(0);
  } else {
    console.error("✗", result.message);
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
