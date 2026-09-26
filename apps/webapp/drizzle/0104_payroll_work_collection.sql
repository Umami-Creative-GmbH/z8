-- #322: scoped payroll work collection with persisted immutable export input.
-- Additive and inactive: payroll consumers use the scoped collection only for
-- organizations whose control is active, and there is no application setter.
-- An export collected under the control stores its work input with the job
-- before delivery; recovery reuses it. The input cascades with its job and
-- organization and cannot be updated.
CREATE TABLE "payroll_work_collection_control" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"mode" text DEFAULT 'inactive' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_work_collection_control_mode_check" CHECK ("payroll_work_collection_control"."mode" IN ('inactive', 'active'))
);
--> statement-breakpoint
ALTER TABLE "payroll_work_collection_control" ADD CONSTRAINT "payroll_work_collection_control_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "payroll_export_work_input" (
	"job_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"version" integer NOT NULL,
	"digest" text NOT NULL,
	"work_count" integer NOT NULL,
	"input" jsonb NOT NULL,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payroll_export_work_input" ADD CONSTRAINT "payroll_export_work_input_job_id_payroll_export_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."payroll_export_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_export_work_input" ADD CONSTRAINT "payroll_export_work_input_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payrollExportWorkInput_organizationId_idx" ON "payroll_export_work_input" USING btree ("organization_id");--> statement-breakpoint
CREATE FUNCTION "payroll_export_work_input_reject_update"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'payroll export work input is immutable'
		USING ERRCODE = 'integrity_constraint_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "payroll_export_work_input_immutable" BEFORE UPDATE ON "payroll_export_work_input" FOR EACH ROW EXECUTE FUNCTION "payroll_export_work_input_reject_update"();
