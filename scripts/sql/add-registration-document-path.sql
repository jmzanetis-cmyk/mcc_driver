-- Add vehicle registration document path to drivers table.
-- Run against the production database BEFORE deploying the API server
-- and driver-app builds that reference this column.
ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS registration_document_path TEXT;
