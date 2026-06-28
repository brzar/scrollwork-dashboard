import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/session-server";
import { isAdmin } from "@/lib/permissions";
import { posterConfigured } from "@/lib/poster";
import { PosterClient } from "./PosterClient";

export const dynamic = "force-dynamic";

export default async function AdminPosterPage() {
  const session = await getServerSession();
  if (!session) redirect("/pending");
  if (!isAdmin(session)) redirect("/");

  return <PosterClient configured={posterConfigured()} />;
}
