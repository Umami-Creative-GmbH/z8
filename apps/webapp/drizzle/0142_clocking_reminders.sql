-- Clocking reminders: missed clock-in and forgotten clock-out (#827).
-- An added enum value is not usable in the transaction that adds it, so
-- nothing below uses the new values (the occasion table only uses the type).
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'missed_clock_in_reminder';
--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'forgotten_clock_out_reminder';
--> statement-breakpoint
-- A missing settings row means every reminder is off.
CREATE TABLE IF NOT EXISTS "organization_clocking_reminder_settings" (
	"organization_id" text PRIMARY KEY NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
	"missed_clock_in_enabled" boolean DEFAULT false NOT NULL,
	"missed_clock_in_grace_minutes" integer DEFAULT 15 NOT NULL,
	"forgotten_clock_out_enabled" boolean DEFAULT false NOT NULL,
	"forgotten_clock_out_grace_minutes" integer DEFAULT 30 NOT NULL,
	"roles" "role"[] DEFAULT '{admin,manager,employee}'::role[] NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_clocking_reminder_settings_missed_grace_check" CHECK ("missed_clock_in_grace_minutes" BETWEEN 0 AND 1440),
	CONSTRAINT "organization_clocking_reminder_settings_forgotten_grace_check" CHECK ("forgotten_clock_out_grace_minutes" BETWEEN 0 AND 1440),
	CONSTRAINT "organization_clocking_reminder_settings_roles_check" CHECK (cardinality("roles") >= 1),
	CONSTRAINT "organization_clocking_reminder_settings_revision_check" CHECK ("revision" >= 1)
);
--> statement-breakpoint
-- One row per sent reminder occasion; the unique key is claimed before any channel is delivered.
CREATE TABLE IF NOT EXISTS "clocking_reminder_occasion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
	"employee_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"occasion_key" text NOT NULL,
	"expected_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	CONSTRAINT "clocking_reminder_occasion_employee_fk" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employee"("id", "organization_id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "clockingReminderOccasion_org_key_idx" ON "clocking_reminder_occasion" ("organization_id", "occasion_key");
