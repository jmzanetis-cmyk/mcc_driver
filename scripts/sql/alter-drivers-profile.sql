-- Add bio column and driver-photos bucket setup notes
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS bio TEXT;

-- Create driver-photos storage bucket via Supabase Dashboard:
-- Name: driver-photos, Public: true (profile photos are public-facing)
