-- Personnel file officer grants (#866, Personnel File ADR 0001): the only way
-- for someone who is not an owner or admin to see and manage other employees'
-- documents. Scoped like payroll access and expense officer grants (all
-- employees, or named employees plus the current members of named teams) and
-- to a non-empty set of document categories. At most one active grant per
-- officer; a revoked grant stays inactive.
CREATE TABLE "personnel_file_officer_grant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"officer_employee_id" uuid NOT NULL,
	"scope" text DEFAULT 'specific' NOT NULL,
	"categories" text[] NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "personnelFileOfficerGrant_id_organizationId_idx" UNIQUE("id","organization_id"),
	CONSTRAINT "personnel_file_officer_grant_scope_check" CHECK ("personnel_file_officer_grant"."scope" IN ('all', 'specific')),
	CONSTRAINT "personnel_file_officer_grant_categories_check" CHECK (cardinality("personnel_file_officer_grant"."categories") > 0
			AND "personnel_file_officer_grant"."categories" <@ ARRAY['contract', 'payslip', 'certificate', 'sick_note', 'other']::text[])
);
--> statement-breakpoint
CREATE TABLE "personnel_file_officer_team" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"grant_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personnel_file_officer_employee" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"grant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "personnel_file_officer_grant" ADD CONSTRAINT "personnel_file_officer_grant_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personnel_file_officer_grant" ADD CONSTRAINT "personnel_file_officer_grant_officer_fk" FOREIGN KEY ("officer_employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personnel_file_officer_grant" ADD CONSTRAINT "personnel_file_officer_grant_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personnel_file_officer_grant" ADD CONSTRAINT "personnel_file_officer_grant_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personnel_file_officer_team" ADD CONSTRAINT "personnel_file_officer_team_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personnel_file_officer_team" ADD CONSTRAINT "personnel_file_officer_team_grant_fk" FOREIGN KEY ("grant_id","organization_id") REFERENCES "public"."personnel_file_officer_grant"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personnel_file_officer_team" ADD CONSTRAINT "personnel_file_officer_team_team_fk" FOREIGN KEY ("team_id","organization_id") REFERENCES "public"."team"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personnel_file_officer_team" ADD CONSTRAINT "personnel_file_officer_team_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personnel_file_officer_employee" ADD CONSTRAINT "personnel_file_officer_employee_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personnel_file_officer_employee" ADD CONSTRAINT "personnel_file_officer_employee_grant_fk" FOREIGN KEY ("grant_id","organization_id") REFERENCES "public"."personnel_file_officer_grant"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personnel_file_officer_employee" ADD CONSTRAINT "personnel_file_officer_employee_employee_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personnel_file_officer_employee" ADD CONSTRAINT "personnel_file_officer_employee_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "personnelFileOfficerGrant_organizationId_idx" ON "personnel_file_officer_grant" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "personnelFileOfficerGrant_officerEmployeeId_idx" ON "personnel_file_officer_grant" USING btree ("officer_employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "personnelFileOfficerGrant_active_officer_idx" ON "personnel_file_officer_grant" USING btree ("organization_id","officer_employee_id") WHERE is_active = true;--> statement-breakpoint
CREATE INDEX "personnelFileOfficerTeam_organizationId_idx" ON "personnel_file_officer_team" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "personnelFileOfficerTeam_teamId_idx" ON "personnel_file_officer_team" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "personnelFileOfficerTeam_grant_team_idx" ON "personnel_file_officer_team" USING btree ("grant_id","team_id");--> statement-breakpoint
CREATE INDEX "personnelFileOfficerEmployee_organizationId_idx" ON "personnel_file_officer_employee" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "personnelFileOfficerEmployee_employeeId_idx" ON "personnel_file_officer_employee" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "personnelFileOfficerEmployee_grant_employee_idx" ON "personnel_file_officer_employee" USING btree ("grant_id","employee_id");
