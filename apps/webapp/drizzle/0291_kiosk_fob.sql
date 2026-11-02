-- #1505 (spec #1358, Time Tracking ADR 0014): kiosk fobs. A per-kiosk "NFC fob reader" switch,
-- off by default (existing kiosks migrate to off), independent of the badge scanner and camera.
-- An employee's kiosk fob: the chip serial number (canonical upper-case hex of 4, 7 or 10 bytes)
-- selects the employee at an online kiosk; the kiosk PIN still proves. At most one active link
-- per employee, a serial number linked to at most one employee per organization at a time (the
-- same serial may exist in another organization). Bound to the employment period it was
-- registered in, so a rehire never revives it. Ended rows stay as lifecycle history.
ALTER TABLE "kiosk" ADD COLUMN IF NOT EXISTS "nfc_fob_reader_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "employee_kiosk_fob" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"employment_period_id" uuid NOT NULL,
	"serial_number" text NOT NULL,
	"registered_at" timestamp with time zone NOT NULL,
	"registered_kiosk_id" uuid,
	"ended_at" timestamp with time zone,
	"ended_by_user_id" text,
	"ended_reason" text,
	CONSTRAINT "employee_kiosk_fob_serial_number_check" CHECK ("employee_kiosk_fob"."serial_number" ~ '^([0-9A-F]{8}|[0-9A-F]{14}|[0-9A-F]{20})$'),
	CONSTRAINT "employee_kiosk_fob_ended_reason_check" CHECK ("employee_kiosk_fob"."ended_reason" in ('replaced', 'removed', 'departure')),
	CONSTRAINT "employee_kiosk_fob_ending_check" CHECK (("employee_kiosk_fob"."ended_at" IS NULL) = ("employee_kiosk_fob"."ended_reason" IS NULL))
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "employee_kiosk_fob" ADD CONSTRAINT "employee_kiosk_fob_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "employee_kiosk_fob" ADD CONSTRAINT "employee_kiosk_fob_registered_kiosk_id_kiosk_id_fk" FOREIGN KEY ("registered_kiosk_id") REFERENCES "public"."kiosk"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "employee_kiosk_fob" ADD CONSTRAINT "employee_kiosk_fob_ended_by_user_id_user_id_fk" FOREIGN KEY ("ended_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "employee_kiosk_fob" ADD CONSTRAINT "employee_kiosk_fob_employee_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "employee_kiosk_fob" ADD CONSTRAINT "employee_kiosk_fob_period_fk" FOREIGN KEY ("employment_period_id","organization_id","employee_id") REFERENCES "public"."employee_employment_period"("id","organization_id","employee_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "employeeKioskFob_active_serial_idx" ON "employee_kiosk_fob" USING btree ("organization_id","serial_number") WHERE "employee_kiosk_fob"."ended_at" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "employeeKioskFob_one_active_idx" ON "employee_kiosk_fob" USING btree ("organization_id","employee_id") WHERE "employee_kiosk_fob"."ended_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employeeKioskFob_employee_idx" ON "employee_kiosk_fob" USING btree ("employee_id","registered_at");
