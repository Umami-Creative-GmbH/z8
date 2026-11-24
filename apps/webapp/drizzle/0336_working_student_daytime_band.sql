-- #2017: the working-student weekday daytime band (§ 6 Abs. 1 Nr. 3 SGB V lecture-week rule) as an
-- organization statutory preference, in minutes after local midnight: [start, end), whole quarter
-- hours, 00:00 to 24:00. Default 06:00–18:00, the band Z8 used before; existing rows keep it.
-- Re-runnable: `drizzle-kit push` may already have created the columns and the check.
ALTER TABLE "organization_statutory_preference" ADD COLUMN IF NOT EXISTS "working_student_daytime_start_minute" integer DEFAULT 360 NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_statutory_preference" ADD COLUMN IF NOT EXISTS "working_student_daytime_end_minute" integer DEFAULT 1080 NOT NULL;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organization_statutory_preference_daytime_band_check') THEN
		ALTER TABLE "organization_statutory_preference" ADD CONSTRAINT "organization_statutory_preference_daytime_band_check" CHECK ("working_student_daytime_start_minute" >= 0 AND "working_student_daytime_end_minute" <= 1440 AND "working_student_daytime_start_minute" < "working_student_daytime_end_minute" AND "working_student_daytime_start_minute" % 15 = 0 AND "working_student_daytime_end_minute" % 15 = 0);
	END IF;
END $$;
