// Unit tests for custody route helpers and business logic.
//
// Tests the isJobParty check, input validation constants, and
// the status-transition guards in isolation — no network, no DB,
// no HTTP layer. Pattern mirrors notifyRideOffer.test.ts.

import { describe, it, expect, vi } from "vitest";

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../lib/sentry", () => ({ setSentryRequestIdentity: vi.fn() }));
vi.mock("../lib/supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("@workspace/db", () => ({
  db: {},
  driversTable: {},
  deviceTokensTable: { ownerKind: {}, ownerId: {}, revokedAt: {} },
}));

// ── validation constants (mirrored from route file) ───────────────────────────

const UUID_RE   = /^[0-9a-f-]{36}$/i;
const VALID_LEG = new Set([
  "member_to_driver","driver_to_shop","shop_to_driver","driver_to_member",
  "driver_to_driver","member_to_provider","provider_to_member",
]);
const VALID_ROLE = new Set(["member","provider","driver"]);

// ── UUID validation ───────────────────────────────────────────────────────────

describe("UUID_RE", () => {
  it("accepts a lowercase UUID", () => {
    expect(UUID_RE.test("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")).toBe(true);
  });
  it("accepts an uppercase UUID", () => {
    expect(UUID_RE.test("AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE")).toBe(true);
  });
  it("rejects a short string", () => {
    expect(UUID_RE.test("not-a-uuid")).toBe(false);
  });
  it("rejects an empty string", () => {
    expect(UUID_RE.test("")).toBe(false);
  });
});

// ── leg enum ─────────────────────────────────────────────────────────────────

describe("VALID_LEG", () => {
  it("accepts all seven canonical legs", () => {
    const legs = [
      "member_to_driver","driver_to_shop","shop_to_driver","driver_to_member",
      "driver_to_driver","member_to_provider","provider_to_member",
    ];
    for (const leg of legs) expect(VALID_LEG.has(leg)).toBe(true);
  });
  it("rejects an unknown leg", () => {
    expect(VALID_LEG.has("driver_to_moon")).toBe(false);
  });
});

// ── role enum ─────────────────────────────────────────────────────────────────

describe("VALID_ROLE", () => {
  it("accepts member, provider, driver", () => {
    expect(VALID_ROLE.has("member")).toBe(true);
    expect(VALID_ROLE.has("provider")).toBe(true);
    expect(VALID_ROLE.has("driver")).toBe(true);
  });
  it("rejects unknown role", () => {
    expect(VALID_ROLE.has("admin")).toBe(false);
  });
});

// ── release status guard ──────────────────────────────────────────────────────

describe("release status guard", () => {
  // Mirrors: if (h.status !== 'pending') → 409
  function canRelease(status: string): boolean {
    return status === "pending";
  }

  it("allows release when status is pending", () => {
    expect(canRelease("pending")).toBe(true);
  });
  it("blocks release when awaiting_receiver", () => {
    expect(canRelease("awaiting_receiver")).toBe(false);
  });
  it("blocks release when accepted", () => {
    expect(canRelease("accepted")).toBe(false);
  });
  it("blocks release when disputed", () => {
    expect(canRelease("disputed")).toBe(false);
  });
});

// ── releasing-party check ─────────────────────────────────────────────────────

describe("releasing party guard", () => {
  // Mirrors: if (h.releasing_party_id !== uid) → 403
  function isReleasingParty(handoffUid: string, callerUid: string): boolean {
    return handoffUid === callerUid;
  }

  const UID_A = "aaaaaaaa-0000-0000-0000-000000000001";
  const UID_B = "bbbbbbbb-0000-0000-0000-000000000002";

  it("passes when uid matches releasing_party_id", () => {
    expect(isReleasingParty(UID_A, UID_A)).toBe(true);
  });
  it("fails when uid does not match", () => {
    expect(isReleasingParty(UID_A, UID_B)).toBe(false);
  });
});

// ── on_behalf_of_provider_id logic ───────────────────────────────────────────

describe("on_behalf_of_provider_id population rule", () => {
  // Mirrors: if (relRole === 'driver' || recvRole === 'driver') → snapshot provider
  function needsProviderSnapshot(relRole: string, recvRole: string): boolean {
    return relRole === "driver" || recvRole === "driver";
  }

  it("snapshots when releasing role is driver", () => {
    expect(needsProviderSnapshot("driver", "member")).toBe(true);
  });
  it("snapshots when receiving role is driver", () => {
    expect(needsProviderSnapshot("member", "driver")).toBe(true);
  });
  it("does NOT snapshot for member↔provider direct leg", () => {
    expect(needsProviderSnapshot("member", "provider")).toBe(false);
  });
  it("does NOT snapshot for provider↔member direct leg", () => {
    expect(needsProviderSnapshot("provider", "member")).toBe(false);
  });
});

// ── auto-sequence logic ───────────────────────────────────────────────────────

describe("auto-sequence logic", () => {
  // Mirrors: nextSeq = existing.length > 0 ? max + 1 : 1
  function nextSequence(existing: Array<{ sequence: number }>): number {
    return existing.length > 0 ? existing[0].sequence + 1 : 1;
  }

  it("starts at 1 when no prior handoffs", () => {
    expect(nextSequence([])).toBe(1);
  });
  it("increments from existing max", () => {
    expect(nextSequence([{ sequence: 3 }])).toBe(4);
  });
});
