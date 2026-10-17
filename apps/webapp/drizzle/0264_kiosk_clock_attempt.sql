-- #1363 (spec #889): how an online kiosk clock attempt ended, once per kiosk and operation.
-- Clocking writes `committed` inside the action's own work transaction (both admissions); the
-- kiosk's outcome lookup writes `not_recorded` when nothing is recorded yet, which closes the
-- operation: a late original request finds the row and rolls back. Holds no PIN, badge or command.
CREATE TABLE IF NOT EXISTS "kiosk_clock_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"kiosk_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"state" text NOT NULL,
	"employee_id" uuid,
	"action" text,
	"event_at" timestamp with time zone,
	"event_zone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kiosk_clock_attempt_state_check" CHECK ("state" in ('committed', 'not_recorded')),
	CONSTRAINT "kiosk_clock_attempt_action_check" CHECK ("action" is null or "action" in ('clock_in', 'clock_out', 'break', 'start_break', 'resume_break')),
	CONSTRAINT "kiosk_clock_attempt_committed_check" CHECK ("state" <> 'committed' or ("employee_id" is not null and "action" is not null and "event_at" is not null and "event_zone" is not null))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kiosk_clock_attempt" ADD CONSTRAINT "kiosk_clock_attempt_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kiosk_clock_attempt" ADD CONSTRAINT "kiosk_clock_attempt_kiosk_fk" FOREIGN KEY ("kiosk_id","organization_id") REFERENCES "public"."kiosk"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kiosk_clock_attempt" ADD CONSTRAINT "kiosk_clock_attempt_employee_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "kioskClockAttempt_operation_idx" ON "kiosk_clock_attempt" USING btree ("organization_id","kiosk_id","operation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kioskClockAttempt_employee_idx" ON "kiosk_clock_attempt" USING btree ("employee_id");
