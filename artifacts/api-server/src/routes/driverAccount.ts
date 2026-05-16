// ============================================================
// MCC API — Driver Self-Service Account Deletion
// ============================================================
// Required by Apple App Store Guideline 5.1.1(v): any app that
// lets a user create an account must also let them delete it
// from within the app.
//
// Strategy (anonymize-don't-hard-delete):
//   - PII fields on the local Drizzle `drivers` row are stripped
//     (name, email, phone, profile photo, documents, stripe acct,
//     location, preferred partner). The row itself is preserved
//     so the FK from `rides` / `driver_payouts` / `driver_assignments`
//     still resolves for historical/accounting reporting.
//   - `userId` cannot be NULL (notNull constraint), so it is
//     replaced with a sentinel string `deleted:<driverId>` that
//     is guaranteed to no longer match any Supabase auth user.
//   - The Supabase auth user is hard-deleted via the admin client,
//     which also revokes outstanding sessions.
//   - The deletion is recorded in `driver_audit_log` with
//     `action='self_delete'` for audit + support purposes.
//
// Preflight blocks deletion when:
//   - The driver has any assignment in flight
//     (status ∈ accepted | en_route | arrived | in_progress), OR
//   - The driver has any pending payout request
//     (driver_payouts.status = 'pending').
// In both cases the response shape includes a machine-readable
// `reason` so the Settings UI can show targeted copy instead of
// a generic error.
// ============================================================

import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  driversTable,
  driverAssignmentsTable,
  driverPayoutsTable,
  driverAuditLogTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { supabaseAdmin } from "../lib/supabaseAdmin";

const router: IRouter = Router();

// ── Auth helper (mirrors routes/driverLocation.ts) ───────────────────────────

interface SupabaseUser {
  id: string;
}

async function verifySupabaseToken(token: string): Promise<SupabaseUser | null> {
  const supabaseUrl = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"];
  const supabaseAnonKey =
    process.env["SUPABASE_ANON_KEY"] ?? process.env["VITE_SUPABASE_ANON_KEY"];
  if (!supabaseUrl || !supabaseAnonKey) return null;
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: supabaseAnonKey },
    });
    if (!res.ok) return null;
    const user = (await res.json()) as SupabaseUser;
    return user?.id ? user : null;
  } catch {
    return null;
  }
}

async function requireUser(req: Request, res: Response): Promise<SupabaseUser | null> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  const user = await verifySupabaseToken(auth.slice(7));
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return user;
}

// ── Preflight: in-flight assignments ─────────────────────────────────────────

const ACTIVE_ASSIGNMENT_STATUSES = [
  "accepted",
  "en_route",
  "arrived",
  "in_progress",
] as const;

// ── DELETE /drivers/me ────────────────────────────────────────────────────────

