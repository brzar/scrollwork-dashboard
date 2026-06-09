import LoginClient from "./LoginClient";

// Nonce-based CSP requires per-request rendering. Without force-dynamic,
// statically pre-rendered HTML wouldn't carry the per-request nonce and
// the browser would refuse to run hydration scripts.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return <LoginClient />;
}
