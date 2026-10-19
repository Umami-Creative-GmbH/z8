CREATE TABLE "payroll_export_baseline" (
 "id" uuid PRIMARY KEY NOT NULL,
 "job_id" uuid NOT NULL,
 "descriptor" jsonb NOT NULL,
 "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
 "version" integer NOT NULL,
 "digest" text NOT NULL,
 "scope_employee_ids" jsonb NOT NULL,
 "evidence" jsonb,
 "unavailable_reason" text,
 "created_at" timestamptz NOT NULL,
 "completed_at" timestamptz NOT NULL,
 "expires_at" timestamptz NOT NULL,
 CONSTRAINT "payroll_export_baseline_reason_check" CHECK (unavailable_reason IS NULL OR unavailable_reason IN ('expired','erased'))
);
--> statement-breakpoint
CREATE INDEX "payroll_export_baseline_org_completion_idx" ON "payroll_export_baseline"("organization_id","completed_at");
--> statement-breakpoint
CREATE INDEX "payroll_export_baseline_expiry_idx" ON "payroll_export_baseline"("expires_at");
--> statement-breakpoint
CREATE FUNCTION guard_payroll_export_baseline() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(NEW) - 'evidence' - 'unavailable_reason') IS DISTINCT FROM (to_jsonb(OLD) - 'evidence' - 'unavailable_reason')
 OR NOT (NEW.evidence IS NULL AND NEW.unavailable_reason IN ('expired','erased'))
 OR (OLD.evidence IS NULL AND NEW.unavailable_reason IS DISTINCT FROM OLD.unavailable_reason)
 THEN RAISE EXCEPTION 'Payroll baseline evidence is immutable'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER payroll_export_baseline_immutable BEFORE UPDATE ON payroll_export_baseline FOR EACH ROW EXECUTE FUNCTION guard_payroll_export_baseline();
--> statement-breakpoint
CREATE TABLE payroll_export_baseline_window_input (
 job_id uuid PRIMARY KEY REFERENCES payroll_export_job(id) ON DELETE CASCADE,
 organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 digest text NOT NULL,
 windows jsonb NOT NULL
);
--> statement-breakpoint
CREATE FUNCTION guard_payroll_export_baseline_window_input() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Payroll baseline window input is immutable'; END $$;
--> statement-breakpoint
CREATE TRIGGER payroll_export_baseline_window_input_immutable BEFORE UPDATE ON payroll_export_baseline_window_input FOR EACH ROW EXECUTE FUNCTION guard_payroll_export_baseline_window_input();
--> statement-breakpoint
CREATE TABLE payroll_export_comparison_erasure (
 job_id uuid PRIMARY KEY,
 organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX payroll_export_comparison_erasure_org_idx ON payroll_export_comparison_erasure(organization_id);
