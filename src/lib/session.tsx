"use client";

import { createContext, useContext } from "react";
import type { Session } from "./permissions";

const Ctx = createContext<Session | null>(null);

export function SessionProvider({
  session,
  children,
}: {
  session: Session;
  children: React.ReactNode;
}) {
  return <Ctx.Provider value={session}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error(
      "useSession must be called inside a SessionProvider — wrap your subtree with AppShell.",
    );
  }
  return v;
}
