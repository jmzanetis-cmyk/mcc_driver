import '@testing-library/jest-dom';
import { vi } from 'vitest';

// ── Google Maps stub ──────────────────────────────────────────────────────────
// Prevents MapView from crashing when the API key isn't configured.
vi.mock('@/services/maps/mapsLoader', () => ({
  getMapsLoader: vi.fn(() => null),
  loadMapsApi: vi.fn(async () => false),
}));

// ── Supabase client stub ──────────────────────────────────────────────────────
// Tests import this and configure per-test responses via vi.mocked().
vi.mock('@/services/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: { access_token: 'test-token' } },
      })),
      getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn(async () => ({ data: null, error: null })),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
      update: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      upsert: vi.fn().mockReturnThis(),
    })),
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
      unsubscribe: vi.fn(),
    })),
    removeChannel: vi.fn(),
    functions: {
      invoke: vi.fn(async () => ({ data: null, error: null })),
    },
  },
}));

// ── Logger stub ───────────────────────────────────────────────────────────────
vi.mock('@/services/telemetry/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── Sentry stub ───────────────────────────────────────────────────────────────
vi.mock('@/lib/sentry', () => ({
  setSentryRequestIdentity: vi.fn(),
}));

// ── navigator.geolocation stub ────────────────────────────────────────────────
const mockGeolocation = {
  getCurrentPosition: vi.fn(),
  watchPosition: vi.fn(() => 42), // watch ID
  clearWatch: vi.fn(),
};
Object.defineProperty(globalThis.navigator, 'geolocation', {
  value: mockGeolocation,
  writable: true,
  configurable: true,
});

// ── navigator.permissions stub ────────────────────────────────────────────────
Object.defineProperty(globalThis.navigator, 'permissions', {
  value: {
    query: vi.fn(async () => ({ state: 'granted' })),
  },
  writable: true,
  configurable: true,
});

// ── navigator.vibrate stub ────────────────────────────────────────────────────
Object.defineProperty(globalThis.navigator, 'vibrate', {
  value: vi.fn(),
  writable: true,
  configurable: true,
});

// ── window.open stub ──────────────────────────────────────────────────────────
Object.defineProperty(globalThis, 'open', {
  value: vi.fn(() => ({ focus: vi.fn() })),
  writable: true,
  configurable: true,
});

// ── window.confirm stub ───────────────────────────────────────────────────────
Object.defineProperty(globalThis, 'confirm', {
  value: vi.fn(() => true),
  writable: true,
  configurable: true,
});

// ── fetch stub ───────────────────────────────────────────────────────────────
globalThis.fetch = vi.fn(async () =>
  new Response(JSON.stringify({ success: true }), { status: 200 }),
);

// ── localStorage stub ─────────────────────────────────────────────────────────
const localStorageStore: Record<string, string> = {};
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => localStorageStore[k] ?? null,
    setItem: (k: string, v: string) => { localStorageStore[k] = v; },
    removeItem: (k: string) => { delete localStorageStore[k]; },
    clear: () => { Object.keys(localStorageStore).forEach((k) => delete localStorageStore[k]); },
  },
  writable: true,
  configurable: true,
});
