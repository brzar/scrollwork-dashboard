import { Card, CardBody } from "@/components/ui/Card";

export const dynamic = "force-dynamic";

/**
 * Shown to users who signed in but don't have a usable session yet —
 * either their profile row hasn't been created (rare; trigger handles
 * this) or they've been deactivated. The middleware bounces them here
 * implicitly via getServerSession() returning null on protected pages,
 * so this also serves as a safe landing target.
 */
export default function PendingPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-ink-50">
      <Card className="w-full max-w-md">
        <CardBody className="p-8 text-center">
          <div className="w-12 h-12 rounded-xl bg-amber-100 text-amber-700 mx-auto flex items-center justify-center mb-3">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
          </div>
          <h1 className="text-base font-semibold text-ink-900">
            Awaiting access
          </h1>
          <p className="text-sm text-ink-500 mt-2">
            Your account exists but doesn't have access to any podcasts yet,
            or has been deactivated. Please contact your administrator.
          </p>
          <a
            href="/api/auth/logout"
            className="inline-block mt-4 text-xs text-ink-500 underline"
          >
            Sign out
          </a>
        </CardBody>
      </Card>
    </div>
  );
}
