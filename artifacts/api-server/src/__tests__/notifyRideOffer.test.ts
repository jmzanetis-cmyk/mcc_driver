// Verifies that notifyRideOffer() calls sendNativePush with the correct
// payload for the dispatched driver.
//
// sendNativePush is the real transport boundary (APNs / Web Push); mocking
// it keeps the test in-process with no network, DB, or credential deps.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { notifyRideOffer } from "../lib/notifications";

// ── sendNativePush mock ───────────────────────────────────────────────────────
const mockSendNativePush = vi.fn();
vi.mock("../lib/webPush", () => ({
  sendNativePush: (...args: unknown[]) => mockSendNativePush(...args),
  getVapidPublicKey: vi.fn(() => null),
}));

// ── Supabase admin mock (used by the Realtime broadcast path in sendPush,
//    which notifyRideOffer does NOT call — included defensively) ────────────────
vi.mock("../lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    channel: vi.fn(() => ({
      subscribe: vi.fn(),
      send: vi.fn().mockResolvedValue("ok"),
      unsubscribe: vi.fn(),
    })),
    removeChannel: vi.fn().mockResolvedValue(undefined),
  },
}));

// ── DB mock (sendNativePush is mocked so loadActiveTokens is never reached,
//    but @workspace/db is imported by notifications.ts transitively) ───────────
vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    in: vi.fn().mockResolvedValue([]),
  },
  deviceTokensTable: { ownerKind: {}, ownerId: {}, revokedAt: {} },
  driversTable: {},
  rideAlongDriversTable: {},
  ridesTable: {},
  tandemJobsTable: {},
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../lib/sentry", () => ({ setSentryRequestIdentity: vi.fn() }));

// ─────────────────────────────────────────────────────────────────────────────

describe("notifyRideOffer", () => {
  beforeEach(() => {
    mockSendNativePush.mockReset();
    mockSendNativePush.mockResolvedValue(undefined);
  });

  it("calls sendNativePush for the dispatched driver", async () => {
    await notifyRideOffer("driver-1", "ride-1", "assign-1", 50, "123 Main St");

    expect(mockSendNativePush).toHaveBeenCalledOnce();
    const [audience] = mockSendNativePush.mock.calls[0] as [{ kind: string; id: string }, unknown];
    expect(audience.kind).toBe("driver");
    expect(audience.id).toBe("driver-1");
  });

  it("sends event=ride_offer with title 'New Ride Request'", async () => {
    await notifyRideOffer("driver-2", "ride-2", "assign-2", 40, "456 Oak Ave");

    const [, payload] = mockSendNativePush.mock.calls[0] as [
      unknown,
      { event: string; title: string; body: string; data: Record<string, unknown> },
    ];
    expect(payload.event).toBe("ride_offer");
    expect(payload.title).toBe("New Ride Request");
  });

  it("computes driver payout = fare × 0.85 in the body", async () => {
    await notifyRideOffer("driver-3", "ride-3", "assign-3", 60, "789 Elm Blvd");

    const [, payload] = mockSendNativePush.mock.calls[0] as [
      unknown,
      { body: string },
    ];
    // 60 × 0.85 = $51.00
    expect(payload.body).toContain("$51.00");
  });

  it("embeds type, ride_id, assignment_id, estimated_fare, pickup_address in data", async () => {
    await notifyRideOffer("driver-4", "ride-abc", "assign-xyz", 35, "Pickup Lane");

    const [, payload] = mockSendNativePush.mock.calls[0] as [
      unknown,
      { data: Record<string, unknown> },
    ];
    expect(payload.data).toMatchObject({
      type: "ride_offer",
      ride_id: "ride-abc",
      assignment_id: "assign-xyz",
      estimated_fare: 35,
      pickup_address: "Pickup Lane",
    });
  });

  it("propagates sendNativePush errors to the caller", async () => {
    mockSendNativePush.mockRejectedValueOnce(new Error("APNs timeout"));

    await expect(
      notifyRideOffer("driver-5", "ride-5", "assign-5", 20, "Timeout St"),
    ).rejects.toThrow("APNs timeout");
  });
});
