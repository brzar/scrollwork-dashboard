import crypto from "crypto";

/**
 * Signed personal tokens for external tools (Life Hub).
 *
 * Stateless: HMAC-SHA256 over a base64url payload, keyed with
 * EXTERNAL_API_TOKEN. A token pins the dashboard user id and their partner
 * identity, so /api/external/owner-take can serve each user THEIR take.
 * Rotating EXTERNAL_API_TOKEN revokes every issued token at once.
 */

export type ExternalIdentity = { u: string; p: string };

const key = () => process.env.EXTERNAL_API_TOKEN ?? "";

export function signExternalToken(identity: ExternalIdentity): string {
  const body = Buffer.from(
    JSON.stringify({ ...identity, t: Date.now() }),
  ).toString("base64url");
  const sig = crypto.createHmac("sha256", key()).update(body).digest("base64url");
  return `swt_${body}.${sig}`;
}

export function verifyExternalToken(token: string): ExternalIdentity | null {
  if (!key() || !token.startsWith("swt_")) return null;
  const [body, sig] = token.slice(4).split(".");
  if (!body || !sig) return null;
  const want = crypto.createHmac("sha256", key()).update(body).digest("base64url");
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  } catch {
    return null;
  }
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    return typeof p.u === "string" && typeof p.p === "string"
      ? { u: p.u, p: p.p }
      : null;
  } catch {
    return null;
  }
}
