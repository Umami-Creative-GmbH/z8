-- #858: assigned locations, the locations an employee works at. Distinct from
-- location_employee (supervisors). The composite foreign keys tie employee and
-- location to the row's organization, so a cross-organization assignment is
-- refused by the database.
CREATE TABLE IF NOT EXISTS "employee_assigned_location" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "employee_assigned_location" ADD CONSTRAINT "employee_assigned_location_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "employee_assigned_location" ADD CONSTRAINT "employee_assigned_location_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "employee_assigned_location" ADD CONSTRAINT "employee_assigned_location_employee_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "employee_assigned_location" ADD CONSTRAINT "employee_assigned_location_location_fk" FOREIGN KEY ("location_id","organization_id") REFERENCES "public"."location"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "employeeAssignedLocation_employee_location_idx" ON "employee_assigned_location" USING btree ("employee_id","location_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employeeAssignedLocation_org_location_idx" ON "employee_assigned_location" USING btree ("organization_id","location_id");
