-- Latest clock-in on detailed work-policy schedule days (#830): a local wall-clock time
-- ("HH:mm") by which the employee is expected to have clocked in. Null means none, so
-- existing policies keep behaving exactly as before.
ALTER TABLE "work_policy_schedule_day" ADD COLUMN IF NOT EXISTS "latest_clock_in" text;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "work_policy_schedule_day" ADD CONSTRAINT "work_policy_schedule_day_latest_clock_in_check" CHECK ("latest_clock_in" IS NULL OR "latest_clock_in" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
