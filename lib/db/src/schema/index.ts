import { pgTable, text, boolean, integer, real, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

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
