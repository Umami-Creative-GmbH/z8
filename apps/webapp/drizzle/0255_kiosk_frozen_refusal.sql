-- #1290: frozen kiosk clock commands Z8 refused on arrival, kept once per kiosk and operation
-- (spec #885). A resend is answered from the record, the kiosk's lookup reads it, and owners and
-- admins see it in the kiosk settings. The employee, or a kiosk-only employee's managers, get a
-- kiosk_command_refused notification; `notified_at` stays null until that notification was handed
-- over, so a failed one is sent again when the kiosk asks about the command. An added enum value
-- is not usable in the transaction that adds it, so nothing below uses it.
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'kiosk_command_refused';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kiosk_frozen_refusal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"kiosk_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"employee_id" uuid,
	"action" text NOT NULL,
	"claimed_at" timestamp with time zone NOT NULL,
	"timezone" text NOT NULL,
	"time_source" text NOT NULL,
	"reason" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"command" jsonb NOT NULL,
	"refused_at" timestamp with time zone NOT NULL,
	"notified_at" timestamp with time zone,
	CONSTRAINT "kiosk_frozen_refusal_action_check" CHECK ("action" in ('clock_in', 'clock_out', 'start_break', 'resume_break')),
	CONSTRAINT "kiosk_frozen_refusal_time_source_check" CHECK ("time_source" in ('server_anchor', 'device_clock')),
	CONSTRAINT "kiosk_frozen_refusal_reason_check" CHECK ("reason" in ('kiosk_revoked', 'kiosk_rotated', 'contact_unverifiable', 'not_adopted', 'admission_window', 'clock_out_of_bounds', 'employee_not_assigned', 'pin_unsealable', 'no_pin', 'wrong_pin', 'pin_locked', 'already_clocked_in', 'occupancy_conflict', 'not_clocked_in', 'target_unknown', 'target_not_active', 'already_on_break', 'on_break', 'no_break_in_progress', 'invalid_interval', 'under_review', 'holiday_blocked', 'month_closed', 'append_review_required', 'billing_required', 'collision', 'access_denied', 'invalid_command'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kiosk_frozen_refusal" ADD CONSTRAINT "kiosk_frozen_refusal_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kiosk_frozen_refusal" ADD CONSTRAINT "kiosk_frozen_refusal_kiosk_fk" FOREIGN KEY ("kiosk_id","organization_id") REFERENCES "public"."kiosk"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kiosk_frozen_refusal" ADD CONSTRAINT "kiosk_frozen_refusal_employee_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "kioskFrozenRefusal_operation_idx" ON "kiosk_frozen_refusal" USING btree ("organization_id","kiosk_id","operation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kioskFrozenRefusal_organization_refusedAt_idx" ON "kiosk_frozen_refusal" USING btree ("organization_id","refused_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kioskFrozenRefusal_employee_idx" ON "kiosk_frozen_refusal" USING btree ("employee_id");
