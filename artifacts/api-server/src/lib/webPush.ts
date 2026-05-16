// ============================================================
// Web Push transport — real native push to registered devices
// ============================================================
// Resolves audience → registered device tokens and sends a web
// push payload via the `web-push` library. Tokens that come back
// 404/410 are auto-revoked. Skips gracefully when VAPID keys are
// not configured.

import { and, eq, isNull, inArray } from "drizzle-orm";
import { db, deviceTokensTable } from "@workspace/db";
import type { DeviceToken } from "@workspace/db";
import { logger } from "./logger";
import { sendApnsPush } from "./apnsPush";

type WebPushModule = typeof import("web-push");
let cachedWebPush: WebPushModule | null = null;
let configured = false;

async function getWebPush(): Promise<WebPushModule | null> {
  const publicKey = process.env["VAPID_PUBLIC_KEY"];
  const privateKey = process.env["VAPID_PRIVATE_KEY"];
  const subject =
    process.env["VAPID_SUBJECT"] ?? "mailto:support@mycarconcierge.com";
  if (!publicKey || !privateKey) return null;
  if (cachedWebPush && configured) return cachedWebPush;
  try {
    cachedWebPush = (await import("web-push")) as WebPushModule;
    cachedWebPush.setVapidDetails(subject, publicKey, privateKey);
    configured = true;
    return cachedWebPush;
  } catch (err) {
    logger.error({ err }, "webPush: failed to init web-push module");
    return null;
  }
}

export function getVapidPublicKey(): string | null {
  return process.env["VAPID_PUBLIC_KEY"] ?? null;
}

export interface PushAudience {
  kind: "driver" | "ride_along_driver" | "member";
  id: string;
}

export interface PushPayload {
  event: string;
  title: string;
  body: string;
  url?: string;
  data?: Record<string, unknown>;
}

async function loadActiveTokens(audience: PushAudience): Promise<DeviceToken[]> {
  if (audience.kind === "member") return [];
  return db
    .select()
    .from(deviceTokensTable)
    .where(
      and(
        eq(deviceTokensTable.ownerKind, audience.kind),
        eq(deviceTokensTable.ownerId, audience.id),
        isNull(deviceTokensTable.revokedAt),
      ),
    );
}

async function revokeTokens(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(deviceTokensTable)
    .set({ revokedAt: new Date() })
    .where(inArray(deviceTokensTable.id, ids));
}

export async function sendNativePush(
  audience: PushAudience,
  payload: PushPayload,
): Promise<void> {
  const tokens = await loadActiveTokens(audience);
  if (tokens.length === 0) {
    logger.debug(
      { audience, event: payload.event },
      "nativePush.no_tokens",
    );
    return;
  }

  // Lazy-load the web-push module only when a web token is actually
  // present — APNs-only deployments don't need VAPID configured.
  const hasWebToken = tokens.some(
    (t) => t.platform === "web" && t.p256dh && t.auth,
  );
  const webPush = hasWebToken ? await getWebPush() : null;
  if (hasWebToken && !webPush) {
    logger.debug(
      { audience, event: payload.event },
      "webPush.skipped (VAPID not configured)",
    );
    // Continue — APNs tokens (if any) should still be attempted.
  }

  const body = JSON.stringify(payload);
  const toRevoke: string[] = [];

  await Promise.all(
    tokens.map(async (t) => {
      // ── APNs (iOS via Capacitor) ────────────────────────────────────
      if (t.platform === "apns") {
        const result = await sendApnsPush(t.token, payload);
        if (result.shouldRevoke) {
          toRevoke.push(t.id);
          logger.info(
            { tokenId: t.id, reason: result.reason },
            "apnsPush.token_revoked_by_provider",
          );
        }
        return;
      }
      // ── Web Push (browsers) ─────────────────────────────────────────
      if (t.platform !== "web" || !t.p256dh || !t.auth) {
        // FCM (Android) sender would go here in the future.
        return;
      }
      if (!webPush) return; // VAPID not configured — skip this token only.
      try {
        await webPush.sendNotification(
          {
            endpoint: t.token,
            keys: { p256dh: t.p256dh, auth: t.auth },
          },
          body,
        );
        logger.info(
          { audience, event: payload.event, tokenId: t.id },
          "webPush.sent",
        );
      } catch (err: unknown) {
        const statusCode =
          typeof err === "object" && err !== null && "statusCode" in err
            ? (err as { statusCode?: number }).statusCode
            : undefined;
        if (statusCode === 404 || statusCode === 410) {
          toRevoke.push(t.id);
          logger.info(
            { tokenId: t.id, statusCode },
            "webPush.token_revoked_by_provider",
          );
        } else {
          logger.error(
            { err, tokenId: t.id, audience, event: payload.event },
            "webPush.send_failed",
          );
        }
      }
    }),
  );

  if (toRevoke.length > 0) await revokeTokens(toRevoke);
}
