-- #1993: JArbSchG youth-protection violations recorded by the clock-out compliance check.
-- Additive enum values and one nullable column; existing rows are untouched.
ALTER TYPE "public"."time_regulation_violation_type" ADD VALUE IF NOT EXISTS 'jarbschg_daily_max';--> statement-breakpoint
ALTER TYPE "public"."time_regulation_violation_type" ADD VALUE IF NOT EXISTS 'jarbschg_weekly_max';--> statement-breakpoint
ALTER TYPE "public"."time_regulation_violation_type" ADD VALUE IF NOT EXISTS 'jarbschg_days_per_week';--> statement-breakpoint
ALTER TYPE "public"."time_regulation_violation_type" ADD VALUE IF NOT EXISTS 'jarbschg_rest_period';--> statement-breakpoint
ALTER TYPE "public"."time_regulation_violation_type" ADD VALUE IF NOT EXISTS 'jarbschg_uninterrupted';--> statement-breakpoint
ALTER TYPE "public"."time_regulation_violation_type" ADD VALUE IF NOT EXISTS 'jarbschg_break';--> statement-breakpoint
ALTER TYPE "public"."time_regulation_violation_type" ADD VALUE IF NOT EXISTS 'jarbschg_night_work';--> statement-breakpoint
ALTER TYPE "public"."time_regulation_violation_type" ADD VALUE IF NOT EXISTS 'jarbschg_saturday_work';--> statement-breakpoint
ALTER TYPE "public"."time_regulation_violation_type" ADD VALUE IF NOT EXISTS 'jarbschg_sunday_work';--> statement-breakpoint
ALTER TYPE "public"."time_regulation_violation_type" ADD VALUE IF NOT EXISTS 'jarbschg_holiday_work';--> statement-breakpoint
ALTER TYPE "public"."time_regulation_violation_type" ADD VALUE IF NOT EXISTS 'jarbschg_holiday_prohibited';--> statement-breakpoint
-- An exam day records when the exam starts; its `school_minutes` hold the participation time
-- including breaks, credited instead of a full day (§ 10 Abs. 2 Nr. 1 JArbSchG, § 15 Abs. 2 Nr. 4 BBiG).
ALTER TABLE "employee_apprentice_release" ADD COLUMN IF NOT EXISTS "exam_start_time" time;--> statement-breakpoint
ALTER TABLE "employee_apprentice_release" ADD CONSTRAINT "employee_apprentice_release_exam_time_check" CHECK ("exam_start_time" IS NULL OR ("release_kind" = 'exam_day' AND "school_minutes" IS NOT NULL));--> statement-breakpoint
-- A pre-exam day records the exam it was released for, and a release voided to make room for it
-- records the same exam: voiding the exam voids its pre-exam day and restores what it replaced.
ALTER TABLE "employee_apprentice_release" ADD COLUMN IF NOT EXISTS "exam_release_id" uuid;--> statement-breakpoint
ALTER TABLE "employee_apprentice_release" ADD CONSTRAINT "employee_apprentice_release_exam_release_fk" FOREIGN KEY ("exam_release_id") REFERENCES "public"."employee_apprentice_release"("id");--> statement-breakpoint
ALTER TABLE "employee_apprentice_release" ADD CONSTRAINT "employee_apprentice_release_exam_link_check" CHECK ("exam_release_id" IS NULL OR "release_kind" <> 'exam_day');--> statement-breakpoint
-- A pre-exam day is released in full on top of a block that credits it only partly (§ 15 Abs. 1
-- Satz 2 Nr. 5 BBiG, § 10 Abs. 1 Nr. 2 JArbSchG). Same definition as 0329, for databases that
-- applied 0329 before it allowed that overlap; a no-op otherwise.
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'employee_apprentice_release_no_overlap'
			AND pg_get_constraintdef(oid) LIKE '%pre_exam_day%'
	) THEN
		ALTER TABLE "employee_apprentice_release"
			DROP CONSTRAINT IF EXISTS "employee_apprentice_release_no_overlap";
		ALTER TABLE "employee_apprentice_release"
			ADD CONSTRAINT "employee_apprentice_release_no_overlap"
			EXCLUDE USING gist (
				"organization_id" WITH =,
				"employee_id" WITH =,
				daterange("starts_on", "ends_on", '[]') WITH &&
			) WHERE ("voided_at" IS NULL AND "release_kind" <> 'pre_exam_day');
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'employee_apprentice_release_pre_exam_no_overlap'
	) THEN
		ALTER TABLE "employee_apprentice_release"
			ADD CONSTRAINT "employee_apprentice_release_pre_exam_no_overlap"
			EXCLUDE USING gist (
				"organization_id" WITH =,
				"employee_id" WITH =,
				daterange("starts_on", "ends_on", '[]') WITH &&
			) WHERE ("voided_at" IS NULL AND "release_kind" <> 'vocational_school_block_week');
	END IF;
END $$;
