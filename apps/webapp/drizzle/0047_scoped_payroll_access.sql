CREATE TABLE IF NOT EXISTS "payroll_access_grant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"payroll_employee_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp NOT NULL,
	"updated_by" text
);

CREATE TABLE IF NOT EXISTS "payroll_access_team" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"grant_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "payroll_access_employee" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"grant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL
);

DO $$ BEGIN
	ALTER TABLE "payroll_access_grant" ADD CONSTRAINT "payroll_access_grant_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "payroll_access_grant" ADD CONSTRAINT "payroll_access_grant_payroll_employee_id_organization_id_employee_id_organization_id_fk" FOREIGN KEY ("payroll_employee_id", "organization_id") REFERENCES "employee"("id", "organization_id") ON DELETE CASCADE;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "payroll_access_grant" ADD CONSTRAINT "payroll_access_grant_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "user"("id");
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "payroll_access_grant" ADD CONSTRAINT "payroll_access_grant_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "user"("id");
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "payroll_access_grant" ADD CONSTRAINT "payrollAccessGrant_id_organizationId_idx" UNIQUE("id", "organization_id");
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "payroll_access_team" ADD CONSTRAINT "payroll_access_team_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "payroll_access_team" DROP CONSTRAINT IF EXISTS "payroll_access_team_grant_id_payroll_access_grant_id_fk";

DO $$ BEGIN
	ALTER TABLE "payroll_access_team" ADD CONSTRAINT "payroll_access_team_grant_id_organization_id_payroll_access_grant_id_organization_id_fk" FOREIGN KEY ("grant_id", "organization_id") REFERENCES "payroll_access_grant"("id", "organization_id") ON DELETE CASCADE;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "payroll_access_team" ADD CONSTRAINT "payroll_access_team_team_id_organization_id_team_id_organization_id_fk" FOREIGN KEY ("team_id", "organization_id") REFERENCES "team"("id", "organization_id") ON DELETE CASCADE;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "payroll_access_team" ADD CONSTRAINT "payroll_access_team_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "user"("id");
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "payroll_access_employee" ADD CONSTRAINT "payroll_access_employee_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "payroll_access_employee" DROP CONSTRAINT IF EXISTS "payroll_access_employee_grant_id_payroll_access_grant_id_fk";

DO $$ BEGIN
	ALTER TABLE "payroll_access_employee" ADD CONSTRAINT "payroll_access_employee_grant_id_organization_id_payroll_access_grant_id_organization_id_fk" FOREIGN KEY ("grant_id", "organization_id") REFERENCES "payroll_access_grant"("id", "organization_id") ON DELETE CASCADE;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "payroll_access_employee" ADD CONSTRAINT "payroll_access_employee_employee_id_organization_id_employee_id_organization_id_fk" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employee"("id", "organization_id") ON DELETE CASCADE;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "payroll_access_employee" ADD CONSTRAINT "payroll_access_employee_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "user"("id");
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "payrollAccessGrant_organizationId_idx" ON "payroll_access_grant" ("organization_id");
CREATE INDEX IF NOT EXISTS "payrollAccessGrant_payrollEmployeeId_idx" ON "payroll_access_grant" ("payroll_employee_id");
CREATE UNIQUE INDEX IF NOT EXISTS "payrollAccessGrant_active_employee_idx" ON "payroll_access_grant" ("organization_id", "payroll_employee_id") WHERE "is_active" = true;

CREATE INDEX IF NOT EXISTS "payrollAccessTeam_organizationId_idx" ON "payroll_access_team" ("organization_id");
CREATE INDEX IF NOT EXISTS "payrollAccessTeam_grantId_idx" ON "payroll_access_team" ("grant_id");
CREATE INDEX IF NOT EXISTS "payrollAccessTeam_teamId_idx" ON "payroll_access_team" ("team_id");
CREATE UNIQUE INDEX IF NOT EXISTS "payrollAccessTeam_grant_team_idx" ON "payroll_access_team" ("grant_id", "team_id");

CREATE INDEX IF NOT EXISTS "payrollAccessEmployee_organizationId_idx" ON "payroll_access_employee" ("organization_id");
CREATE INDEX IF NOT EXISTS "payrollAccessEmployee_grantId_idx" ON "payroll_access_employee" ("grant_id");
CREATE INDEX IF NOT EXISTS "payrollAccessEmployee_employeeId_idx" ON "payroll_access_employee" ("employee_id");
CREATE UNIQUE INDEX IF NOT EXISTS "payrollAccessEmployee_grant_employee_idx" ON "payroll_access_employee" ("grant_id", "employee_id");
