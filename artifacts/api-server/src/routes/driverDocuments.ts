// ============================================================
// MCC API — Driver Documents
// ============================================================
// GET /api/drivers/me/documents
//   Returns document metadata for the authenticated driver.
//   Raw storage paths are never sent to the client.
//
// GET /api/drivers/me/documents/signed-url?doc=<id>
//   Generates a short-lived signed URL after verifying the
//   requesting driver owns the document.
//
// Security model:
//   1. JWT verified server-side via supabaseAdmin.auth.getUser()
//   2. Driver row fetched via user_id = auth user's id — no
//      client-supplied driver id is ever trusted
//   3. Signed URL: the stored path must start with {driver.id}/
//      (ownership) and the doc param must match the known-field
//      whitelist (path traversal prevention)
//   4. supabaseAdmin (service role) creates signed URLs — never
//      a public URL and never via the anon client
//   5. Raw storage paths are stripped before any JSON response
// ============================================================

import { Router, type Request, type Response } from "express";
import { supabaseAdmin } from "../lib/supabaseAdmin";
import { logger } from "../lib/logger";

const router = Router();

const BUCKET = "driver-documents";
const SIGNED_URL_TTL_SECONDS = 300; // 5 minutes

interface DriverDocRow {
  id: string;
  license_document_path: string | null;
  insurance_document_path: string | null;
  registration_document_path: string | null;
  bgc_status: string;
  background_check_passed: boolean;
}

async function resolveDriver(authHeader: string | undefined): Promise<DriverDocRow | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;
  const { data } = await supabaseAdmin
    .from("drivers")
    .select("id, license_document_path, insurance_document_path, registration_document_path, bgc_status, background_check_passed")
    .eq("user_id", user.id)
    .single();
  return (data as DriverDocRow | null);
}

// Extract a relative storage path from whatever the DB stores.
// Old uploads (DocumentsScreen bug) stored the full getPublicUrl() result;
// new uploads store a plain path.  Both start with the driver's folder.
function toStoragePath(stored: string): string {
  const marker = `/${BUCKET}/`;
  const idx = stored.indexOf(marker);
  if (idx !== -1) return stored.slice(idx + marker.length);
  return stored;
}

// ── GET /drivers/me/documents ─────────────────────────────────────────────────

router.get("/drivers/me/documents", async (req: Request, res: Response) => {
  try {
    const driver = await resolveDriver(req.headers.authorization);
    if (!driver) { res.status(401).json({ error: "Unauthorized" }); return; }

    const bgcStatusLabel: Record<string, string> = {
      passed:      "Verified",
      pending:     "In Review",
      failed:      "Failed",
      not_started: "Not Started",
    };

    const documents = [
      {
        id: "bgc",
        category: "compliance",
        label: "Background Check",
        hasFile: false,
        status: driver.bgc_status,
        statusLabel: bgcStatusLabel[driver.bgc_status] ?? "Not Started",
      },
      {
        id: "license",
        category: "licenses",
        label: "Driver's License",
        hasFile: !!driver.license_document_path,
        status: driver.license_document_path ? "uploaded" : "missing",
        statusLabel: driver.license_document_path ? "On File" : "Not Uploaded",
      },
      {
        id: "insurance",
        category: "licenses",
        label: "Vehicle Insurance",
        hasFile: !!driver.insurance_document_path,
        status: driver.insurance_document_path ? "uploaded" : "missing",
        statusLabel: driver.insurance_document_path ? "On File" : "Not Uploaded",
      },
      {
        id: "registration",
        category: "licenses",
        label: "Vehicle Registration",
        hasFile: !!driver.registration_document_path,
        status: driver.registration_document_path ? "uploaded" : "missing",
        statusLabel: driver.registration_document_path ? "On File" : "Not Uploaded",
      },
    ];

    res.json({ documents });
  } catch (err) {
    logger.error({ err }, "driverDocuments.list unhandled error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /drivers/me/documents/signed-url ─────────────────────────────────────

router.get("/drivers/me/documents/signed-url", async (req: Request, res: Response) => {
  try {
    const driver = await resolveDriver(req.headers.authorization);
    if (!driver) { res.status(401).json({ error: "Unauthorized" }); return; }

    const docId = req.query.doc as string | undefined;
    if (!docId) { res.status(400).json({ error: "doc query param required" }); return; }

    const pathByDocId: Record<string, string | null | undefined> = {
      license:      driver.license_document_path,
      insurance:    driver.insurance_document_path,
      registration: driver.registration_document_path,
    };

    if (!(docId in pathByDocId)) {
      res.status(400).json({ error: "Unknown document type" });
      return;
    }

    const rawStored = pathByDocId[docId];
    if (!rawStored) {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    const storagePath = toStoragePath(rawStored);

    // Ownership: the path's first folder segment must be this driver's id.
    if (!storagePath.startsWith(`${driver.id}/`)) {
      logger.warn(
        { driverId: driver.id, storagePath },
        "driverDocuments.signed-url: path ownership mismatch — possible data integrity issue",
      );
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const { data, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);

    if (error || !data?.signedUrl) {
      logger.error({ err: error, storagePath }, "driverDocuments.signed-url: createSignedUrl failed");
      res.status(500).json({ error: "Could not generate document URL" });
      return;
    }

    const expiresAt = new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString();
    res.json({ signedUrl: data.signedUrl, expiresAt });
  } catch (err) {
    logger.error({ err }, "driverDocuments.signed-url unhandled error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
