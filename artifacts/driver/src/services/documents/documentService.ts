// ============================================================
// MCC Driver — Document Storage Service
// ============================================================
// Uses a PRIVATE Supabase Storage bucket ("driver-documents").
//
// Bucket setup (Supabase dashboard):
//   - Bucket: driver-documents, Public: OFF
//   - RLS INSERT policy: auth.uid()::text = (storage.foldername(name))[1]
//   - RLS SELECT policy: same (drivers can only read their own files)
//   - Admin/service-role access is used for review-side reads via signed URLs
// ============================================================

import { supabase } from '@/services/supabase/client';
import { logger } from '@/services/telemetry/logger';

const BUCKET = 'driver-documents';
const SIGNED_URL_EXPIRY_SECONDS = 300; // 5-minute expiry for view links

export type DocumentType = 'license' | 'insurance';

export interface UploadResult {
  success: boolean;
  /** Storage path (e.g. "abc-user-id/license.jpg") — NOT a public URL */
  path?: string;
  error?: string;
}

/**
 * Upload a document to the private driver-documents bucket.
 * Returns the storage path to be persisted in the database — never a public URL.
 */
export async function uploadDriverDocument(
  userId: string,
  documentType: DocumentType,
  file: File,
): Promise<UploadResult> {
  const ext = file.name.split('.').pop() ?? 'jpg';
  const path = `${userId}/${documentType}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type });

  if (uploadError) {
    logger.error('documents.upload_failed', { documentType, error: uploadError.message });
    return { success: false, error: uploadError.message };
  }

  logger.info('documents.upload_success', { documentType, path });
  return { success: true, path };
}

/**
 * Generate a short-lived signed URL for viewing a private document.
 * Only call this when a user or authorized admin needs to actually view the file.
 */
export async function getSignedDocumentUrl(storagePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_EXPIRY_SECONDS);

  if (error || !data?.signedUrl) {
    logger.error('documents.signed_url_failed', { storagePath, error: error?.message });
    return null;
  }

  return data.signedUrl;
}
