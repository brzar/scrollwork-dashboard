"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardBody } from "@/components/ui/Card";
import { createClient } from "@/lib/supabase/client";

export default function LoginClient() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}

/**
 * Whitelist of error codes we'll surface from the URL. Any other value
 * collapses to a generic message — never reflect attacker-controlled text
 * back to a user on a real login screen (phishing trust transfer).
 */
const KNOWN_ERRORS: Record<string, string> = {
  missing_code: "Sign-in was cancelled. Try again.",
  login_failed: "Sign-in failed. Please try again.",
  unauthorized: "This account doesn't have access yet.",
};

function decodeError(raw: string | null): string | null {
  if (!raw) return null;
  if (Object.prototype.hasOwnProperty.call(KNOWN_ERRORS, raw)) {
    return KNOWN_ERRORS[raw];
  }
  return "Sign-in failed. Please try again.";
}

function LoginPageInner() {
  const params = useSearchParams();
  const nextRaw = params.get("next") || "/";
  const next =
    nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/";

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(decodeError(params.get("error")));

  async function onGoogle() {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
      const { error: err } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo },
      });
      if (err) {
        setError(err.message);
        setLoading(false);
      }
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-ink-50 via-white to-brand/5">
      <Card className="w-full max-w-sm">
        <CardBody className="p-8">
          <div className="flex flex-col items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-xl bg-brand text-white flex items-center justify-center font-semibold text-lg shadow-sm">
              S
            </div>
            <div className="text-center">
              <h1 className="font-semibold text-ink-900">Scrollwork Dashboard</h1>
              <p className="text-xs text-ink-500 mt-0.5">
                Podcast analytics & revenue
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onGoogle}
            disabled={loading}
            className="w-full inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-lg text-sm font-medium border border-ink-200 bg-white text-ink-900 hover:bg-ink-50 transition disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
          >
            <GoogleIcon />
            {loading ? "Redirecting…" : "Continue with Google"}
          </button>

          {error ? (
            <div className="text-sm text-red-600 text-center mt-4">{error}</div>
          ) : null}

          <p className="text-xs text-ink-400 text-center mt-6">
            Access is restricted to authorized accounts.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.28 1.48-1.13 2.73-2.4 3.57v2.96h3.88c2.27-2.09 3.58-5.17 3.58-8.77z"/>
      <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.94-2.92l-3.88-2.96c-1.08.72-2.45 1.15-4.06 1.15-3.12 0-5.76-2.1-6.71-4.93H1.29v3.09C3.26 21.3 7.3 24 12 24z"/>
      <path fill="#FBBC05" d="M5.29 14.34c-.24-.72-.38-1.48-.38-2.27s.14-1.55.38-2.27V6.71H1.29C.47 8.31 0 10.1 0 12s.47 3.69 1.29 5.29l4-3.1z"/>
      <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.58 1.79l3.43-3.43C17.95 1.18 15.24 0 12 0 7.3 0 3.26 2.7 1.29 6.71l4 3.1c.95-2.83 3.59-4.94 6.71-4.94z"/>
    </svg>
  );
}
