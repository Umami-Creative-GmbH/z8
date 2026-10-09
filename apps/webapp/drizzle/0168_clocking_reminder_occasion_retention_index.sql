-- #919: serves the per-organization, time-bounded retention delete of sent clocking reminder occasions.
-- Idempotent: replayed by migration-runner.integration.test.ts.
CREATE INDEX IF NOT EXISTS "clockingReminderOccasion_org_expectedAt_idx" ON "clocking_reminder_occasion" USING btree ("organization_id","expected_at");
