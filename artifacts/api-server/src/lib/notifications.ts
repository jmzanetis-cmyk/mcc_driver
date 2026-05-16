// ============================================================
// Tandem Phase 3c — Notification helpers (SMS via Twilio + push)
// ============================================================
//
// Centralized templates for every Section-12 notification event that
// belongs to Phase 3 of the tandem flow. Each helper resolves recipient
// contact info from the database, formats a short SMS message with a
// deep link, and delivers via Twilio (SMS) and the existing Supabase
// Realtime channel (push transport).
//
// Phase 4/5 callers can reuse these helpers; new events should be added
// alongside the existing ones rather than scattering Twilio calls.
//
// Configuration: requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and
// TWILIO_FROM_NUMBER. If any of those are missing the helpers log a
// warning and skip SMS — push (Realtime) still fires from the route
// layer via the existing supabase mirror.

import { eq, inArray } from "drizzle-orm";
import {
  db,
  driversTable,
  rideAlongDriversTable,
  ridesTable,
  tandemJobsTable,
} from "@workspace/db";
import { logger } from "./logger";

// ── Twilio client (lazy) ────────────────────────────────────────────────────
type TwilioClient = import("twilio").Twilio;
type TwilioFactory = (sid: string, token: string) => TwilioClient;

let cachedClient: TwilioClient | null = null;

async function getTwilioClient(): Promise<TwilioClient | null> {
  const sid = process.env["TWILIO_ACCOUNT_SID"];
  const token = process.env["TWILIO_AUTH_TOKEN"];
  if (!sid || !token) return null;
  if (cachedClient) return cachedClient;
  try {
    const mod = (await import("twilio")) as unknown as { default: TwilioFactory };
    cachedClient = mod.default(sid, token);
    return cachedClient;
  } catch (err) {
    logger.error({ err }, "tandem.notifications: failed to init Twilio client");
    return null;
  }
}

// ── Deep link helpers ───────────────────────────────────────────────────────
function appBaseUrl(): string {
  const explicit = process.env["APP_BASE_URL"];
  if (explicit) return explicit.replace(/\/$/, "");
  const replitDomain = (process.env["REPLIT_DOMAINS"] ?? "").split(",")[0]?.trim();
  if (replitDomain) return `https://${replitDomain}`;
  return "https://app.mycarconcierge.com";
}

function rideAlongDashboardLink(): string {
  return `${appBaseUrl()}/driver/ride-along`;
}
function providerMatchLink(tandemJobId: string): string {
  return `${appBaseUrl()}/driver/tandem/${tandemJobId}/match`;
}
function memberApprovalLink(tandemJobId: string): string {
  return `${appBaseUrl()}/driver/tandem/${tandemJobId}/approve`;
}

// ── SMS sender ──────────────────────────────────────────────────────────────
async function sendSms(to: string, body: string): Promise<void> {
  if (!to) return;
  const client = await getTwilioClient();
  const from = process.env["TWILIO_FROM_NUMBER"];
  if (!client || !from) {
    logger.warn(
      { to, preview: body.slice(0, 60) },
      "tandem.notifications.sms_skipped (Twilio not configured)",
    );
    return;
  }
  try {
    const result = await client.messages.create({ to, from, body });
    logger.info({ to, sid: result.sid }, "tandem.notifications.sms_sent");
  } catch (err) {
    logger.error({ err, to }, "tandem.notifications.sms_failed");
  }
}

// ── Push transport ──────────────────────────────────────────────────────────
// We don't yet have a real push pipeline (FCM/APNs) for the driver app;
// the existing Supabase Realtime mirror already pushes UPDATE events to
// subscribed clients. We log a structured "push" entry so it shows up in
// observability alongside the SMS attempt, but no network call is made.
function logPush(
  channel: string,
  audience: { kind: string; id: string },
  payload: Record<string, unknown>,
): void {
  logger.info(
    { channel, audience, payload },
    "tandem.notifications.push (delivered via Supabase Realtime mirror)",
  );
}

// ── Internal: fetch ride+tandem context ─────────────────────────────────────
interface TandemContext {
  job: typeof tandemJobsTable.$inferSelect;
  ride: typeof ridesTable.$inferSelect;
}

async function loadContext(tandemJobId: string): Promise<TandemContext | null> {
  const [job] = await db
    .select()
    .from(tandemJobsTable)
    .where(eq(tandemJobsTable.id, tandemJobId))
    .limit(1);
  if (!job) return null;
  const [ride] = await db
    .select()
    .from(ridesTable)
    .where(eq(ridesTable.id, job.rideId))
    .limit(1);
  if (!ride) return null;
  return { job, ride };
}

// ── 1. Broadcast → eligible ride-along drivers ──────────────────────────────
export async function notifyBroadcastToDrivers(
  tandemJobId: string,
  eligibleRideAlongDriverIds: string[],
): Promise<void> {
  if (eligibleRideAlongDriverIds.length === 0) return;
  const ctx = await loadContext(tandemJobId);
  if (!ctx) return;

  const drivers = await db
    .select({
      id: rideAlongDriversTable.id,
      firstName: rideAlongDriversTable.firstName,
      phone: rideAlongDriversTable.phone,
    })
    .from(rideAlongDriversTable)
    .where(inArray(rideAlongDriversTable.id, eligibleRideAlongDriverIds));

  const link = rideAlongDashboardLink();
  const fee = ctx.job.rideAlongFee ?? 0;
  const summary = `MCC Ride-Along: new job available near ${ctx.ride.pickupAddress}. Est. fee $${fee.toFixed(2)}.`;

  await Promise.all(
    drivers.map((d) => {
      logPush(
        "tandem.broadcast",
        { kind: "ride_along_driver", id: d.id },
        { tandemJobId, link },
      );
      return sendSms(d.phone, `${summary} Open the dashboard to accept: ${link}`);
    }),
  );
}

