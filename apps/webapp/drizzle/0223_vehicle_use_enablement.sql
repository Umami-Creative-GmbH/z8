-- #1119 (spec #807, Time Tracking glossary "Driving"): the vehicle use organization switch (off by
-- default) and its organization/team/employee assignments, each in mode off, asked or expected.
CREATE TABLE IF NOT EXISTS "vehicle_use_setting" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "vehicleUseSetting_organizationId_idx" UNIQUE("organization_id")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vehicle_use_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"assignment_type" "holiday_preset_assignment_type" NOT NULL,
	"team_id" uuid,
	"employee_id" uuid,
	"priority" integer DEFAULT 0 NOT NULL,
	"mode" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_use_assignment_mode_check" CHECK ("vehicle_use_assignment"."mode" in ('off', 'asked', 'expected')),
	CONSTRAINT "vehicle_use_assignment_target_check" CHECK (("vehicle_use_assignment"."assignment_type" = 'organization' and "vehicle_use_assignment"."team_id" is null and "vehicle_use_assignment"."employee_id" is null and "vehicle_use_assignment"."priority" = 0)
			or ("vehicle_use_assignment"."assignment_type" = 'team' and "vehicle_use_assignment"."team_id" is not null and "vehicle_use_assignment"."employee_id" is null and "vehicle_use_assignment"."priority" = 1)
			or ("vehicle_use_assignment"."assignment_type" = 'employee' and "vehicle_use_assignment"."employee_id" is not null and "vehicle_use_assignment"."team_id" is null and "vehicle_use_assignment"."priority" = 2))
);--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "vehicle_use_setting" ADD CONSTRAINT "vehicle_use_setting_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "vehicle_use_setting" ADD CONSTRAINT "vehicle_use_setting_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "vehicle_use_assignment" ADD CONSTRAINT "vehicle_use_assignment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "vehicle_use_assignment" ADD CONSTRAINT "vehicle_use_assignment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "vehicle_use_assignment" ADD CONSTRAINT "vehicle_use_assignment_team_fk" FOREIGN KEY ("team_id","organization_id") REFERENCES "public"."team"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "vehicle_use_assignment" ADD CONSTRAINT "vehicle_use_assignment_employee_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vehicleUseAssignment_organizationId_idx" ON "vehicle_use_assignment" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vehicleUseAssignment_teamId_idx" ON "vehicle_use_assignment" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vehicleUseAssignment_employeeId_idx" ON "vehicle_use_assignment" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vehicleUseAssignment_org_idx" ON "vehicle_use_assignment" USING btree ("organization_id") WHERE assignment_type = 'organization';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vehicleUseAssignment_team_idx" ON "vehicle_use_assignment" USING btree ("organization_id","team_id") WHERE team_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vehicleUseAssignment_employee_idx" ON "vehicle_use_assignment" USING btree ("organization_id","employee_id") WHERE employee_id IS NOT NULL;
