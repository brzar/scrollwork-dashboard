"use client";

import { SessionProvider } from "@/lib/session";
import type { Session } from "@/lib/permissions";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";

/**
 * Shell layout: ink-50 canvas with a sidebar pulling cards on top of it.
 * No hard column divider — sidebar is darker ground, content is white
 * cards floating, exactly as Spotify-for-Creators does it.
 */
export function AppShell({
  session,
  children,
}: {
  session: Session;
  children: React.ReactNode;
}) {
  return (
    <SessionProvider session={session}>
      <div className="min-h-screen flex bg-canvas">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <Topbar />
          <main className="flex-1 px-10 pt-2 pb-16 max-w-[1240px] w-full mx-auto">
            {children}
          </main>
        </div>
      </div>
    </SessionProvider>
  );
}
