import "server-only";

/**
 * Megaphone accounts.
 *
 * We support two separate Megaphone accounts, each with its own CMS API
 * token + network ID (env) and its own private web session (stored per
 * account in the `megaphone_session` table, keyed by `account`).
 *
 * Env:
 *   MEGAPHONE_API_TOKEN     / MEGAPHONE_NETWORK_ID     [/ MEGAPHONE_LABEL]    → "primary"
 *   MEGAPHONE_API_TOKEN_2   / MEGAPHONE_NETWORK_ID_2   [/ MEGAPHONE_LABEL_2]  → "secondary"
 *
 * Add the _2 vars to combine a second login. Each podcast row records
 * which account it came from (`podcast.megaphone_account`).
 */

export type MegaphoneAccountKey = "primary" | "secondary";

export type MegaphoneAccount = {
  key: MegaphoneAccountKey;
  label: string;
  apiToken: string;
  networkId: string;
};

/** All configured accounts, in priority order. */
export function listMegaphoneAccounts(): MegaphoneAccount[] {
  const out: MegaphoneAccount[] = [];

  const t1 = process.env.MEGAPHONE_API_TOKEN;
  const n1 = process.env.MEGAPHONE_NETWORK_ID;
  if (t1 && n1) {
    out.push({
      key: "primary",
      label: process.env.MEGAPHONE_LABEL?.trim() || "Account 1",
      apiToken: t1,
      networkId: n1,
    });
  }

  const t2 = process.env.MEGAPHONE_API_TOKEN_2;
  const n2 = process.env.MEGAPHONE_NETWORK_ID_2;
  if (t2 && n2) {
    out.push({
      key: "secondary",
      label: process.env.MEGAPHONE_LABEL_2?.trim() || "Account 2",
      apiToken: t2,
      networkId: n2,
    });
  }

  return out;
}

/** Look up one account by key. Throws if it isn't configured. */
export function getMegaphoneAccount(key: string): MegaphoneAccount {
  const acct = listMegaphoneAccounts().find((a) => a.key === key);
  if (!acct) {
    throw new Error(
      `Megaphone account "${key}" is not configured. Check the MEGAPHONE_* env vars.`,
    );
  }
  return acct;
}

/** Resolve an account for a podcast, defaulting to primary. */
export function accountForPodcast(account: string | null | undefined): MegaphoneAccount {
  const key = account || "primary";
  const found = listMegaphoneAccounts().find((a) => a.key === key);
  // Fall back to the first configured account if the stored key is gone.
  return found ?? listMegaphoneAccounts()[0];
}
