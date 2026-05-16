// ============================================================
// MCC Driver — App Status fetcher
// ============================================================
// Hits the public, unauthenticated GET /api/app/status endpoint and
// pushes the result into the Zustand store. Fail-soft: a network
// blip must NOT brick the app on launch, so failures are logged and
// silently ignored — the previous (or null) status stays in place.
// ============================================================

import { apiUrl } from "@/services/api/baseUrl";
import { useAppStatusStore, type AppStatus } from "@/store/appStatusStore";

export async function fetchAppStatus(): Promise<AppStatus | null> {
  try {
    const res = await fetch(apiUrl("/app/status"), {
      method: "GET",
      // Status endpoint is public + cached server-side; no creds needed.
      credentials: "omit",
    });
    if (!res.ok) {
      // Treat non-2xx as "no signal" rather than forcing an update.
      // eslint-disable-next-line no-console
      console.warn("[appStatus] non-OK response", res.status);
      return null;
    }
    const body = (await res.json()) as Partial<AppStatus>;
    const parsed: AppStatus = {
      minSupportedVersion: String(body.minSupportedVersion ?? "0.0.0"),
      latestVersion: String(body.latestVersion ?? "0.0.0"),
      outageMessage:
        typeof body.outageMessage === "string" && body.outageMessage.trim()
          ? body.outageMessage
          : null,
      appStoreUrl:
        typeof body.appStoreUrl === "string" && body.appStoreUrl.trim()
          ? body.appStoreUrl
          : null,
    };
    useAppStatusStore.getState().setStatus(parsed);
    return parsed;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[appStatus] fetch failed", err);
    return null;
  }
}

// Default App Store URL used by the forced-update button when the
// server hasn't supplied one. Replace once the App Store ID is issued.
export const DEFAULT_APP_STORE_URL =
  "https://apps.apple.com/app/my-car-concierge-driver/id0000000000";
