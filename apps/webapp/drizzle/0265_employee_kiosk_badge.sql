-- #1364 (spec #889, ADR 0013): an employee's kiosk badge. Only the SHA-256 of
-- the credential is stored, so a badge cannot be shown or downloaded again.
-- At most one active badge per employee, no expiry; revoked rows stay as
-- lifecycle history. Bound to the employment period it was issued in, so a
-- rehire never revives it.
CREATE TABLE IF NOT EXISTS "employee_kiosk_badge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"employment_period_id" uuid NOT NULL,
	"credential_hash" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"issued_by_user_id" text,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" text,
	"revoked_reason" text,
	CONSTRAINT "employee_kiosk_badge_revoked_reason_check" CHECK ("employee_kiosk_badge"."revoked_reason" in ('replaced', 'revoked', 'employee_departure')),
	CONSTRAINT "employee_kiosk_badge_revocation_check" CHECK (("employee_kiosk_badge"."revoked_at" IS NULL) = ("employee_kiosk_badge"."revoked_reason" IS NULL))
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "employee_kiosk_badge" ADD CONSTRAINT "employee_kiosk_badge_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "employee_kiosk_badge" ADD CONSTRAINT "employee_kiosk_badge_issued_by_user_id_user_id_fk" FOREIGN KEY ("issued_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "employee_kiosk_badge" ADD CONSTRAINT "employee_kiosk_badge_revoked_by_user_id_user_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "employee_kiosk_badge" ADD CONSTRAINT "employee_kiosk_badge_employee_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "employee_kiosk_badge" ADD CONSTRAINT "employee_kiosk_badge_period_fk" FOREIGN KEY ("employment_period_id","organization_id","employee_id") REFERENCES "public"."employee_employment_period"("id","organization_id","employee_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "employeeKioskBadge_credentialHash_idx" ON "employee_kiosk_badge" USING btree ("credential_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "employeeKioskBadge_one_active_idx" ON "employee_kiosk_badge" USING btree ("organization_id","employee_id") WHERE "employee_kiosk_badge"."revoked_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employeeKioskBadge_employee_idx" ON "employee_kiosk_badge" USING btree ("employee_id","issued_at");
