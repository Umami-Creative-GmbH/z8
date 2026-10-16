ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'driving_licence_reminder';
--> statement-breakpoint
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'driving_authorization_suspended';
--> statement-breakpoint
CREATE TABLE "driving_licence_reminder_delivery" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
 "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
 "employee_id" uuid NOT NULL,
 "employment_period_id" uuid,
 "occasion_key" text NOT NULL,
 "recipient_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
 "notification_id" uuid,
 "email_state" text NOT NULL DEFAULT 'pending',
 "email_attempts" integer NOT NULL DEFAULT 0,
 "created_at" timestamp with time zone NOT NULL,
 "emailed_at" timestamp with time zone,
 CONSTRAINT "driving_reminder_recipient_occasion" UNIQUE ("organization_id","occasion_key","recipient_user_id"),
 CONSTRAINT "driving_reminder_subject" FOREIGN KEY ("employee_id","organization_id") REFERENCES "employee"("id","organization_id") ON DELETE CASCADE,
 CONSTRAINT "driving_reminder_email_state" CHECK ("email_state" IN ('pending','sent','suppressed','obsolete','unavailable'))
);

--> statement-breakpoint
CREATE INDEX driving_reminder_pending ON driving_licence_reminder_delivery (organization_id,email_state);

