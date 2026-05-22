// ============================================================
// MCC Driver — Navigation Deep Link Service
// ============================================================
// Launches the driver's preferred navigation app with the
// destination coordinates. Falls back gracefully.
// ============================================================

// In production, use: import { App } from '@capacitor/app';
// For now, we use window.open as a web fallback.

export type NavApp = 'google_maps' | 'waze' | 'apple_maps';

interface NavTarget {
  lat: number;
  lng: number;
  label?: string;  // Address or place name
}

/**
 * Build the deep link URL for each nav app
 */
function getNavUrl(app: NavApp, target: NavTarget): string {
  const { lat, lng, label } = target;
  const encodedLabel = label ? encodeURIComponent(label) : `${lat},${lng}`;

  switch (app) {
    case 'google_maps':
      // Works on both iOS (comgooglemaps://) and Android (google.navigation:)
      // Web fallback uses the universal URL
      return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;

    case 'waze':
      return `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;

    case 'apple_maps':
      return `https://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`;

    default:
      return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
  }
}

/**
 * Get the native deep link (for Capacitor)
 */
function getNativeUrl(app: NavApp, target: NavTarget): string {
  const { lat, lng } = target;

  switch (app) {
    case 'google_maps':
      // Android: intent-based, iOS: comgooglemaps://
      const isIOS = /iPhone|iPad/.test(navigator.userAgent);
      if (isIOS) {
        return `comgooglemaps://?daddr=${lat},${lng}&directionsmode=driving`;
      }
      return `google.navigation:q=${lat},${lng}&mode=d`;

    case 'waze':
      return `waze://?ll=${lat},${lng}&navigate=yes`;

    case 'apple_maps':
      return `maps://?daddr=${lat},${lng}&dirflg=d`;

    default:
      return getNavUrl('google_maps', target);
  }
}

/**
 * Open navigation to the target coordinates in the driver's preferred app.
 * Tries native deep link first, falls back to web URL.
 */
export async function openNavigation(
  preferredApp: NavApp,
  target: NavTarget
): Promise<void> {
  // Try native deep link first
  const nativeUrl = getNativeUrl(preferredApp, target);

  try {
    // In Capacitor: await App.openUrl({ url: nativeUrl });
    // Web fallback:
    const opened = window.open(nativeUrl, '_blank');

    if (!opened) {
      // Native app not installed, fall back to web URL
      const webUrl = getNavUrl(preferredApp, target);
      window.open(webUrl, '_blank');
    }
  } catch {
    // Final fallback: Google Maps web
    const fallbackUrl = getNavUrl('google_maps', target);
    window.open(fallbackUrl, '_blank');
  }
}

/**
 * Get display name for a nav app
 */
export function getNavAppName(app: NavApp): string {
  switch (app) {
    case 'google_maps': return 'Google Maps';
    case 'waze': return 'Waze';
    case 'apple_maps': return 'Apple Maps';
  }
}

/**
 * Default nav app for the current platform.
 * iOS drivers typically prefer Apple Maps; Android defaults to Google Maps.
 */
export function getDefaultNavApp(): NavApp {
  if (typeof navigator !== 'undefined' && /iPhone|iPad/i.test(navigator.userAgent)) {
    return 'apple_maps';
  }
  return 'google_maps';
}

/**
 * Get available nav apps for the current platform
 */
export function getAvailableNavApps(): NavApp[] {
  const isIOS = /iPhone|iPad/.test(navigator.userAgent);
  if (isIOS) {
    return ['google_maps', 'waze', 'apple_maps'];
  }
  // Android doesn't have Apple Maps
  return ['google_maps', 'waze'];
}
