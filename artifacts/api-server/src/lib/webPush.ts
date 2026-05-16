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
  const webPush = await getWebPush();
  if (!webPush) {
    logger.debug(
      { audience, event: payload.event },
      "webPush.skipped (VAPID not configured)",
    );
    return;
  }
  const tokens = await loadActiveTokens(audience);
  if (tokens.length === 0) {
    logger.debug(
      { audience, event: payload.event },
      "webPush.no_tokens",
    );
    return;
  }

  const body = JSON.stringify(payload);
  const toRevoke: string[] = [];

  await Promise.all(
    tokens.map(async (t) => {
      if (t.platform !== "web" || !t.p256dh || !t.auth) {
        // FCM/APNs senders would go here in the future.
        return;
      }
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
