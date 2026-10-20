-- #1423 (spec #1418, Organization ADR 0005): intended drivers are assigned by organization,
-- team or employee (Required / Not required), like vehicle use. Every existing enrollment
-- becomes an employee-level Required assignment that keeps who added it and when, so nobody's
-- status changes. driving_licence_participant stays until #1424 drops it.
CREATE TABLE IF NOT EXISTS "driving_licence_intended_driver_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"assignment_type" "holiday_preset_assignment_type" NOT NULL,
	"team_id" uuid,
	"employee_id" uuid,
	"priority" integer DEFAULT 0 NOT NULL,
	"required" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "driving_intended_driver_target_check" CHECK (("driving_licence_intended_driver_assignment"."assignment_type" = 'organization' and "driving_licence_intended_driver_assignment"."team_id" is null and "driving_licence_intended_driver_assignment"."employee_id" is null and "driving_licence_intended_driver_assignment"."priority" = 0)
			or ("driving_licence_intended_driver_assignment"."assignment_type" = 'team' and "driving_licence_intended_driver_assignment"."team_id" is not null and "driving_licence_intended_driver_assignment"."employee_id" is null and "driving_licence_intended_driver_assignment"."priority" = 1)
			or ("driving_licence_intended_driver_assignment"."assignment_type" = 'employee' and "driving_licence_intended_driver_assignment"."employee_id" is not null and "driving_licence_intended_driver_assignment"."team_id" is null and "driving_licence_intended_driver_assignment"."priority" = 2))
);--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "driving_licence_intended_driver_assignment" ADD CONSTRAINT "driving_licence_intended_driver_assignment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "driving_licence_intended_driver_assignment" ADD CONSTRAINT "driving_licence_intended_driver_assignment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "driving_licence_intended_driver_assignment" ADD CONSTRAINT "driving_licence_intended_driver_assignment_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "driving_licence_intended_driver_assignment" ADD CONSTRAINT "driving_intended_driver_team_fk" FOREIGN KEY ("team_id","organization_id") REFERENCES "public"."team"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "driving_licence_intended_driver_assignment" ADD CONSTRAINT "driving_intended_driver_employee_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "driving_intended_driver_org_idx" ON "driving_licence_intended_driver_assignment" USING btree ("organization_id") WHERE assignment_type = 'organization';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "driving_intended_driver_team_idx" ON "driving_licence_intended_driver_assignment" USING btree ("organization_id","team_id") WHERE team_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "driving_intended_driver_employee_idx" ON "driving_licence_intended_driver_assignment" USING btree ("organization_id","employee_id") WHERE employee_id IS NOT NULL;--> statement-breakpoint
INSERT INTO "driving_licence_intended_driver_assignment"
	("organization_id", "assignment_type", "team_id", "employee_id", "priority", "required", "created_at", "created_by", "updated_at", "updated_by")
SELECT p."organization_id", 'employee', NULL, p."employee_id", 2, true, p."enrolled_at", p."enrolled_by", p."enrolled_at", p."enrolled_by"
FROM "driving_licence_participant" p
ON CONFLICT DO NOTHING;
