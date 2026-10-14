-- Skill expiry reminders (#1143). Notification types for the "expires soon"
-- and "expires today" reminders; added enum values are not used in this
-- migration.
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'skill_expiry_upcoming';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'skill_expired_today';--> statement-breakpoint
-- Skill reminder settings per organization: the lead time in days. No row
-- means the default of 30 days. Separate from the personnel file setting.
CREATE TABLE "skill_reminder_setting" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"expiry_lead_days" integer DEFAULT 30 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "skill_reminder_setting_lead_days_check" CHECK ("skill_reminder_setting"."expiry_lead_days" BETWEEN 1 AND 365)
);
--> statement-breakpoint
-- Sent markers of the skill expiry reminder job: one per employee skill, kind
-- and skill expiry date, claimed before notifying so a reminder is sent at
-- most once. Scoped to the organization through the employee.
CREATE TABLE "skill_expiry_reminder" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"employee_skill_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"expiry_date" date NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_expiry_reminder_kind_check" CHECK ("skill_expiry_reminder"."kind" IN ('upcoming', 'expired_today'))
);
--> statement-breakpoint
ALTER TABLE "skill_reminder_setting" ADD CONSTRAINT "skill_reminder_setting_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_reminder_setting" ADD CONSTRAINT "skill_reminder_setting_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_expiry_reminder" ADD CONSTRAINT "skill_expiry_reminder_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_expiry_reminder" ADD CONSTRAINT "skill_expiry_reminder_employee_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_expiry_reminder" ADD CONSTRAINT "skill_expiry_reminder_employee_skill_fk" FOREIGN KEY ("employee_skill_id","employee_id") REFERENCES "public"."employee_skill"("id","employee_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "skillExpiryReminder_employeeSkill_kind_expiry_idx" ON "skill_expiry_reminder" USING btree ("employee_skill_id","kind","expiry_date");--> statement-breakpoint
CREATE INDEX "skillExpiryReminder_organizationId_idx" ON "skill_expiry_reminder" USING btree ("organization_id");
