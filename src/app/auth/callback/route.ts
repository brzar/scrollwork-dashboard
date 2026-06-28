import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * OAuth callback. Supabase redirects here with `?code=...`. We exchange
 * the code for a session cookie and bounce to the original destination.
 *
 * `next` is restricted to on-site paths to prevent open redirects.
 *
 * If SUPER_ADMIN_BOOTSTRAP_EMAIL matches the user's email and there are
 * no super_admins yet, we promote them here. Documented in SETUP.md.
 */
export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get("code");
  const rawNext = searchParams.get("next") ?? "/";
  const next =
    rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`); // whitelisted in LoginClient.KNOWN_ERRORS
  }

  const supabase = createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    // Don't reflect upstream error.message into the URL — it may carry
    // internal info and lets a phishing kit place any string on a real
    // Scrollwork login screen. The login UI maps a fixed set of codes
    // to user-visible messages.
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.error("auth.callback exchange failed:", error.message);
    }
    return NextResponse.redirect(`${origin}/login?error=login_failed`);
  }

  const admin = createAdminClient();
  const userId = data.user!.id;
  const userEmail = (data.user?.email || "").toLowerCase();

  // Bootstrap super-admin: if this email is configured AND no super_admin
  // exists yet, create the profile here. The trigger refuses to create
  // profiles for uninvited users, so bootstrap can't piggyback on it.
  const bootstrapEmail = (process.env.SUPER_ADMIN_BOOTSTRAP_EMAIL || "")
    .trim()
    .toLowerCase();
  if (bootstrapEmail && userEmail && bootstrapEmail === userEmail) {
    try {
      const { data: existingSuper } = await admin
        .from("user_profile")
        .select("user_id")
        .eq("role", "super_admin")
        .limit(1);
      if (!existingSuper || existingSuper.length === 0) {
        // Upsert: idempotent if the user signs in twice during setup.
        await admin
          .from("user_profile")
          .upsert(
            {
              user_id: userId,
              email: data.user?.email || "",
              full_name:
                (data.user?.user_metadata as { full_name?: string; name?: string } | null)
                  ?.full_name ??
                (data.user?.user_metadata as { full_name?: string; name?: string } | null)
                  ?.name ??
                null,
              avatar_url:
                (data.user?.user_metadata as { avatar_url?: string; picture?: string } | null)
                  ?.avatar_url ??
                (data.user?.user_metadata as { avatar_url?: string; picture?: string } | null)
                  ?.picture ??
                null,
              role: "super_admin",
              active: true,
            },
            { onConflict: "user_id" },
          );
        await writeAudit({
          session: null,
          action: "user.role.change",
          targetType: "user",
          targetId: userId,
          metadata: { reason: "bootstrap", role: "super_admin" },
          req,
        });
      }
    } catch {
      // Don't block login on bootstrap failures; the post-check below
      // will still gate the session if no profile ended up being created.
    }
  }

  // Claim a pending invitation if there's no profile yet.
  //
  // The signup trigger only fires on the FIRST auth.users insert. If a
  // person signed in BEFORE being invited (their auth row already exists),
  // the trigger never re-fires and they'd be stuck forever. This runs on
  // every login, so an invite that arrives after a sign-in still takes
  // effect on the next attempt.
  if (userEmail) {
    const { data: existingProfile } = await admin
      .from("user_profile")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (!existingProfile) {
      const { data: invite } = await admin
        .from("invitation")
        .select("id, role, partner_name, podcast_access, invited_by, is_demo")
        .ilike("email", userEmail)
        .is("accepted_at", null)
        .is("revoked_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (invite) {
        const meta = (data.user?.user_metadata ?? {}) as {
          full_name?: string;
          name?: string;
          avatar_url?: string;
          picture?: string;
        };
        const { error: insErr } = await admin.from("user_profile").insert({
          user_id: userId,
          email: data.user?.email || "",
          full_name: meta.full_name ?? meta.name ?? null,
          avatar_url: meta.avatar_url ?? meta.picture ?? null,
          role: invite.role,
          active: true,
          partner_name: invite.partner_name ?? null,
          is_demo: invite.is_demo ?? false,
        });
        if (!insErr) {
          await admin
            .from("invitation")
            .update({ accepted_at: new Date().toISOString() })
            .eq("id", invite.id);
          const grants = Array.isArray(invite.podcast_access)
            ? (invite.podcast_access as Array<{
                podcast_id?: string;
                access_level?: string;
              }>)
            : [];
          const rows = grants
            .filter((g) => g.podcast_id)
            .map((g) => ({
              user_id: userId,
              podcast_id: g.podcast_id as string,
              access_level: (g.access_level ?? "read") as
                | "read"
                | "write"
                | "admin",
              granted_by: invite.invited_by ?? null,
            }));
          if (rows.length > 0) {
            await admin
              .from("user_podcast_access")
              .upsert(rows, { onConflict: "user_id,podcast_id" });
          }
          await writeAudit({
            session: null,
            action: "user.invite.claimed",
            targetType: "user",
            targetId: userId,
            metadata: { role: invite.role, via: "callback" },
            req,
          });
        }
      }
    }
  }

  // Hard gate: if no user_profile exists for this user OR the profile is
  // disabled, sign the OAuth session out and bounce them to /login with
  // an `unauthorized` error. The trigger only creates profiles for users
  // with a matching invitation, so uninvited Google accounts hit this
  // path and get fully shut out — they never reach the dashboard, not
  // even an empty one.
  const { data: profile } = await admin
    .from("user_profile")
    .select("active")
    .eq("user_id", userId)
    .maybeSingle();

  const profileOk =
    !!profile && (profile as { active?: boolean }).active !== false;

  if (!profileOk) {
    await writeAudit({
      session: null,
      action: "auth.login.rejected",
      targetType: "user",
      targetId: userId,
      metadata: {
        email: data.user?.email || null,
        reason: !profile ? "no_invitation" : "deactivated",
      },
      req,
    });
    // Clear the freshly-issued session cookies so they leave logged-out.
    // signOut() runs against the user-scoped server client (the one that
    // exchangeCodeForSession just bound the cookies to).
    try {
      await supabase.auth.signOut();
    } catch {
      // Swallow — even if signOut fails, the redirect below still ends
      // the user's flow; getServerSession() will return null because
      // there's no profile.
    }
    return NextResponse.redirect(`${origin}/login?error=unauthorized`);
  }

  await writeAudit({
    session: data.user
      ? {
          userId,
          email: data.user.email || "",
          fullName: null,
          avatarUrl: null,
          role: "viewer",
          partnerName: null,
            isDemo: false,
        }
      : null,
    action: "auth.login",
    targetType: "user",
    targetId: userId,
    req,
  });

  return NextResponse.redirect(`${origin}${next}`);
}