// ── 2. Ride-along matched → notify provider ─────────────────────────────────
export async function notifyProviderMatched(tandemJobId: string): Promise<void> {
  const ctx = await loadContext(tandemJobId);
  if (!ctx || !ctx.job.matchedRideAlongDriverId) return;

  const [provider] = await db
    .select({ id: driversTable.id, firstName: driversTable.firstName, phone: driversTable.phone })
    .from(driversTable)
    .where(eq(driversTable.id, ctx.job.providerId))
    .limit(1);
  const [match] = await db
    .select({
      firstName: rideAlongDriversTable.firstName,
      lastName: rideAlongDriversTable.lastName,
    })
    .from(rideAlongDriversTable)
    .where(eq(rideAlongDriversTable.id, ctx.job.matchedRideAlongDriverId))
    .limit(1);
  if (!provider || !match) return;

  const link = providerMatchLink(tandemJobId);
  logPush(
    "tandem.matched.provider",
    { kind: "driver", id: provider.id },
    { tandemJobId, link },
  );
  await sendSms(
    provider.phone,
    `MCC Tandem: ${match.firstName} ${match.lastName} accepted your ride-along job. Review and confirm: ${link}`,
  );
}

// ── 3. Provider accepted → member awaits approval ───────────────────────────
export async function notifyMemberAwaitingApproval(tandemJobId: string): Promise<void> {
  const ctx = await loadContext(tandemJobId);
  if (!ctx) return;

  const link = memberApprovalLink(tandemJobId);
  const memberId = ctx.ride.memberId ?? "unknown";
  logPush(
    "tandem.member.approval_requested",
    { kind: "member", id: memberId },
    { tandemJobId, link },
  );

  // Members are not in the local schema (they live in the MCC member app);
  // we don't have a member phone number to text yet. Log the intent so the
  // member-app integration can pick it up; SMS will start once the member
  // contact info is wired in.
  logger.info(
    { tandemJobId, memberId, link },
    "tandem.notifications.member_sms_skipped (no member phone on file)",
  );
}

// ── 4. Member approval outcome → notify both sides ──────────────────────────
export async function notifyApprovalOutcome(
  tandemJobId: string,
  approved: boolean,
): Promise<void> {
  const ctx = await loadContext(tandemJobId);
  if (!ctx) return;

  // Use the latest matched driver id even after re-broadcast (which clears it)
  // by looking at the rideAlongDriverId fallback.
  const matchedId = ctx.job.matchedRideAlongDriverId ?? ctx.job.rideAlongDriverId;

  const [provider] = await db
    .select({ id: driversTable.id, phone: driversTable.phone })
    .from(driversTable)
    .where(eq(driversTable.id, ctx.job.providerId))
    .limit(1);
  const match = matchedId
    ? (
        await db
          .select({
            id: rideAlongDriversTable.id,
            phone: rideAlongDriversTable.phone,
          })
          .from(rideAlongDriversTable)
          .where(eq(rideAlongDriversTable.id, matchedId))
          .limit(1)
      )[0]
    : null;

  const verb = approved ? "approved" : "declined";
  const providerMsg = approved
    ? `MCC Tandem: the member approved your ride-along match. You're confirmed for the ride.`
    : `MCC Tandem: the member declined the match — we're re-broadcasting to find a new partner.`;
  const matchMsg = approved
    ? `MCC Ride-Along: the member approved you for this job — you're confirmed!`
    : `MCC Ride-Along: the member declined this match. Don't worry — keep an eye on the dashboard for more jobs.`;

  if (provider) {
    logPush(
      "tandem.approval.outcome.provider",
      { kind: "driver", id: provider.id },
      { tandemJobId, approved },
    );
    await sendSms(provider.phone, providerMsg);
  }
  if (match) {
    logPush(
      "tandem.approval.outcome.ride_along",
      { kind: "ride_along_driver", id: match.id },
      { tandemJobId, approved },
    );
    await sendSms(match.phone, matchMsg);
  }

  logger.info({ tandemJobId, verb }, "tandem.notifications.approval_outcome");
}

// ── 5. Broadcast expired → prompt provider to switch mode ───────────────────
export async function notifyMatchExpired(tandemJobId: string): Promise<void> {
  const ctx = await loadContext(tandemJobId);
  if (!ctx) return;

  const [provider] = await db
    .select({ id: driversTable.id, phone: driversTable.phone })
    .from(driversTable)
    .where(eq(driversTable.id, ctx.job.providerId))
    .limit(1);
  if (!provider) return;

  const link = providerMatchLink(tandemJobId);
  logPush(
    "tandem.expired.provider",
    { kind: "driver", id: provider.id },
    { tandemJobId, link },
  );
  await sendSms(
    provider.phone,
    `MCC Tandem: no ride-along driver matched within the broadcast window. Switch to Mode A (known partner) or Mode C (solo) to continue: ${link}`,
  );
}
