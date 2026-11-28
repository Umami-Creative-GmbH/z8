-- #2069 (spec #2068): the email side of the mandatory "personal details changed"
-- notice, recorded with the change and retried until sent, so it is never lost.
CREATE TABLE IF NOT EXISTS "personal_details_changed_email" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"recipient_user_id" text NOT NULL,
	"change_id" uuid NOT NULL,
	"notice" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "personalDetailsChangedEmail_change_unique" UNIQUE("change_id"),
	CONSTRAINT "personalDetailsChangedEmail_status_check" CHECK ("status" IN ('pending', 'sent', 'unavailable'))
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "personal_details_changed_email" ADD CONSTRAINT "personal_details_changed_email_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "personal_details_changed_email" ADD CONSTRAINT "personal_details_changed_email_recipient_user_id_user_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "personal_details_changed_email" ADD CONSTRAINT "personalDetailsChangedEmail_employee_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "personalDetailsChangedEmail_due_idx" ON "personal_details_changed_email" USING btree ("available_at") WHERE "personal_details_changed_email"."status" = 'pending';
