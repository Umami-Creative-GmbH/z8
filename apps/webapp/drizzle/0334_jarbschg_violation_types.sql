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
-- including breaks, credited instead of a full day (§ 10 Abs. 1 Nr. 1 JArbSchG, § 15 BBiG).
ALTER TABLE "employee_apprentice_release" ADD COLUMN IF NOT EXISTS "exam_start_time" time;--> statement-breakpoint
ALTER TABLE "employee_apprentice_release" ADD CONSTRAINT "employee_apprentice_release_exam_time_check" CHECK ("exam_start_time" IS NULL OR ("release_kind" = 'exam_day' AND "school_minutes" IS NOT NULL));
