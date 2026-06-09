import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/session-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/permissions";
import { UsersAdminClient } from "./UsersAdminClient";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const session = await getServerSession();
  if (!session) redirect("/pending");
  if (!isAdmin(session)) redirect("/");

  const supabase = createAdminClient();
  const [users, podcasts, access, invites] = await Promise.all([
    supabase
      .from("user_profile")
      .select("user_id, email, full_name, role, active, created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("podcast")
      .select("id, title")
      .order("title"),
    supabase.from("user_podcast_access").select("user_id, podcast_id, access_level"),
    supabase
      .from("invitation")
      .select("id, email, role, accepted_at, revoked_at, created_at")
      .order("created_at", { ascending: false }),
  ]);

  return (
    <UsersAdminClient
      sessionRole={session.role}
      users={(users.data ?? []) as any}
      podcasts={(podcasts.data ?? []) as any}
      access={(access.data ?? []) as any}
      invites={(invites.data ?? []) as any}
    />
  );
}
