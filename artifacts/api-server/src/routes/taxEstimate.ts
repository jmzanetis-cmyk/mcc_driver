// ============================================================
// MCC API — GET /api/tax-estimate
// ============================================================
// Computes quarterly self-employment tax estimate for the driver.
//
// Formula:
//   grossEarnings  = sum(driver_earnings.amount_cents) for the year
//   mileageDeduction = totalMiles * IRS_RATE ($0.70/mile for 2026)
//   expenseDeduction = sum(driver_expenses.amount_cents) for the year
//   netIncome      = grossEarnings - mileageDeduction - expenseDeduction
//   seTax          = max(0, netIncome) * 0.9235 * 0.153   (SE tax rate)
//   incomeTax      = max(0, netIncome - seTax/2) * 0.22   (22% bracket estimate)
//   annualTax      = seTax + incomeTax
//   quarterlyEst   = annualTax / 4
//
// This is an estimate only — drivers should consult a tax professional.
// ============================================================

import { Router, type Request, type Response } from "express";
import { supabaseAdmin } from "../lib/supabaseAdmin";
import { logger } from "../lib/logger";
import { IRS_RATE_2026 } from "./mileage";

const router = Router();

const SE_TAX_RATE = 0.153;
const SE_DEDUCTIBLE_FRACTION = 0.9235;
const INCOME_TAX_RATE = 0.22;

// ── Auth helper ───────────────────────────────────────────────────────────────

async function resolveDriver(req: Request, res: Response) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing authorization token" });
    return null;
  }
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) {
    res.status(401).json({ error: "Invalid or expired token" });
    return null;
  }
  const { data: driver, error: driverError } = await supabaseAdmin
    .from("drivers")
    .select("id")
    .eq("user_id", user.id)
    .single();
  if (driverError || !driver) {
    res.status(404).json({ error: "Driver profile not found" });
    return null;
  }
  return driver.id as string;
}

// ── GET /api/tax-estimate ─────────────────────────────────────────────────────

router.get("/tax-estimate", async (req: Request, res: Response) => {
  try {
    const driverId = await resolveDriver(req, res);
    if (!driverId) return;

    const year = req.query.year ? Number(req.query.year) : new Date().getFullYear();
    const yearStart = `${year}-01-01T00:00:00Z`;
    const yearEnd = `${year + 1}-01-01T00:00:00Z`;

    const [
      { data: earnings, error: earningsError },
      { data: mileageLogs, error: mileageError },
      { data: expenses, error: expensesError },
    ] = await Promise.all([
      supabaseAdmin
        .from("driver_earnings")
        .select("amount_cents")
        .eq("driver_id", driverId)
        .neq("payout_status", "pending")
        .gte("recorded_at", yearStart)
        .lt("recorded_at", yearEnd),
      supabaseAdmin
        .from("driver_mileage_logs")
        .select("miles")
        .eq("driver_id", driverId)
        .gte("trip_date", yearStart)
        .lt("trip_date", yearEnd),
      supabaseAdmin
        .from("driver_expenses")
        .select("amount_cents")
        .eq("driver_id", driverId)
        .gte("expense_date", yearStart)
        .lt("expense_date", yearEnd),
    ]);

    if (earningsError || mileageError || expensesError) {
      logger.error({ earningsError, mileageError, expensesError }, "Failed to fetch tax estimate data");
      res.status(500).json({ error: "Failed to compute tax estimate" });
      return;
    }

    const grossEarnings = (earnings ?? []).reduce((s, e) => s + (e.amount_cents ?? 0), 0) / 100;
    const totalMiles = (mileageLogs ?? []).reduce((s, m) => s + (m.miles ?? 0), 0);
    const mileageDeduction = totalMiles * IRS_RATE_2026;
    const expenseDeduction = (expenses ?? []).reduce((s, e) => s + (e.amount_cents ?? 0), 0) / 100;

    const netIncome = Math.max(0, grossEarnings - mileageDeduction - expenseDeduction);

    // SE tax is on 92.35% of net SE income
    const seTax = netIncome * SE_DEDUCTIBLE_FRACTION * SE_TAX_RATE;
    // Can deduct half of SE tax from taxable income
    const taxableIncome = Math.max(0, netIncome - seTax / 2);
    const incomeTax = taxableIncome * INCOME_TAX_RATE;
    const annualTax = seTax + incomeTax;
    const quarterlyPayment = annualTax / 4;

    // Current quarter (1-4)
    const month = new Date().getMonth(); // 0-indexed
    const currentQuarter = Math.floor(month / 3) + 1;

    res.json({
      year,
      currentQuarter,
      inputs: {
        grossEarnings: Math.round(grossEarnings * 100) / 100,
        totalMiles: Math.round(totalMiles * 10) / 10,
        mileageDeduction: Math.round(mileageDeduction * 100) / 100,
        expenseDeduction: Math.round(expenseDeduction * 100) / 100,
        netIncome: Math.round(netIncome * 100) / 100,
      },
      taxes: {
        seTax: Math.round(seTax * 100) / 100,
        incomeTax: Math.round(incomeTax * 100) / 100,
        annualTax: Math.round(annualTax * 100) / 100,
        quarterlyPayment: Math.round(quarterlyPayment * 100) / 100,
      },
      rates: {
        irsRatePerMile: IRS_RATE_2026,
        seTaxRate: SE_TAX_RATE,
        incomeTaxRate: INCOME_TAX_RATE,
      },
      disclaimer: "This is an estimate only. Consult a tax professional for personalized advice.",
    });
  } catch (err) {
    logger.error({ err }, "Unhandled error in GET /tax-estimate");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
