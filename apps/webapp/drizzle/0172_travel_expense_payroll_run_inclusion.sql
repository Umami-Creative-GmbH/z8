-- #852: the reports a payroll run (a payroll file export job) carries, with the
-- lines and wage-type codes it froze. A report is included in at most one
-- unconfirmed run; the partial unique index enforces it and answers the
-- reimbursement paths' lock check.
CREATE TABLE IF NOT EXISTS "travel_expense_payroll_run_inclusion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"payroll_export_job_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"basis_revision_id" uuid NOT NULL,
	"lines" jsonb NOT NULL,
	"state" text DEFAULT 'included' NOT NULL,
	"included_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_by_user_id" text,
	"superseded_by_job_id" uuid,
	CONSTRAINT "travel_expense_payroll_run_inclusion_state_check" CHECK ("travel_expense_payroll_run_inclusion"."state" IN ('included', 'superseded', 'removed', 'discarded')),
	CONSTRAINT "travel_expense_payroll_run_inclusion_ended_check" CHECK (("travel_expense_payroll_run_inclusion"."state" = 'included') = ("travel_expense_payroll_run_inclusion"."ended_at" IS NULL)
			AND ("travel_expense_payroll_run_inclusion"."superseded_by_job_id" IS NULL OR "travel_expense_payroll_run_inclusion"."state" = 'superseded'))
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "travel_expense_payroll_run_inclusion" ADD CONSTRAINT "travel_expense_payroll_run_inclusion_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "travel_expense_payroll_run_inclusion" ADD CONSTRAINT "travel_expense_payroll_run_inclusion_payroll_export_job_id_payroll_export_job_id_fk" FOREIGN KEY ("payroll_export_job_id") REFERENCES "public"."payroll_export_job"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "travel_expense_payroll_run_inclusion" ADD CONSTRAINT "travel_expense_payroll_run_inclusion_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "travel_expense_payroll_run_inclusion" ADD CONSTRAINT "travel_expense_payroll_run_inclusion_superseded_by_job_id_payroll_export_job_id_fk" FOREIGN KEY ("superseded_by_job_id") REFERENCES "public"."payroll_export_job"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "travel_expense_payroll_run_inclusion" ADD CONSTRAINT "travel_expense_payroll_run_inclusion_report_fk" FOREIGN KEY ("report_id","organization_id") REFERENCES "public"."travel_expense_report"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "travelExpensePayrollRunInclusion_org_report_included_idx" ON "travel_expense_payroll_run_inclusion" USING btree ("organization_id","report_id") WHERE "travel_expense_payroll_run_inclusion"."state" = 'included';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "travelExpensePayrollRunInclusion_org_job_idx" ON "travel_expense_payroll_run_inclusion" USING btree ("organization_id","payroll_export_job_id");
