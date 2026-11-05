ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'equipment_return_reminder';
--> statement-breakpoint
CREATE TABLE "equipment_reminder_delivery" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
 "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
 "assignment_id" uuid NOT NULL,
 "deadline" date NOT NULL,
 "timezone" text NOT NULL,
 "occasion_date" date NOT NULL,
 "audience" text NOT NULL,
 "recipient_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
 "channel" "notification_channel" NOT NULL,
 "state" text DEFAULT 'pending' NOT NULL,
 "created_at" timestamp with time zone NOT NULL,
 "sent_at" timestamp with time zone,
 CONSTRAINT "equipment_reminder_assignment_org_fk" FOREIGN KEY ("assignment_id", "organization_id") REFERENCES "equipment_assignment"("id", "organization_id") ON DELETE CASCADE,
 CONSTRAINT "equipment_reminder_occasion_channel_unique" UNIQUE ("organization_id", "assignment_id", "deadline", "timezone", "occasion_date", "audience", "recipient_user_id", "channel"),
 CONSTRAINT "equipment_reminder_audience_check" CHECK ("audience" IN ('employee', 'staff')),
 CONSTRAINT "equipment_reminder_state_check" CHECK ("state" IN ('pending', 'attempted', 'sent', 'suppressed', 'obsolete', 'unavailable'))
);
