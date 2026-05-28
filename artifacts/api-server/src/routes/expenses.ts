// ============================================================
// MCC API — GET/POST/DELETE /api/expenses
// ============================================================
// Business expense log for tax deduction tracking.
// ============================================================

import { Router, type Request, type Response } from "express";
import { supabaseAdmin } from "../lib/supabaseAdmin";
import { logger } from "../lib/logger";

const router = Router();

export const EXPENSE_CATEGORIES = [
  "gas", "car_wash", "phone", "insurance", "maintenance", "parking", "tolls", "other",
] as const;

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
    .eq("profile_id", user.id)
    .single();
  if (driverError || !driver) {
    res.status(404).json({ error: "Driver profile not found" });
    return null;
  }
  return driver.id as string;
}

// ── GET /api/expenses ─────────────────────────────────────────────────────────

router.get("/expenses", async (req: Request, res: Response) => {
  try {
    const driverId = await resolveDriver(req, res);
    if (!driverId) return;

    const year = req.query.year ? Number(req.query.year) : new Date().getFullYear();
    const yearStart = `${year}-01-01T00:00:00Z`;
    const yearEnd = `${year + 1}-01-01T00:00:00Z`;

    const { data: expenses, error } = await supabaseAdmin
      .from("driver_expenses")
      .select("id, category, amount_cents, expense_date, description, receipt_url, created_at")
      .eq("driver_id", driverId)
      .gte("expense_date", yearStart)
      .lt("expense_date", yearEnd)
      .order("expense_date", { ascending: false });

    if (error) {
      logger.error({ err: error }, "Failed to fetch expenses");
      res.status(500).json({ error: "Failed to fetch expenses" });
      return;
    }

    const rows = expenses ?? [];
    const totalCents = rows.reduce((sum, e) => sum + (e.amount_cents ?? 0), 0);

    // Per-category breakdown
    const byCategory: Record<string, number> = {};
    for (const e of rows) {
      byCategory[e.category] = (byCategory[e.category] ?? 0) + (e.amount_cents ?? 0);
    }

    res.json({
      expenses: rows,
      summary: {
        totalCents,
        totalDollars: totalCents / 100,
        byCategory,
        year,
      },
    });
  } catch (err) {
    logger.error({ err }, "Unhandled error in GET /expenses");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/expenses ────────────────────────────────────────────────────────

router.post("/expenses", async (req: Request, res: Response) => {
  try {
    const driverId = await resolveDriver(req, res);
    if (!driverId) return;

    const { category, amountCents, expenseDate, description, receiptUrl } = req.body as {
      category: string;
      amountCents: number;
      expenseDate: string;
      description?: string;
      receiptUrl?: string;
    };

    if (!category || amountCents == null || !expenseDate) {
      res.status(400).json({ error: "category, amountCents, and expenseDate are required" });
      return;
    }
    if (!EXPENSE_CATEGORIES.includes(category as typeof EXPENSE_CATEGORIES[number])) {
      res.status(400).json({ error: `category must be one of: ${EXPENSE_CATEGORIES.join(", ")}` });
      return;
    }
    if (amountCents < 1) {
      res.status(400).json({ error: "amountCents must be at least 1" });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from("driver_expenses")
      .insert({
        driver_id: driverId,
        category,
        amount_cents: amountCents,
        expense_date: expenseDate,
        description: description ?? null,
        receipt_url: receiptUrl ?? null,
      })
      .select("id, category, amount_cents, expense_date, description, receipt_url, created_at")
      .single();

    if (error) {
      logger.error({ err: error }, "Failed to insert expense");
      res.status(500).json({ error: "Failed to save expense" });
      return;
    }

    res.status(201).json({ expense: data });
  } catch (err) {
    logger.error({ err }, "Unhandled error in POST /expenses");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /api/expenses/:id ──────────────────────────────────────────────────

router.delete("/expenses/:id", async (req: Request, res: Response) => {
  try {
    const driverId = await resolveDriver(req, res);
    if (!driverId) return;

    const { error } = await supabaseAdmin
      .from("driver_expenses")
      .delete()
      .eq("id", req.params.id)
      .eq("driver_id", driverId);

    if (error) {
      logger.error({ err: error }, "Failed to delete expense");
      res.status(500).json({ error: "Failed to delete expense" });
      return;
    }

    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Unhandled error in DELETE /expenses/:id");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
