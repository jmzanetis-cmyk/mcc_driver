// ============================================================
// MCC Driver — API base URL resolution
// ============================================================
// The driver web app served from the same origin as the API
// (e.g. the Replit dev preview, or a single combined deploy)
// can reach the API via relative `/api/*` URLs.
//
// The native iOS Capacitor build, however, runs from a
// `capacitor://` scheme inside a webview and has no implicit
// origin — every fetch MUST be an absolute URL. We resolve
// that URL from the Vite build-time env var VITE_API_BASE_URL.
//
// Conventions:
//   - VITE_API_BASE_URL unset (default web/dev preview):
//       apiUrl("/foo") → "/api/foo"  (relative — uses current origin)
//   - VITE_API_BASE_URL = "https://api.mycarconcierge.com":
//       apiUrl("/foo") → "https://api.mycarconcierge.com/api/foo"
//
// The /api prefix is included automatically so callers stay
// identical between web and native builds.
// ============================================================

const RAW_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

// Strip trailing slash so we can safely concatenate.
const BASE = RAW_BASE.replace(/\/+$/, "");

/**
 * Build an absolute or relative URL to an API endpoint.
 * Pass paths WITHOUT the `/api` prefix — it is added here.
 *
 * @example
 *   apiUrl("/rides/123/accept")
 *   // → "/api/rides/123/accept" (web, default)
 *   // → "https://api.example.com/api/rides/123/accept" (native iOS)
 */
export function apiUrl(path: string): string {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${BASE}/api${suffix}`;
}

/**
 * The active API origin (empty string when using relative URLs).
 * Exposed so debug UIs / Sentry tags can surface the active env.
 */
export const apiBaseUrl: string = BASE;

/**
 * Human-readable label for the active app environment.
 * Driven by VITE_APP_ENV (set per build); falls back to NODE_ENV.
 * Useful for showing a banner in non-production builds so QA
 * can never confuse a staging device for a prod one.
 */
export const appEnv: string =
  (import.meta.env.VITE_APP_ENV as string | undefined) ??
  (import.meta.env.PROD ? "production" : "development");
