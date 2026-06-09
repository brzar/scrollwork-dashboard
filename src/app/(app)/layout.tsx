import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/session-server";
import { AppShell } from "./AppShell";

// Per-request rendering so we always get a fresh session + nonce'd scripts.
export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession();
  if (!session) redirect("/pending");
  return <AppShell session={session}>{children}</AppShell>;
}
