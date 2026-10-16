-- #1288: the kiosk PIN lockout is replayed from stored events, so attempts that reach Z8 late
-- (offline kiosk clocking, ADR 0011) are judged as the lockout stood when they happened. The
-- counter and lock columns on employee_kiosk_pin go; their current state becomes events: an
-- active lock as five failures at its start, a running count as that many failures now.
CREATE TABLE IF NOT EXISTS "employee_kiosk_pin_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sequence" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"offline" boolean DEFAULT false NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_kiosk_pin_event_kind_check" CHECK ("kind" in ('failure', 'success', 'cleared')),
	CONSTRAINT "employee_kiosk_pin_event_offline_check" CHECK ("kind" <> 'cleared' or not "offline")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "employee_kiosk_pin_event" ADD CONSTRAINT "employee_kiosk_pin_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "employee_kiosk_pin_event" ADD CONSTRAINT "employee_kiosk_pin_event_employee_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employeeKioskPinEvent_employee_occurredAt_idx" ON "employee_kiosk_pin_event" USING btree ("employee_id","occurred_at","sequence");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employeeKioskPinEvent_occurredAt_idx" ON "employee_kiosk_pin_event" USING btree ("occurred_at");
--> statement-breakpoint
INSERT INTO "employee_kiosk_pin_event" ("organization_id", "employee_id", "kind", "occurred_at")
SELECT "organization_id", "employee_id", 'failure', "locked_until" - interval '15 minutes'
FROM "employee_kiosk_pin", generate_series(1, 5)
WHERE "locked_until" > now();
--> statement-breakpoint
INSERT INTO "employee_kiosk_pin_event" ("organization_id", "employee_id", "kind", "occurred_at")
SELECT "organization_id", "employee_id", 'failure', now()
FROM "employee_kiosk_pin", generate_series(1, "failed_attempts")
WHERE "failed_attempts" > 0;
--> statement-breakpoint
ALTER TABLE "employee_kiosk_pin" DROP CONSTRAINT IF EXISTS "employee_kiosk_pin_failed_attempts_check";
--> statement-breakpoint
ALTER TABLE "employee_kiosk_pin" DROP COLUMN IF EXISTS "failed_attempts";
--> statement-breakpoint
ALTER TABLE "employee_kiosk_pin" DROP COLUMN IF EXISTS "locked_until";
