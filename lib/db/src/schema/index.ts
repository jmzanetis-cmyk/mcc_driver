import { pgTable, text, boolean, integer, real, timestamp, uuid, uniqueIndex, jsonb, bigint } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ── Admin users ──────────────────────────────────────────────────────────────
// Database-driven admin role list. Replaces the legacy ADMIN_EMAILS env var.
// Email is stored lowercase and uniquely indexed.

export const adminUsersTable = pgTable(
  "admin_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [uniqueIndex("admin_users_email_unique_idx").on(table.email)],
);

export type AdminUser = typeof adminUsersTable.$inferSelect;

// ── Driver Audit Log ─────────────────────────────────────────────────────────
// Append-only record of admin actions against driver applications/profiles.
// Captures who did what and when, so the admin portal can show a full activity
// history on each driver and filter the driver list by reviewer.

export const driverAuditLogTable = pgTable("driver_audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  driverId: uuid("driver_id").notNull(),
  // e.g. 'approve' | 'reject' | 'reject_documents' | 'clear_document_rejection'
  action: text("action").notNull(),
  // Email of the admin who performed the action (lowercased).
  adminEmail: text("admin_email").notNull(),
  // Resulting driver status after the action, if applicable.
  resultingStatus: text("resulting_status"),
  // Optional human-readable reason or note attached to the action.
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type DriverAuditLogEntry = typeof driverAuditLogTable.$inferSelect;

// ── Drivers ──────────────────────────────────────────────────────────────────

export const driversTable = pgTable("drivers", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  status: text("status").notNull().default("pending_approval"),
  profilePhotoUrl: text("profile_photo_url"),
  licenseDocumentPath: text("license_document_path"),
  insuranceDocumentPath: text("insurance_document_path"),
  backgroundCheckPassed: boolean("background_check_passed").notNull().default(false),
  partnerId: uuid("partner_id"),
  isOnline: boolean("is_online").notNull().default(false),
  canDriveMemberVehicle: boolean("can_drive_member_vehicle").notNull().default(false),
  totalRidesCompleted: integer("total_rides_completed").notNull().default(0),
  averageRating: real("average_rating").notNull().default(5.0),
  completionRate: real("completion_rate").notNull().default(1.0),
  stripeAccountId: text("stripe_account_id"),
  currentLat: real("current_lat"),
  currentLng: real("current_lng"),
  // Server-side freshness marker: stamped whenever the driver posts a
  // location fix to POST /api/drivers/me/location. Dispatch / admin
  // monitoring use this to flag "stale" drivers (>2 min without a fix).
  locationUpdatedAt: timestamp("location_updated_at", { withTimezone: true }),
  // Standing preferred tandem partner (ride-along driver ID, set in Settings)
  preferredPartnerId: uuid("preferred_partner_id"),
  // Admin-set field: non-null when an admin has rejected the driver's documents
  // and wants them to resubmit. Cleared when the driver re-uploads documents.
  documentRejectionReason: text("document_rejection_reason"),
  // Service type capabilities — drivers opt in to rideshare and delivery in Settings
  canDoRideshare: boolean("can_do_rideshare").notNull().default(false),
  canDoDelivery: boolean("can_do_delivery").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type Driver = typeof driversTable.$inferSelect;

// ── Rides ─────────────────────────────────────────────────────────────────────

export const ridesTable = pgTable("rides", {
  id: uuid("id").primaryKey().defaultRandom(),
  scenario: text("scenario").notNull(),
  tier: text("tier").notNull(),
  status: text("status").notNull().default("pending_dispatch"),
  memberId: text("member_id"),
  memberPhone: text("member_phone"),
  memberName: text("member_name"),
  pickupAddress: text("pickup_address").notNull(),
  pickupLat: real("pickup_lat").notNull(),
  pickupLng: real("pickup_lng").notNull(),
  dropoffAddress: text("dropoff_address").notNull(),
  dropoffLat: real("dropoff_lat").notNull(),
  dropoffLng: real("dropoff_lng").notNull(),
  estimatedFare: real("estimated_fare").notNull(),
  actualFare: real("actual_fare"),
  estimatedDistanceMiles: real("estimated_distance_miles").notNull(),
  actualDistanceMiles: real("actual_distance_miles"),
  tipAmount: real("tip_amount"),
  memberRating: integer("member_rating"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  memberVehicleYear: integer("member_vehicle_year"),
  memberVehicleMake: text("member_vehicle_make"),
  memberVehicleModel: text("member_vehicle_model"),
  memberVehicleColor: text("member_vehicle_color"),
  tandemRequired: boolean("tandem_required").notNull().default(false),
  tandemMode: text("tandem_mode"),
  // Service type: 'concierge' | 'rideshare' | 'delivery'
  serviceType: text("service_type").notNull().default("concierge"),
  // Free-text package description for delivery rides (e.g. "Small box, fragile")
  packageDescription: text("package_description"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const insertRideSchema = createInsertSchema(ridesTable).omit({ id: true, createdAt: true });
export type InsertRide = z.infer<typeof insertRideSchema>;
export type Ride = typeof ridesTable.$inferSelect;

// ── Driver Assignments ────────────────────────────────────────────────────────

export const driverAssignmentsTable = pgTable("driver_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  rideId: uuid("ride_id").notNull().references(() => ridesTable.id),
  driverId: uuid("driver_id").notNull().references(() => driversTable.id),
  role: text("role").notNull().default("primary"),
  status: text("status").notNull().default("pending"),
  driverPayoutAmount: real("driver_payout_amount"),
  dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  enRouteAt: timestamp("en_route_at", { withTimezone: true }),
  arrivedAt: timestamp("arrived_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  drivesMemberVehicle: boolean("drives_member_vehicle").notNull().default(false),
  carriesPassenger: boolean("carries_passenger").notNull().default(false),
  responseDeadline: timestamp("response_deadline", { withTimezone: true }).notNull(),
  memberVehicleDescription: text("member_vehicle_description"),
  memberVehiclePlate: text("member_vehicle_plate"),
  dispatchAttempt: integer("dispatch_attempt").notNull().default(1),
  payoutStatus: text("payout_status"),
  payoutId: uuid("payout_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex("driver_assignments_one_pending_per_ride_role")
    .on(table.rideId, table.role)
    .where(sql`${table.status} = 'pending'`),
]);

export type DriverAssignment = typeof driverAssignmentsTable.$inferSelect;

// ── Driver Payouts ────────────────────────────────────────────────────────────

export const driverPayoutsTable = pgTable("driver_payouts", {
  id: uuid("id").primaryKey().defaultRandom(),
  driverId: uuid("driver_id").notNull().references(() => driversTable.id),
  amount: real("amount").notNull(),
  netPayout: real("net_payout"),
  platformFee: real("platform_fee"),
  method: text("method").notNull(),
  status: text("status").notNull().default("pending"),
  requestedAt: timestamp("requested_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  scheduledDate: timestamp("scheduled_date", { withTimezone: true }),
  stripeTransferId: text("stripe_transfer_id"),
  cardLast4: text("card_last4"),
  bankLast4: text("bank_last4"),
  failedReason: text("failed_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type DriverPayout = typeof driverPayoutsTable.$inferSelect;

// ── Ride-Along Drivers ────────────────────────────────────────────────────────
// Ride-Along Drivers are a separate gig role from regular MCC Drivers.
// They accompany a primary MCC Driver on a tandem job (Phase 2+).
// This table tracks their onboarding, document verification, and status.

export const rideAlongDriversTable = pgTable("ride_along_drivers", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().unique(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  zipCode: text("zip_code"),
  maxDistanceMiles: integer("max_distance_miles").notNull().default(20),

  // License
  licenseNumber: text("license_number"),
  licenseState: text("license_state"),
  licenseExpiry: text("license_expiry"),
  licenseDocumentPath: text("license_document_path"),

  // Insurance
  insuranceDocumentPath: text("insurance_document_path"),
  insuranceExpiry: text("insurance_expiry"),

  // Resolved coordinates for ZIP — used by Phase 3 matching (Haversine distance).
  // Populated by a ZIP→lat/lng lookup (Phase 3b dashboard task). Drivers whose
  // coords are still null are excluded from matching until they are resolved.
  zipLat: real("zip_lat"),
  zipLng: real("zip_lng"),

  // Verification
  backgroundCheckStatus: text("background_check_status").notNull().default("pending"),
  verified: boolean("verified").notNull().default(false),
  profilePhotoPath: text("profile_photo_path"),

  // Agreement
  agreementSignedAt: timestamp("agreement_signed_at", { withTimezone: true }),

  // Performance
  rating: real("rating").notNull().default(5.0),
  totalJobs: integer("total_jobs").notNull().default(0),

  // Lifecycle
  status: text("status").notNull().default("pending_approval"),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const insertRideAlongDriverSchema = createInsertSchema(rideAlongDriversTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertRideAlongDriver = z.infer<typeof insertRideAlongDriverSchema>;
export type RideAlongDriver = typeof rideAlongDriversTable.$inferSelect;

// ── Tandem Jobs ───────────────────────────────────────────────────────────────
// Records a tandem pairing decision for a tandem-required ride.
// Modes: A = Known Partner, B = Platform Match (Phase 3), C = Self-Sufficient.
// Created when the provider (primary driver) picks their tandem mode post-accept.

export const tandemJobsTable = pgTable(
  "tandem_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // The ride this tandem job belongs to
    rideId: uuid("ride_id").notNull().references(() => ridesTable.id),

    // The primary driver who is managing the tandem arrangement
    providerId: uuid("provider_id").notNull().references(() => driversTable.id),

    // Chosen tandem mode: 'A' | 'B' | 'C'
    tandemMode: text("tandem_mode").notNull(),

    // Linked ride-along driver (Mode A only; null for B/C)
    rideAlongDriverId: uuid("ride_along_driver_id").references(() => rideAlongDriversTable.id),

    // Workflow state: pending | pending_match | broadcast | matched | member_pending |
    //                 confirmed | expired | cancelled
    matchStatus: text("match_status").notNull().default("pending"),

    // Phase 3a: deadline for a broadcast match — after this, the worker flips the
    // job to `match_status = expired`. Null when not in `broadcast` state.
    matchDeadline: timestamp("match_deadline", { withTimezone: true }),

    // Phase 3a: the ride-along driver who won the atomic accept in Mode B.
    // Distinct from `rideAlongDriverId` (which is set immediately for Mode A known
    // partner), but both are populated in Mode B once a match is confirmed.
    matchedRideAlongDriverId: uuid("matched_ride_along_driver_id").references(
      () => rideAlongDriversTable.id,
    ),

    // Whether the member approved this arrangement (Phase 3)
    memberApproved: boolean("member_approved"),

    // Computed fee for the ride-along partner (based on distance tier)
    rideAlongFee: real("ride_along_fee"),

    // Check-in timestamps for Phase 4 (QR / GPS confirmation)
    rideAlongCheckinAt: timestamp("ride_along_checkin_at", { withTimezone: true }),
    providerCheckinAt: timestamp("provider_checkin_at", { withTimezone: true }),

    // Photo and GPS evidence (Phase 4); stored as JSON text
    photosJson: jsonb("photos_json"),
    gpsJson: jsonb("gps_json"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    // Each provider can only have one tandem job per ride
    uniqueIndex("tandem_jobs_ride_provider_unique").on(table.rideId, table.providerId),
  ],
);

export type TandemJob = typeof tandemJobsTable.$inferSelect;

// ── Tandem Job Declines ───────────────────────────────────────────────────────
// Phase 3a: tracks which ride-along drivers have declined a particular tandem
// job so they are excluded from re-broadcasts of the same job.

export const tandemJobDeclinesTable = pgTable(
  "tandem_job_declines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tandemJobId: uuid("tandem_job_id").notNull().references(() => tandemJobsTable.id),
    rideAlongDriverId: uuid("ride_along_driver_id").notNull().references(() => rideAlongDriversTable.id),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex("tandem_job_declines_job_driver_unique").on(table.tandemJobId, table.rideAlongDriverId),
  ],
);

export type TandemJobDecline = typeof tandemJobDeclinesTable.$inferSelect;

// ── Device Tokens ─────────────────────────────────────────────────────────────
// Real native push transport. Each driver or ride-along driver device that
// opts in registers a token here on sign-in so the server can push
// notifications even when the app is closed (Web Push / FCM / APNs).
// Tokens are revoked on sign-out (revokedAt set) and deduped by (token).

export const deviceTokensTable = pgTable(
  "device_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Which kind of account this token belongs to: 'driver' | 'ride_along_driver'.
    ownerKind: text("owner_kind").notNull(),
    // FK by convention only — no DB constraint because ownerId points at
    // either drivers.id or ride_along_drivers.id depending on ownerKind.
    ownerId: uuid("owner_id").notNull(),
    // Transport platform: 'web' (Web Push), 'fcm' (Android), 'apns' (iOS).
    platform: text("platform").notNull(),
    // For Web Push, this is the PushSubscription.endpoint URL.
    // For FCM/APNs it is the device token string.
    token: text("token").notNull(),
    // Web Push only — required by `web-push` library to encrypt payloads.
    p256dh: text("p256dh"),
    auth: text("auth"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("device_tokens_token_unique").on(table.token)],
);

export type DeviceToken = typeof deviceTokensTable.$inferSelect;

// ── App Config (kill switch + forced update) ─────────────────────────────────
// Single-row config table powering GET /api/app/status. Admins can flip the
// kill switch (outageMessage) or bump minSupportedVersion without a redeploy.
// We keep one canonical row keyed by id='global'. id is text (not uuid) so the
// constant is human-readable and stable across environments.

export const appConfigTable = pgTable("app_config", {
  id: text("id").primaryKey().default("global"),
  // Minimum app version a client is allowed to run. Clients on a lower
  // semver MUST be force-updated. Defaults to "0.0.0" so we never accidentally
  // brick all installs before an admin sets a real value.
  minSupportedVersion: text("min_supported_version").notNull().default("0.0.0"),
  // Most recent shipped version. Informational — surfaces in the admin UI
  // and the client can use it for "update available" nudges later.
  latestVersion: text("latest_version").notNull().default("0.0.0"),
  // When non-null + non-empty, a non-dismissable banner is shown app-wide.
  // Use sparingly — this is the incident kill switch surface.
  outageMessage: text("outage_message"),
  // App Store listing URL — opened by the forced-update button. Stored in
  // DB so it can be swapped after launch without a client redeploy.
  appStoreUrl: text("app_store_url"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  // Email of the admin who last edited (audit breadcrumb).
  updatedBy: text("updated_by"),
});

export type AppConfig = typeof appConfigTable.$inferSelect;

// ── Driver Earnings ───────────────────────────────────────────────────────────
// Append-only ledger of money owed to a driver.
// kind: 'base' | 'tip' | 'bonus' | 'adjustment'
// payout_status: 'pending' → 'available' → 'paid' (or 'failed')

export const driverEarningsTable = pgTable("driver_earnings", {
  id:               uuid("id").primaryKey().defaultRandom(),
  driverId:         uuid("driver_id").notNull(),
  jobId:            uuid("job_id"),
  legId:            uuid("leg_id"),
  amountCents:      integer("amount_cents").notNull(),
  kind:             text("kind").notNull().default("base"),
  notes:            text("notes"),
  recordedAt:       timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
  payoutStatus:     text("payout_status").notNull().default("pending"),
  stripeTransferId: text("stripe_transfer_id"),
  paidAt:           timestamp("paid_at", { withTimezone: true }),
  payoutError:      text("payout_error"),
  cashoutId:        uuid("cashout_id"),
});
export type DriverEarning = typeof driverEarningsTable.$inferSelect;

// ── Driver Cashouts ───────────────────────────────────────────────────────────
// One row per cashout request; links back to the earnings swept into it.
// status: 'processing' → 'paid' | 'failed' | 'cancelled'
// method: 'standard' | 'instant'

export const driverCashoutsTable = pgTable("driver_cashouts", {
  id:               uuid("id").primaryKey().defaultRandom(),
  driverId:         uuid("driver_id").notNull(),
  amountCents:      integer("amount_cents").notNull(),
  feeCents:         integer("fee_cents").notNull().default(0),
  method:           text("method").notNull(),
  status:           text("status").notNull().default("processing"),
  stripeTransferId: text("stripe_transfer_id"),
  stripePayoutId:   text("stripe_payout_id"),
  error:            text("error"),
  requestedAt:      timestamp("requested_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt:      timestamp("completed_at", { withTimezone: true }),
  initiatedByKind:  text("initiated_by_kind").notNull().default("driver"),
  initiatedById:    uuid("initiated_by_id"),
});
export type DriverCashout = typeof driverCashoutsTable.$inferSelect;

// ── Driver Wallet Balances (VIEW) ─────────────────────────────────────────────
// Read-only aggregate view — never insert/update through this definition.
// bigint mode:"number" is safe for any realistic earnings amount (< $21M).

export const driverWalletBalancesTable = pgTable("driver_wallet_balances", {
  driverId:            uuid("driver_id"),
  availableCents:      bigint("available_cents",       { mode: "number" }),
  pendingAccountCents: bigint("pending_account_cents", { mode: "number" }),
  failedCents:         bigint("failed_cents",          { mode: "number" }),
  inFlightCents:       bigint("in_flight_cents",       { mode: "number" }),
  lifetimePaidCents:   bigint("lifetime_paid_cents",   { mode: "number" }),
});
export type DriverWalletBalance = typeof driverWalletBalancesTable.$inferSelect;

// ── Driver Mileage Logs ───────────────────────────────────────────────────────
// Per-trip odometer entries for IRS mileage deduction tracking.

export const driverMileageLogsTable = pgTable("driver_mileage_logs", {
  id:         uuid("id").primaryKey().defaultRandom(),
  driverId:   uuid("driver_id").notNull(),
  tripDate:   timestamp("trip_date", { withTimezone: true }).notNull(),
  startMiles: real("start_miles").notNull(),
  endMiles:   real("end_miles").notNull(),
  totalMiles: real("total_miles"),  // GENERATED ALWAYS AS (end_miles - start_miles) STORED
  notes:      text("notes"),
  createdAt:  timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
export type DriverMileageLog = typeof driverMileageLogsTable.$inferSelect;

// ── Driver Expenses ───────────────────────────────────────────────────────────
// Business expense log for tax deduction tracking.
// category: 'gas' | 'car_wash' | 'phone' | 'insurance' | 'maintenance' | 'other'

export const driverExpensesTable = pgTable("driver_expenses", {
  id:           uuid("id").primaryKey().defaultRandom(),
  driverId:     uuid("driver_id").notNull(),
  category:     text("category").notNull(),
  amountCents:  integer("amount_cents").notNull(),
  expenseDate:  timestamp("expense_date", { withTimezone: true }).notNull(),
  description:  text("description"),
  receiptUrl:   text("receipt_url"),
  createdAt:    timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
export type DriverExpense = typeof driverExpensesTable.$inferSelect;

// ── Driver Ride Inspections ───────────────────────────────────────────────────
// Pre-pickup and post-dropoff walk-around records for relocation/concierge.
// photos_json stores InspectionPhotoData[] (see driver app types.ts).
// phase: 'pickup' | 'dropoff'    status: 'submitted' (written once by driver)
// UNIQUE(ride_id, phase) enforced in DB — one inspection per phase per ride.

export const driverRideInspectionsTable = pgTable(
  "driver_ride_inspections",
  {
    id:              uuid("id").primaryKey().defaultRandom(),
    rideId:          uuid("ride_id").notNull(),
    driverId:        uuid("driver_id").notNull(),
    phase:           text("phase").notNull(),
    photosJson:      jsonb("photos_json").notNull().default([]),
    odometerReading: integer("odometer_reading"),
    status:          text("status").notNull().default("submitted"),
    notes:           text("notes"),
    locationLat:     real("location_lat"),
    locationLng:     real("location_lng"),
    submittedAt:     timestamp("submitted_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt:       timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("driver_ride_inspections_ride_phase_unique").on(table.rideId, table.phase),
  ],
);
export type DriverRideInspection = typeof driverRideInspectionsTable.$inferSelect;

export const insertDeviceTokenSchema = createInsertSchema(deviceTokensTable).omit({
  id: true,
  createdAt: true,
  lastSeenAt: true,
  revokedAt: true,
});
export type InsertDeviceToken = z.infer<typeof insertDeviceTokenSchema>;
