CREATE TABLE IF NOT EXISTS "payroll_blocker_dismissal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"blocker_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"dismissed_by_employee_id" uuid NOT NULL,
	"dismissed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payrollBlockerDismissal_org_type_source_unique_idx" UNIQUE ("organization_id","blocker_type","source_id"),
	CONSTRAINT "payroll_blocker_dismissal_blocker_type_check" CHECK ("blocker_type" IN ('missing_clock_out', 'pending_absence', 'pending_time_correction'))
);

DO $$ BEGIN
	ALTER TABLE "payroll_blocker_dismissal" ADD CONSTRAINT "payroll_blocker_dismissal_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "payroll_blocker_dismissal" ADD CONSTRAINT "payroll_blocker_dismissal_employee_org_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
	ALTER TABLE "payroll_blocker_dismissal" ADD CONSTRAINT "payroll_blocker_dismissal_dismissed_by_employee_org_fk" FOREIGN KEY ("dismissed_by_employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "payrollBlockerDismissal_org_employee_idx" ON "payroll_blocker_dismissal" USING btree ("organization_id", "employee_id");
CREATE INDEX IF NOT EXISTS "payrollBlockerDismissal_dismissedByEmployeeId_idx" ON "payroll_blocker_dismissal" USING btree ("dismissed_by_employee_id");
