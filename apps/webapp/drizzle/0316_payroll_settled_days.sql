-- #1896 (spec #1891, payroll-export ADR 0004): settled days, their append-only
-- history, the employee-days a payroll file carried (#1899) and the export job's
-- left-out count and include flag (#1898).
CREATE TABLE IF NOT EXISTS "payroll_settled_day" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
	"employee_id" uuid NOT NULL REFERENCES "employee"("id") ON DELETE CASCADE,
	"date" date NOT NULL,
	"timezone" text NOT NULL,
	"credited_minutes" integer NOT NULL,
	"absences" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"method" text NOT NULL,
	"payroll_export_job_id" uuid REFERENCES "payroll_export_job"("id") ON DELETE SET NULL,
	"settled_by" text REFERENCES "user"("id") ON DELETE SET NULL,
	"settled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unsettled_by" text REFERENCES "user"("id") ON DELETE SET NULL,
	"unsettled_at" timestamp with time zone,
	"unsettle_reason" text,
	CONSTRAINT "payroll_settled_day_method_check" CHECK ("method" IN ('manual', 'export')),
	CONSTRAINT "payroll_settled_day_minutes_check" CHECK ("credited_minutes" >= 0),
	CONSTRAINT "payroll_settled_day_unsettle_check" CHECK (("unsettled_at" IS NULL) = ("unsettle_reason" IS NULL)
		AND ("unsettle_reason" IS NULL OR length(btrim("unsettle_reason")) > 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payrollSettledDay_org_employee_date_active_idx" ON "payroll_settled_day" USING btree ("organization_id", "employee_id", "date") WHERE "unsettled_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payrollSettledDay_org_employee_date_idx" ON "payroll_settled_day" USING btree ("organization_id", "employee_id", "date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payrollSettledDay_payrollExportJobId_idx" ON "payroll_settled_day" USING btree ("payroll_export_job_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payroll_settled_day_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
	"settled_day_id" uuid NOT NULL REFERENCES "payroll_settled_day"("id") ON DELETE CASCADE,
	"employee_id" uuid NOT NULL REFERENCES "employee"("id") ON DELETE CASCADE,
	"date" date NOT NULL,
	"kind" text NOT NULL,
	"method" text NOT NULL,
	"payroll_export_job_id" uuid REFERENCES "payroll_export_job"("id") ON DELETE SET NULL,
	"actor_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	CONSTRAINT "payroll_settled_day_event_kind_check" CHECK ("kind" IN ('settled', 'unsettled')),
	CONSTRAINT "payroll_settled_day_event_method_check" CHECK ("method" IN ('manual', 'export')),
	CONSTRAINT "payroll_settled_day_event_reason_check" CHECK (("kind" = 'unsettled') = ("reason" IS NOT NULL)
		AND ("reason" IS NULL OR length(btrim("reason")) > 0))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payrollSettledDayEvent_org_employee_date_idx" ON "payroll_settled_day_event" USING btree ("organization_id", "employee_id", "date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payrollSettledDayEvent_settledDayId_idx" ON "payroll_settled_day_event" USING btree ("settled_day_id");
--> statement-breakpoint
-- The history is append-only. Deletes stay possible so organization and employee
-- deletion can cascade.
CREATE OR REPLACE FUNCTION "payroll_settled_day_event_reject_update"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'payroll settled day history is append-only'
		USING ERRCODE = 'integrity_constraint_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "payroll_settled_day_event_append_only" ON "payroll_settled_day_event";
--> statement-breakpoint
CREATE TRIGGER "payroll_settled_day_event_append_only" BEFORE UPDATE ON "payroll_settled_day_event" FOR EACH ROW EXECUTE FUNCTION "payroll_settled_day_event_reject_update"();
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payroll_export_carried_day" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
	"job_id" uuid NOT NULL REFERENCES "payroll_export_job"("id") ON DELETE CASCADE,
	"employee_id" uuid NOT NULL REFERENCES "employee"("id") ON DELETE CASCADE,
	"date" date NOT NULL,
	"timezone" text NOT NULL,
	"credited_minutes" integer NOT NULL,
	"absences" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "payroll_export_carried_day_minutes_check" CHECK ("credited_minutes" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payrollExportCarriedDay_job_employee_date_idx" ON "payroll_export_carried_day" USING btree ("job_id", "employee_id", "date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payrollExportCarriedDay_organizationId_idx" ON "payroll_export_carried_day" USING btree ("organization_id");
--> statement-breakpoint
ALTER TABLE "payroll_export_job" ADD COLUMN IF NOT EXISTS "settled_days_left_out" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "payroll_export_job" ADD COLUMN IF NOT EXISTS "includes_settled_days" boolean DEFAULT false NOT NULL;
