-- #885 (review): a break in progress that an offline kiosk queued keeps where its instant came
-- from (server_anchor or device_clock), so the entry its closure writes at the break's start
-- records that time source rather than the one of the resume or clock-out that ends it. Null for
-- every other start; cleared with the break in progress when the work closes.
ALTER TABLE "work_period" ADD COLUMN IF NOT EXISTS "break_started_time_source" text;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "work_period" ADD CONSTRAINT "workPeriod_break_time_source_chk" CHECK ("work_period"."break_started_time_source" IS NULL OR ("work_period"."break_started_at" IS NOT NULL AND "work_period"."break_started_time_source" IN ('server_anchor', 'device_clock')));
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
