-- Add waypoints jsonb column to rides for multi-stop support
-- Format: [{ "address": "...", "lat": 0, "lng": 0, "label": "Stop 1" }, ...]
ALTER TABLE rides ADD COLUMN IF NOT EXISTS waypoints JSONB;
