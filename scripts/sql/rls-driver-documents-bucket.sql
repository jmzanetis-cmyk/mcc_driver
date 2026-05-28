-- RLS policies for the private 'driver-documents' Supabase Storage bucket.
--
-- WHEN TO RUN: apply these in the Supabase dashboard (SQL Editor) BEFORE
-- deploying the driver app that uses the new My Documents screen.
-- The policies are safe to apply while the existing app is running —
-- they only restrict which paths a driver can read/write, they don't
-- change the bucket's public/private setting.
--
-- PATH STRUCTURE: driver-documents/{drivers.id}/{field}.{ext}
-- The folder name is the drivers table PK (UUID), which is different from
-- the Supabase auth user's UUID.  The subquery ties them together.
--
-- ADMIN ACCESS: the API server uses the service_role key which bypasses RLS
-- entirely, so these policies don't affect server-side signed URL generation.

-- Drop any stale/incorrect existing policies on this bucket before recreating.
DROP POLICY IF EXISTS "drivers_select_own" ON storage.objects;
DROP POLICY IF EXISTS "drivers_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "drivers_update_own" ON storage.objects;
DROP POLICY IF EXISTS "driver_documents_select_own" ON storage.objects;
DROP POLICY IF EXISTS "driver_documents_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "driver_documents_update_own" ON storage.objects;

-- SELECT: a driver may only read files in their own folder.
CREATE POLICY "driver_documents_select_own"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'driver-documents'
  AND (storage.foldername(name))[1] IN (
    SELECT id::text FROM public.drivers WHERE user_id = auth.uid()
  )
);

-- INSERT: a driver may only upload to their own folder.
CREATE POLICY "driver_documents_insert_own"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'driver-documents'
  AND (storage.foldername(name))[1] IN (
    SELECT id::text FROM public.drivers WHERE user_id = auth.uid()
  )
);

-- UPDATE: a driver may overwrite (upsert) only their own files.
CREATE POLICY "driver_documents_update_own"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'driver-documents'
  AND (storage.foldername(name))[1] IN (
    SELECT id::text FROM public.drivers WHERE user_id = auth.uid()
  )
)
WITH CHECK (
  bucket_id = 'driver-documents'
  AND (storage.foldername(name))[1] IN (
    SELECT id::text FROM public.drivers WHERE user_id = auth.uid()
  )
);

-- No DELETE policy for authenticated role.
-- Only service_role (admin) can delete documents — RLS bypass via key.
