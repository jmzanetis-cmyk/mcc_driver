// ============================================================
// APNs Push transport — native iOS push delivery
// ============================================================
// Sends a push payload to a single APNs device token using the
// `apn` library (HTTP/2 + JWT auth via a .p8 key from the Apple
// Developer account). Lazily configured from env vars so dev
// environments without APNs credentials skip gracefully.
//
// Configuration (all required to enable):
//  - APNS_KEY_ID         — 10-char identifier of the .p8 key
//  - APNS_TEAM_ID        — 10-char Apple Developer team ID
//  - APNS_AUTH_KEY       — PEM contents of the .p8 file (full text
//                          including `-----BEGIN PRIVATE KEY-----`)
//  - APNS_BUNDLE_ID      — iOS bundle id (defaults to
//                          `com.mycarconcierge.driver`)
//  - APNS_PRODUCTION     — "true" to use the production APNs gateway;
//                          omit/false for the sandbox (matches
//                          App.entitlements `aps-environment`).

import { logger } from "./logger";
import type { PushPayload } from "./webPush";

type ApnModule = typeof import("apn");
let cachedApn: ApnModule | null = null;
let cachedProvider: import("apn").Provider | null = null;
let configWarned = false;

async function getApn(): Promise<ApnModule | null> {
  if (cachedApn) return cachedApn;
  try {
    cachedApn = (await import("apn")) as ApnModule;
    return cachedApn;
  } catch (err) {
    logger.error({ err }, "apnsPush: failed to load `apn` module");
    return null;
  }
}

async function getProvider(): Promise<import("apn").Provider | null> {
  const keyId = process.env["APNS_KEY_ID"];
  const teamId = process.env["APNS_TEAM_ID"];
  const authKey = process.env["APNS_AUTH_KEY"];
  if (!keyId || !teamId || !authKey) {
    if (!configWarned) {
      logger.debug(
        "apnsPush: APNS credentials not set — skipping APNs sends",
      );
      configWarned = true;
    }
    return null;
  }
  if (cachedProvider) return cachedProvider;
  const apnMod = await getApn();
  if (!apnMod) return null;
  try {
    cachedProvider = new apnMod.Provider({
      token: {
        key: Buffer.from(authKey, "utf-8"),
        keyId,
        teamId,
      },
      production: process.env["APNS_PRODUCTION"] === "true",
    });
    return cachedProvider;
  } catch (err) {
    logger.error({ err }, "apnsPush: failed to initialise Provider");
    return null;
  }
}

export interface ApnsSendResult {
  ok: boolean;
  shouldRevoke: boolean;
  reason?: string;
}

export async function sendApnsPush(
  deviceToken: string,
  payload: PushPayload,
): Promise<ApnsSendResult> {
  const provider = await getProvider();
  if (!provider) return { ok: false, shouldRevoke: false, reason: "not_configured" };

  const apnMod = await getApn();
  if (!apnMod) return { ok: false, shouldRevoke: false, reason: "module_unavailable" };

  const bundleId =
    process.env["APNS_BUNDLE_ID"] ?? "com.mycarconcierge.driver";

  const note = new apnMod.Notification();
  note.topic = bundleId;
  note.alert = { title: payload.title, body: payload.body };
  note.sound = "default";
  note.badge = 1;
  note.contentAvailable = true;
  // Deep-link URL + arbitrary data go in the custom payload so the
  // Capacitor PushNotifications plugin surfaces them on tap.
  const data: Record<string, unknown> = { ...(payload.data ?? {}) };
  if (payload.url) data["url"] = payload.url;
  data["event"] = payload.event;
  note.payload = data;
  // 5-minute expiry — past this, APNs will not retry delivery.
  note.expiry = Math.floor(Date.now() / 1000) + 5 * 60;

  try {
    const result = await provider.send(note, deviceToken);
    if (result.failed.length > 0) {
      const first = result.failed[0]!;
      const reason =
        first.response?.reason ??
        (first.error instanceof Error ? first.error.message : String(first.error ?? "unknown"));
      // `BadDeviceToken` (sandbox token sent to prod or vice-versa) and
      // `Unregistered` (user uninstalled the app) are the two "delete me"
      // signals per Apple's docs. `DeviceTokenNotForTopic` also means the
      // token is junk for our bundle id.
      const shouldRevoke =
        reason === "BadDeviceToken" ||
        reason === "Unregistered" ||
        reason === "DeviceTokenNotForTopic";
      if (!shouldRevoke) {
        logger.warn(
          { reason, event: payload.event },
          "apnsPush.send_failed",
        );
      }
      return { ok: false, shouldRevoke, reason };
    }
    logger.info(
      { event: payload.event, bundleId },
      "apnsPush.sent",
    );
    return { ok: true, shouldRevoke: false };
  } catch (err) {
    logger.error({ err, event: payload.event }, "apnsPush.exception");
    return {
      ok: false,
      shouldRevoke: false,
      reason: err instanceof Error ? err.message : "unknown",
    };
  }
}

export function isApnsConfigured(): boolean {
  return Boolean(
    process.env["APNS_KEY_ID"] &&
      process.env["APNS_TEAM_ID"] &&
      process.env["APNS_AUTH_KEY"],
  );
}

/** Test-only helper to release the cached provider between tests. */
export function __resetApnsForTests(): void {
  cachedProvider?.shutdown();
  cachedProvider = null;
  configWarned = false;
}
