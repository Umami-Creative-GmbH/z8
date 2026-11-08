-- #1629 (spec #1590): an applied follow-up deactivation that left reports with
-- no current manager keeps this marker until the organization's admins were
-- told; the follow-up retries the notice on every run until it is sent.
ALTER TABLE "employee_deactivation" ADD COLUMN IF NOT EXISTS "reports_notice_pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- The follow-up scan reads the rows awaiting their notice oldest first.
CREATE INDEX IF NOT EXISTS "employeeDeactivation_reports_notice_idx" ON "employee_deactivation" USING btree ("created_at","organization_id","id") WHERE reports_notice_pending;
