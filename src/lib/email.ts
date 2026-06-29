import "server-only";

/**
 * Minimal transactional-email helper (Resend). No-op unless RESEND_API_KEY
 * and ALERT_EMAIL_TO are set, and never throws — alerting must not break the
 * job that's reporting a problem.
 */

const KEY = process.env.RESEND_API_KEY ?? "";
const TO = process.env.ALERT_EMAIL_TO ?? "";
const FROM =
  process.env.ALERT_EMAIL_FROM || "Scrollwork <onboarding@resend.dev>";

export function alertsEnabled(): boolean {
  return Boolean(KEY && TO);
}

export async function sendAlert(subject: string, text: string): Promise<void> {
  if (!alertsEnabled()) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM, to: [TO], subject, text }),
    });
  } catch {
    // swallow — never throw from alerting
  }
}
