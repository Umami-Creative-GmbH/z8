-- #1993: JArbSchG youth-protection violations recorded by the clock-out compliance check.
-- Additive enum values only; existing ArbZG violation rows are untouched.
ALTER TYPE "public"."time_regulation_violation_type" ADD VALUE IF NOT EXISTS 'jarbschg_daily_max';--> statement-breakpoint
ALTER TYPE "public"."time_regulation_violation_type" ADD VALUE IF NOT EXISTS 'jarbschg_weekly_max';--> statement-breakpoint
ALTER TYPE "public"."time_regulation_violation_type" ADD VALUE IF NOT EXISTS 'jarbschg_days_per_week';--> statement-breakpoint
ALTER TYPE "public"."time_regulation_violation_type" ADD VALUE IF NOT EXISTS 'jarbschg_rest_period';--> statement-breakpoint
ALTER TYPE "public"."time_regulation_violation_type" ADD VALUE IF NOT EXISTS 'jarbschg_uninterrupted';--> statement-breakpoint
ALTER TYPE "public"."time_regulation_violation_type" ADD VALUE IF NOT EXISTS 'jarbschg_break';--> statement-breakpoint
ALTER TYPE "public"."time_regulation_violation_type" ADD VALUE IF NOT EXISTS 'jarbschg_night_work';--> statement-breakpoint
ALTER TYPE "public"."time_regulation_violation_type" ADD VALUE IF NOT EXISTS 'jarbschg_saturday_work';--> statement-breakpoint
ALTER TYPE "public"."time_regulation_violation_type" ADD VALUE IF NOT EXISTS 'jarbschg_sunday_work';--> statement-breakpoint
ALTER TYPE "public"."time_regulation_violation_type" ADD VALUE IF NOT EXISTS 'jarbschg_holiday_work';
