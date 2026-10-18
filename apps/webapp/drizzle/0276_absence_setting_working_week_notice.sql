-- One-time working-week notice (#990, Absences ADR 0003): after allowances convert to each
-- employee's working days per week, owners and admins see whose 2026 allowance decreases. The list
-- is worked out at read time; only its dismissal is stored, once for the whole organization.
ALTER TABLE "absence_setting" ADD COLUMN IF NOT EXISTS "working_week_notice_dismissed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "absence_setting" ADD COLUMN IF NOT EXISTS "working_week_notice_dismissed_by" text;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "absence_setting" ADD CONSTRAINT "absence_setting_working_week_notice_dismissed_by_user_id_fk" FOREIGN KEY ("working_week_notice_dismissed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
