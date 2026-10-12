-- Deputy notifications (#1013, spec #802): named, removed, new dates and the
-- day-before reminder. Added enum values are not used in this migration.
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'absence_deputy_assigned';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'absence_deputy_removed';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'absence_deputy_dates_changed';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'absence_deputy_reminder';--> statement-breakpoint
-- Sent markers of the day-before reminder: one per absence, deputy and start
-- date, claimed before notifying so the reminder is sent at most once, even
-- with in-app notifications off. A moved start date arms it again.
CREATE TABLE IF NOT EXISTS "absence_deputy_reminder" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"absence_id" uuid NOT NULL,
	"deputy_employee_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "absence_deputy_reminder" ADD CONSTRAINT "absence_deputy_reminder_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absence_deputy_reminder" ADD CONSTRAINT "absence_deputy_reminder_absence_fk" FOREIGN KEY ("absence_id","organization_id") REFERENCES "public"."absence_entry"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absence_deputy_reminder" ADD CONSTRAINT "absence_deputy_reminder_deputy_fk" FOREIGN KEY ("deputy_employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "absenceDeputyReminder_absence_deputy_start_idx" ON "absence_deputy_reminder" USING btree ("organization_id","absence_id","deputy_employee_id","start_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "absenceDeputyReminder_organizationId_idx" ON "absence_deputy_reminder" USING btree ("organization_id");
