-- Add expiry date columns for document compliance checking
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS license_expiry DATE;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS insurance_expiry DATE;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS registration_expiry DATE;

-- Create driver-documents storage bucket via Supabase Dashboard:
-- Name: driver-documents, Public: false (private with RLS)
