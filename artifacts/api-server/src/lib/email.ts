import { Resend } from "resend";
import { logger } from "./logger";

const RESEND_API_KEY = process.env["RESEND_API_KEY"];
const DRIVER_EMAIL_FROM =
  process.env["DRIVER_EMAIL_FROM"] ?? "My Car Concierge <onboarding@resend.dev>";

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

if (!resend) {
  logger.warn("RESEND_API_KEY not set — driver notification emails will be skipped.");
}

const SIGN_IN_URL =
  process.env["DRIVER_SIGN_IN_URL"] ??
  (process.env["REPLIT_DOMAINS"]?.split(",")[0]
    ? `https://${process.env["REPLIT_DOMAINS"].split(",")[0]}/driver`
    : "https://mycarconcierge.com/driver");

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface SendResult {
  ok: boolean;
  skipped?: boolean;
  error?: string;
}

async function send(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<SendResult> {
  if (!resend) {
    return { ok: false, skipped: true };
  }
  try {
    const { error } = await resend.emails.send({
      from: DRIVER_EMAIL_FROM,
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    });
    if (error) {
      logger.error({ err: error, to: opts.to }, "email.send failed");
      return { ok: false, error: String(error.message ?? error) };
    }
    return { ok: true };
  } catch (err) {
    logger.error({ err, to: opts.to }, "email.send threw");
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function sendDriverApprovedEmail(opts: {
  to: string;
  firstName: string | null;
}): Promise<SendResult> {
  const name = opts.firstName?.trim() || "there";
  const subject = "You're approved to drive with My Car Concierge";
  const text = `Hi ${name},

Great news — your application has been approved! You can now sign in and start receiving ride requests.

Sign in: ${SIGN_IN_URL}

Welcome to the team,
My Car Concierge`;

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#1a2747;">
  <h1 style="font-size:24px;margin:0 0 16px;color:#1a2747;">You're approved! 🎉</h1>
  <p style="font-size:16px;line-height:1.5;margin:0 0 16px;">Hi ${escapeHtml(name)},</p>
  <p style="font-size:16px;line-height:1.5;margin:0 0 24px;">Great news — your application to drive with <strong>My Car Concierge</strong> has been approved. You can now sign in and start receiving ride requests.</p>
  <p style="margin:0 0 32px;"><a href="${SIGN_IN_URL}" style="display:inline-block;background:#c9a961;color:#1a2747;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Sign in to start driving</a></p>
  <p style="font-size:14px;color:#666;margin:0;">Welcome to the team,<br/>My Car Concierge</p>
</div>`;

  return send({ to: opts.to, subject, html, text });
}

export async function sendDriverRejectedEmail(opts: {
  to: string;
  firstName: string | null;
  reason: string;
}): Promise<SendResult> {
  const name = opts.firstName?.trim() || "there";
  const subject = "Update on your My Car Concierge application";
  const text = `Hi ${name},

Thank you for applying to drive with My Car Concierge. After reviewing your application, we are unable to approve it at this time.

Reason: ${opts.reason}

If you believe this was made in error or have questions, please reply to this email.

Best regards,
My Car Concierge`;

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#1a2747;">
  <h1 style="font-size:22px;margin:0 0 16px;color:#1a2747;">Update on your application</h1>
  <p style="font-size:16px;line-height:1.5;margin:0 0 16px;">Hi ${escapeHtml(name)},</p>
  <p style="font-size:16px;line-height:1.5;margin:0 0 16px;">Thank you for applying to drive with <strong>My Car Concierge</strong>. After reviewing your application, we are unable to approve it at this time.</p>
  <div style="background:#faf7f0;border-left:4px solid #c9a961;padding:16px;margin:0 0 24px;border-radius:4px;">
    <p style="font-size:14px;font-weight:600;margin:0 0 8px;color:#1a2747;">Reason</p>
    <p style="font-size:15px;line-height:1.5;margin:0;color:#333;">${escapeHtml(opts.reason)}</p>
  </div>
  <p style="font-size:15px;line-height:1.5;margin:0 0 24px;">If you believe this was made in error or have questions, please reply to this email.</p>
  <p style="font-size:14px;color:#666;margin:0;">Best regards,<br/>My Car Concierge</p>
</div>`;

  return send({ to: opts.to, subject, html, text });
}
