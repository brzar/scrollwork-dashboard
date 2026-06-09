/**
 * Pure Playwright refresh logic — no `server-only`, no DB access. The
 * server-only wrapper (`megaphone-refresh.ts`) and the CLI script
 * (`scripts/megaphone-refresh.ts`) both call into this so we have one
 * source of truth for the actual headless-browser dance.
 */

import type { BrowserContext } from "playwright";

/**
 * PostgreSQL's JSONB rejects ` ` (null bytes), which sometimes appear
 * in cookie values. Strip them recursively before persisting.
 */
function sanitizeForJsonb<T>(input: T): T {
  if (typeof input === "string") {
    // eslint-disable-next-line no-control-regex
    return input.replace(/ /g, "") as unknown as T;
  }
  if (Array.isArray(input)) return input.map(sanitizeForJsonb) as unknown as T;
  if (input && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) out[k] = sanitizeForJsonb(v);
    return out as unknown as T;
  }
  return input;
}

const REPORTS_PATH = "/reports/dashboard";
const DELIVERY_XHR_FRAGMENT = "/delivery/global_delivery.json";
const TIMEOUT_MS = 30_000;

export type RefreshResult = {
  ok: boolean;
  cookieHeader?: string;
  csrfToken?: string;
  organizationId?: string;
  storageState?: any;
  message: string;
};

export type RefreshInput = {
  organizationId: string;
  storageState: any;
};

/**
 * Drive a headless browser to refresh the Megaphone session. Returns the
 * captured cookies + CSRF and the rotated storage state on success.
 *
 * Does NOT touch the DB — callers persist (or not) based on `result.ok`.
 */
export async function runRefresh(input: RefreshInput): Promise<RefreshResult> {
  const { chromium } = await import("playwright");
  const dashboardUrl = `https://cms.megaphone.fm/organizations/${input.organizationId}${REPORTS_PATH}`;

  const browser = await chromium.launch({ headless: true });
  let context: BrowserContext | null = null;
  try {
    context = await browser.newContext({ storageState: input.storageState });
    const page = await context.newPage();

    const captured: { cookie?: string; csrf?: string } = {};
    page.on("request", (req) => {
      if (!req.url().includes(DELIVERY_XHR_FRAGMENT)) return;
      // allHeaders() returns the Cookie header; the sync .headers()
      // method strips it as a security default in modern Playwright.
      req
        .allHeaders()
        .then((headers) => {
          if (headers["cookie"]) captured.cookie = headers["cookie"];
          if (headers["x-csrf-token"]) captured.csrf = headers["x-csrf-token"];
        })
        .catch(() => {});
    });

    await Promise.race([
      page.goto(dashboardUrl, { waitUntil: "load", timeout: TIMEOUT_MS }),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error("Navigation timed out")), TIMEOUT_MS),
      ),
    ]);

    // The dashboard issues global_delivery.json automatically; we poll
    // because Megaphone's UI long-polls so networkidle never fires.
    const start = Date.now();
    while (Date.now() - start < TIMEOUT_MS) {
      if (captured.cookie && captured.csrf) break;
      await page.waitForTimeout(250);
    }

    if (!captured.cookie || !captured.csrf) {
      const url = page.url();
      const onLogin = /sign_in|login/i.test(url);
      return {
        ok: false,
        message: onLogin
          ? "Saved Megaphone session expired. Re-run `npm run megaphone:auth`."
          : `Refresh did not capture credentials (url=${url}).`,
      };
    }

    const storageState = sanitizeForJsonb(await context.storageState());

    return {
      ok: true,
      cookieHeader: captured.cookie,
      csrfToken: captured.csrf,
      organizationId: input.organizationId,
      storageState,
      message: "Refreshed",
    };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  } finally {
    if (context) await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
