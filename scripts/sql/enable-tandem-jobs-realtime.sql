-- Enable Supabase Realtime on the tandem_jobs table so the ride-along
-- driver dashboard receives INSERT/UPDATE notifications when jobs are
-- broadcast or matched. Run once in the Supabase SQL editor.
--
-- The API server mirrors tandem_jobs writes via upsertTandemJobViaSupabase
-- (see artifacts/api-server/src/lib/supabaseAdmin.ts). Without this
-- publication entry, the upserts succeed but no Realtime event fires.

ALTER PUBLICATION supabase_realtime ADD TABLE tandem_jobs;
