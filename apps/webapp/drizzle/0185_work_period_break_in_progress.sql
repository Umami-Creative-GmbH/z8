-- #861: a break in progress is recorded on the employee's live work (Time
-- Tracking ADR 0007). Its start and zone are set together and cleared together
-- when the work closes; the operation that started it stays, so a retried start
-- replays, and one operation starts at most one break in an organization.
ALTER TABLE "work_period" ADD COLUMN IF NOT EXISTS "break_started_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "work_period" ADD COLUMN IF NOT EXISTS "break_started_zone" text;
--> statement-breakpoint
ALTER TABLE "work_period" ADD COLUMN IF NOT EXISTS "break_started_operation_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "work_period" ADD CONSTRAINT "workPeriod_break_in_progress_chk" CHECK (("work_period"."break_started_at" IS NULL) = ("work_period"."break_started_zone" IS NULL) AND ("work_period"."break_started_at" IS NULL OR "work_period"."break_started_operation_id" IS NOT NULL));
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workPeriod_org_breakStartedOperation_idx" ON "work_period" USING btree ("organization_id","break_started_operation_id") WHERE "work_period"."break_started_operation_id" IS NOT NULL;
