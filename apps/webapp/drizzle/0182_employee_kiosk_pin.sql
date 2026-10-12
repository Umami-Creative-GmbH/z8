-- #857: an employee's kiosk PIN. Only a slow hash is stored; the per-employee
-- lockout (5 consecutive failures across all kiosks lock for 15 minutes) lives
-- here because the rate limiter fails open. One PIN per employee, and an
-- employee belongs to one organization.
CREATE TABLE IF NOT EXISTS "employee_kiosk_pin" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"pin_hash" text NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"set_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_kiosk_pin_failed_attempts_check" CHECK ("employee_kiosk_pin"."failed_attempts" >= 0)
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "employee_kiosk_pin" ADD CONSTRAINT "employee_kiosk_pin_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "employee_kiosk_pin" ADD CONSTRAINT "employee_kiosk_pin_set_by_user_id_user_id_fk" FOREIGN KEY ("set_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "employee_kiosk_pin" ADD CONSTRAINT "employee_kiosk_pin_employee_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "employeeKioskPin_employee_idx" ON "employee_kiosk_pin" USING btree ("employee_id");
