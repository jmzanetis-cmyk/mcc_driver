-- ============================================================
-- Enable Supabase Realtime for the rides table
-- ============================================================
-- Run this once in the Supabase SQL editor for your project.
-- Required for useRideCancellation to receive ride status
-- UPDATE events when a ride is cancelled externally.
--
-- Prerequisites already done (2026-05-15):
--   ALTER PUBLICATION supabase_realtime ADD TABLE driver_assignments;
--
-- Run this next:
ALTER PUBLICATION supabase_realtime ADD TABLE rides;

-- Verify:
SELECT tablename
FROM   pg_publication_tables
WHERE  pubname = 'supabase_realtime'
ORDER  BY tablename;
-- Expected output includes: driver_assignments, rides
