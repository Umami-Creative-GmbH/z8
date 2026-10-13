-- One-time proration notice (#1112): after proration ships, owners and admins see the employees
-- whose 2026 allowance is now prorated. The list is worked out at read time; only its dismissal is
-- stored, once for the whole organization, on the organization's absence settings row.
ALTER TABLE "absence_setting" ADD COLUMN IF NOT EXISTS "proration_notice_dismissed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "absence_setting" ADD COLUMN IF NOT EXISTS "proration_notice_dismissed_by" text;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "absence_setting" ADD CONSTRAINT "absence_setting_proration_notice_dismissed_by_user_id_fk" FOREIGN KEY ("proration_notice_dismissed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
