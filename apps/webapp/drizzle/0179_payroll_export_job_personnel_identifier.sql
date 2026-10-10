-- A payroll export job created without collected work input (legacy collection)
-- freezes the custom field personnel identifier values it exports (#821, spec
-- #769): retries, recovery and re-delivery never read a later change.
-- Idempotent: the migration runner test replays every migration after 0141.
ALTER TABLE "payroll_export_job" ADD COLUMN IF NOT EXISTS "personnel_identifier" jsonb;