router.delete("/drivers/me", async (req: Request, res: Response): Promise<void> => {
  const user = await requireUser(req, res);
  if (!user) return;

  // Look up the driver row.
  const [driver] = await db
    .select()
    .from(driversTable)
    .where(eq(driversTable.userId, user.id))
    .limit(1);

  if (!driver) {
    // Already deleted, or the user never completed an application.
    // Still hard-delete the auth user so a future sign-up is clean.
    let authDeleted = true;
    try {
      const { error } = await supabaseAdmin.auth.admin.deleteUser(user.id);
      if (error) {
        authDeleted = false;
        logger.warn(
          { err: error.message, userId: user.id },
          "driver_account.delete.auth_user_missing_driver_failed",
        );
      }
    } catch (err) {
      authDeleted = false;
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), userId: user.id },
        "driver_account.delete.auth_user_missing_driver_threw",
      );
    }
    if (!authDeleted) {
      res.status(502).json({
        error: "auth_delete_failed",
        message: "Couldn't fully delete your account. Please try again or contact support.",
      });
      return;
    }
    res.json({ success: true, anonymized: false, authDeleted: true });
    return;
  }

  // ── Anonymize + audit (single transaction, preflight under row lock) ─────
  // Preflight checks live INSIDE the transaction with `SELECT … FOR UPDATE`
  // on the driver row so a concurrent dispatch / payout request cannot race
  // past the block policy. We also re-check assignments + payouts under the
  // lock — anything that took the lock first and then committed must be
  // visible here before we anonymize.
  const sentinelUserId = `deleted:${driver.id}`;
  const sentinelString = "[deleted]";

  type DeletePreflightFailure =
    | { reason: "active_ride"; count: number }
    | { reason: "pending_payout"; count: number; total: number }
    | { reason: "unpaid_balance"; count: number; total: number };

  let preflightFailure: DeletePreflightFailure | null = null;

  try {
    await db.transaction(async (tx) => {
      // Take a row-level lock on the driver. Any concurrent writer that
      // wants to mutate this driver (location update, payout insert, etc.)
      // serializes against this lock.
      const locked = await tx.execute<{ id: string }>(
        sql`SELECT id FROM ${driversTable} WHERE ${driversTable.id} = ${driver.id} FOR UPDATE`,
      );
      // drizzle's NodePg execute() returns { rows: [...] }; older shapes are
      // array-like — normalize without depending on a specific runtime.
      const rows = (locked as unknown as { rows?: unknown[] }).rows ?? (locked as unknown as unknown[]);
      if (!Array.isArray(rows) || rows.length === 0) {
        // Vanishingly rare (driver row deleted between SELECT and lock).
        throw new Error("driver_row_missing_under_lock");
      }

      // Preflight #1 — active rides (under lock).
      const activeAssignments = await tx
        .select({ id: driverAssignmentsTable.id })
        .from(driverAssignmentsTable)
        .where(
          and(
            eq(driverAssignmentsTable.driverId, driver.id),
            inArray(driverAssignmentsTable.status, [...ACTIVE_ASSIGNMENT_STATUSES]),
          ),
        );
      if (activeAssignments.length > 0) {
        preflightFailure = { reason: "active_ride", count: activeAssignments.length };
        // Throwing inside the tx aborts the anonymize/audit writes. We
        // signal the specific failure via the outer `preflightFailure` var.
        throw new Error("preflight_active_ride");
      }

      // Preflight #2 — pending payouts (under lock).
      // Policy (documented in replit.md): BLOCK rather than auto-forfeit or
      // auto-pay so the Stripe webhook can still reconcile in-flight
      // transfers to the driver row.
      const pendingPayouts = await tx
        .select({ id: driverPayoutsTable.id, amount: driverPayoutsTable.amount })
        .from(driverPayoutsTable)
        .where(
          and(
            eq(driverPayoutsTable.driverId, driver.id),
            eq(driverPayoutsTable.status, "pending"),
          ),
        );
      if (pendingPayouts.length > 0) {
        const total = pendingPayouts.reduce((sum, p) => sum + (p.amount ?? 0), 0);
        preflightFailure = {
          reason: "pending_payout",
          count: pendingPayouts.length,
          total,
        };
        throw new Error("preflight_pending_payout");
      }

      // Preflight #3 — unpaid earned balance (under lock).
      // A driver may have completed rides whose payout has not yet been
      // requested. We block deletion so the driver can request a payout
      // first; auto-forfeiture would lose them earned money, and
      // auto-payout would create a transfer to a soon-to-be-anonymized
      // account that the Stripe webhook can't reconcile cleanly.
      const unpaidRides = await tx
        .select({
          id: driverAssignmentsTable.id,
          amount: driverAssignmentsTable.driverPayoutAmount,
        })
        .from(driverAssignmentsTable)
        .where(
          and(
            eq(driverAssignmentsTable.driverId, driver.id),
            eq(driverAssignmentsTable.status, "completed"),
            // payout_status IS NULL or 'unpaid' — anything not yet attached
            // to a payout row counts toward the unpaid balance.
            sql`(${driverAssignmentsTable.payoutStatus} IS NULL OR ${driverAssignmentsTable.payoutStatus} = 'unpaid')`,
          ),
        );
      if (unpaidRides.length > 0) {
        const total = unpaidRides.reduce((sum, r) => sum + (r.amount ?? 0), 0);
        // Only block when there's actual money at stake; if everything
        // sums to $0 (data anomaly, zero-fare promo), allow deletion.
        if (total > 0) {
          preflightFailure = {
            reason: "unpaid_balance",
            count: unpaidRides.length,
            total,
          };
          throw new Error("preflight_unpaid_balance");
        }
      }

      // All preflights passed under the lock — anonymize + audit.
      await tx
        .update(driversTable)
        .set({
          userId: sentinelUserId,
          firstName: sentinelString,
          lastName: sentinelString,
          email: sentinelString,
          phone: sentinelString,
          profilePhotoUrl: null,
          licenseDocumentPath: null,
          insuranceDocumentPath: null,
          documentRejectionReason: null,
          stripeAccountId: null,
          currentLat: null,
          currentLng: null,
          locationUpdatedAt: null,
          preferredPartnerId: null,
          status: "deleted",
          isOnline: false,
          canDriveMemberVehicle: false,
          canDoRideshare: false,
          canDoDelivery: false,
        })
        .where(eq(driversTable.id, driver.id));

      await tx.insert(driverAuditLogTable).values({
        driverId: driver.id,
        action: "self_delete",
        // Audit log's `admin_email` column is notNull, but we must NOT
        // retain the driver's real email here — the entire point of this
        // flow is to scrub PII. Use a non-PII sentinel that's clearly
        // distinguishable from admin-initiated actions; `driverId` is
        // preserved on the row for support correlation.
        adminEmail: "self-delete@system",
        resultingStatus: "deleted",
        reason: "Driver-initiated self deletion from Settings",
      });
    });
  } catch (err) {
    // Distinguish preflight aborts (expected 409 path) from real errors.
    // Use a local alias with an explicit widened type so the tx-closure
    // assignments aren't narrowed to `never` by control-flow analysis.
    const failure = preflightFailure as DeletePreflightFailure | null;
    if (failure) {
      if (failure.reason === "active_ride") {
        res.status(409).json({
          error: "active_ride",
          reason: "active_ride",
          message:
            "You have an active ride in progress. Finish or cancel it before deleting your account.",
          activeAssignmentCount: failure.count,
        });
      } else if (failure.reason === "pending_payout") {
        res.status(409).json({
          error: "pending_payout",
          reason: "pending_payout",
          message:
            "You have a payout in progress. Wait for it to complete (or cancel it) before deleting your account.",
          pendingPayoutCount: failure.count,
          pendingPayoutAmount: failure.total,
        });
      } else {
        res.status(409).json({
          error: "unpaid_balance",
          reason: "unpaid_balance",
          message:
            "You still have unpaid earnings. Request a payout for the balance before deleting your account.",
          unpaidRideCount: failure.count,
          unpaidBalance: failure.total,
        });
      }
      return;
    }
    logger.error(
      { err, driverId: driver.id },
      "driver_account.delete.anonymize_failed",
    );
    res.status(500).json({ error: "Internal error" });
    return;
  }

  // ── Delete the Supabase auth user (also revokes sessions) ─────────────────
  // We do this AFTER the local anonymization commits — if it fails, the
  // local row is already cleaned and the user can re-attempt without losing
  // more data; conversely, an orphaned auth user is a re-sign-in nuisance,
  // not a privacy regression. We surface the failure so the client knows the
  // session may still be live.
  let authDeleted = true;
  try {
    const { error } = await supabaseAdmin.auth.admin.deleteUser(user.id);
    if (error) {
      authDeleted = false;
      logger.error(
        { err: error.message, driverId: driver.id, userId: user.id },
        "driver_account.delete.supabase_auth_delete_failed",
      );
    }
  } catch (err) {
    authDeleted = false;
    logger.error(
      { err: err instanceof Error ? err.message : String(err), driverId: driver.id, userId: user.id },
      "driver_account.delete.supabase_auth_delete_threw",
    );
  }

  // Best-effort mirror to Supabase `drivers` so admin tooling sees the
  // scrubbed row immediately. A Supabase outage must not unwind the local
  // anonymization, so we only log failures.
  try {
    // Mirror the full anonymization set (not just visible PII) so the
    // Supabase mirror cannot diverge from local Drizzle state after a
    // 207 partial-success or a transient Supabase outage.
    const { error: mirrorErr } = await supabaseAdmin
      .from("drivers")
      .update({
        user_id: sentinelUserId,
        first_name: sentinelString,
        last_name: sentinelString,
        email: sentinelString,
        phone: sentinelString,
        profile_photo_url: null,
        license_document_path: null,
        insurance_document_path: null,
        document_rejection_reason: null,
        stripe_account_id: null,
        current_lat: null,
        current_lng: null,
        location_updated_at: null,
        preferred_partner_id: null,
        status: "deleted",
        is_online: false,
        can_drive_member_vehicle: false,
        can_do_rideshare: false,
        can_do_delivery: false,
      })
      .eq("id", driver.id);
    if (mirrorErr) {
      logger.warn(
        { err: mirrorErr.message, driverId: driver.id },
        "driver_account.delete.supabase_mirror_failed",
      );
    }
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), driverId: driver.id },
      "driver_account.delete.supabase_mirror_threw",
    );
  }

  req.log.info({ driverId: driver.id, authDeleted }, "driver_account.deleted");

  // The local row is anonymized either way, but if the Supabase auth user
  // wasn't deleted the device session is still live — surface that as a
  // partial-success response so the client can warn the user instead of
  // silently bouncing them to the welcome screen and leaving a zombie
  // session that could be used to call other endpoints.
  if (!authDeleted) {
    res.status(207).json({
      success: true,
      anonymized: true,
      authDeleted: false,
      warning:
        "Your profile was erased, but signing you out of this device failed. Please sign out manually from Settings.",
    });
    return;
  }

  res.json({ success: true, anonymized: true, authDeleted: true });
});

export default router;
