import "server-only";
import { createAdminClient } from "./supabase/admin";
import { getClientIp, getUserAgent } from "./security";
import type { Session } from "./permissions";
import type { Json } from "./supabase/database.types";

export type AuditAction =
  | "user.invite"
  | "user.invite.revoke"
  | "user.role.change"
  | "user.deactivate"
  | "user.reactivate"
  | "access.grant"
  | "access.revoke"
  | "access.level.change"
  | "podcast.sync"
  | "podcast.splits.change"
  | "auth.login"
  | "auth.logout";

export type AuditWriteInput = {
  session: Session | null;
  action: AuditAction | string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Json;
  req?: Request;
};

/**
 * Insert one audit row. Uses the service-role client so callers don't have
 * to grant the calling user write access on audit_log (RLS allows reads
 * to admins; writes are gated to service-role).
 *
 * Never blocks the request path — failures are logged but swallowed.
 */
export async function writeAudit(input: AuditWriteInput): Promise<void> {
  const supabase = createAdminClient();
  try {
    await supabase.from("audit_log").insert({
      actor_id: input.session?.userId ?? null,
      actor_email: input.session?.email ?? null,
      action: input.action,
      target_type: input.targetType ?? null,
      target_id: input.targetId ?? null,
      metadata: input.metadata ?? {},
      ip: input.req ? getClientIp(input.req) : null,
      user_agent: input.req ? getUserAgent(input.req) : null,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[audit] write failed", err);
  }
}
