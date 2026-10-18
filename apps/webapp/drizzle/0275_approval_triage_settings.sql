ALTER TABLE "approval_setting" ADD COLUMN "stale_after_hours" integer DEFAULT 72 NOT NULL;
--> statement-breakpoint
ALTER TABLE "approval_setting" ADD COLUMN "small_correction_minutes" integer DEFAULT 15 NOT NULL;
--> statement-breakpoint
ALTER TABLE "approval_setting" ADD CONSTRAINT "approval_setting_stale_after_hours_check" CHECK ("stale_after_hours" BETWEEN 1 AND 720);
--> statement-breakpoint
ALTER TABLE "approval_setting" ADD CONSTRAINT "approval_setting_small_correction_minutes_check" CHECK ("small_correction_minutes" BETWEEN 0 AND 60);
