-- #2070 (spec #2068): an employee's health insurance as a date-effective history per
-- organization. A statutory insurer picked from the bundled list keeps the name and
-- Betriebsnummer it had when picked.
CREATE TABLE IF NOT EXISTS "employee_health_insurance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"kind" text,
	"insurer_name" text,
	"insurer_betriebsnummer" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "employeeHealthInsurance_org_employee_valid_from_unique" UNIQUE("organization_id","employee_id","valid_from"),
	CONSTRAINT "employeeHealthInsurance_value_check" CHECK (("kind" IS NULL AND "insurer_name" IS NULL AND "insurer_betriebsnummer" IS NULL)
				OR ("kind" IS NOT NULL AND "kind" = 'statutory' AND "insurer_name" IS NOT NULL)
				OR ("kind" IS NOT NULL AND "kind" = 'private' AND "insurer_name" IS NOT NULL AND "insurer_betriebsnummer" IS NULL)),
	CONSTRAINT "employeeHealthInsurance_insurer_name_check" CHECK ("insurer_name" IS NULL OR char_length("insurer_name") BETWEEN 1 AND 120),
	CONSTRAINT "employeeHealthInsurance_betriebsnummer_check" CHECK ("insurer_betriebsnummer" IS NULL OR "insurer_betriebsnummer" ~ '^[0-9]{8}$')
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "employee_health_insurance" ADD CONSTRAINT "employee_health_insurance_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "employee_health_insurance" ADD CONSTRAINT "employee_health_insurance_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "employee_health_insurance" ADD CONSTRAINT "employee_health_insurance_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "employee_health_insurance" ADD CONSTRAINT "employeeHealthInsurance_employee_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
