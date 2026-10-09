-- Clocking reminders: break-due reminder (#833).
-- An added enum value is not usable in the transaction that adds it, so
-- nothing below uses the new value.
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'break_due_reminder';
--> statement-breakpoint
-- Off by default; the reminder goes out this many minutes before the break is due.
ALTER TABLE "organization_clocking_reminder_settings" ADD COLUMN IF NOT EXISTS "break_due_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "organization_clocking_reminder_settings" ADD COLUMN IF NOT EXISTS "break_due_lead_minutes" integer DEFAULT 15 NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "organization_clocking_reminder_settings" ADD CONSTRAINT "organization_clocking_reminder_settings_break_due_lead_check" CHECK ("break_due_lead_minutes" BETWEEN 1 AND 1440);
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
