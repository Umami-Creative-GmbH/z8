-- Personnel file expiry reminders (#869). Notification types for the upcoming
-- and expired-today reminders; added enum values are not used in this
-- migration.
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'personnel_file_expiry_upcoming';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'personnel_file_expired_today';--> statement-breakpoint
-- Expiry reminder settings per organization: the lead time in days. No row
-- means the default of 30 days.
CREATE TABLE "personnel_file_reminder_setting" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"expiry_lead_days" integer DEFAULT 30 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "personnel_file_reminder_setting_lead_days_check" CHECK ("personnel_file_reminder_setting"."expiry_lead_days" BETWEEN 1 AND 365)
);
--> statement-breakpoint
-- Sent markers of the expiry reminder job: one per document, kind and expiry
-- date, claimed before notifying so a reminder is sent at most once.
CREATE TABLE "personnel_file_expiry_reminder" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"document_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"expiry_date" date NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personnel_file_expiry_reminder_kind_check" CHECK ("personnel_file_expiry_reminder"."kind" IN ('upcoming', 'expired_today'))
);
--> statement-breakpoint
ALTER TABLE "personnel_file_reminder_setting" ADD CONSTRAINT "personnel_file_reminder_setting_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personnel_file_reminder_setting" ADD CONSTRAINT "personnel_file_reminder_setting_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personnel_file_expiry_reminder" ADD CONSTRAINT "personnel_file_expiry_reminder_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personnel_file_expiry_reminder" ADD CONSTRAINT "personnel_file_expiry_reminder_document_fk" FOREIGN KEY ("document_id","organization_id") REFERENCES "public"."employee_document"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "personnelFileExpiryReminder_document_kind_expiry_idx" ON "personnel_file_expiry_reminder" USING btree ("document_id","kind","expiry_date");--> statement-breakpoint
CREATE INDEX "personnelFileExpiryReminder_organizationId_idx" ON "personnel_file_expiry_reminder" USING btree ("organization_id");
