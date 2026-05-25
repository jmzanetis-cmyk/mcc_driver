// ============================================================
// MCC API — GET /api/transport/estimate
// ============================================================
// Returns a fare breakdown for an MCC vehicle transport job.
// No auth required — public rate lookup used by dispatch tools
// and the driver app's TransportEstimateCard.
//
// Query params:
//   miles   (required) — estimated trip distance in miles
//   tandem  (optional) — "true" for paired/concierge jobs
//   subsidy (optional) — provider subsidy % (0–100), default 0
// ============================================================

import { Router, type Request, type Response } from "express";
import {
  calculateTransportFare,
  calculateMemberPrice,
  TRANSPORT_RATES,
} from "@workspace/shared/transportRates";

const router = Router();

router.get("/transport/estimate", (req: Request, res: Response) => {
  const milesRaw  = req.query.miles  as string | undefined;
  const tandemRaw = req.query.tandem as string | undefined;
  const subsidyRaw = req.query.subsidy as string | undefined;

  const miles = parseFloat(milesRaw ?? "");
  if (!Number.isFinite(miles) || miles <= 0) {
    res.status(400).json({ error: "miles must be a positive number" });
    return;
  }

  const isTandem        = tandemRaw === "true";
  const subsidyPercent  = Math.min(100, Math.max(0, parseFloat(subsidyRaw ?? "0") || 0));

  const fare    = calculateTransportFare(miles, isTandem);
  const pricing = calculateMemberPrice(fare.totalCents, subsidyPercent);

  res.json({
    miles,
    isTandem,
    subsidyPercent,
    tierLabel:           fare.tierLabel,
    totalCents:          fare.totalCents,
    driverCents:         fare.driverCents,
    insuranceCents:      fare.insuranceCents,
    platformCents:       fare.platformCents,
    primaryDriverCents:  fare.primaryDriverCents,
    chaseDriverCents:    fare.chaseDriverCents,
    memberPaysCents:     pricing.memberPaysCents,
    providerPaysCents:   pricing.providerPaysCents,
    tipPresets:          TRANSPORT_RATES.tipPresets,
    tipWindowHours:      TRANSPORT_RATES.tipWindowHours,
  });
});

export default router;
