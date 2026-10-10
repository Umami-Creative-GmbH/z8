-- Deputies on absences (#1011, spec #802): an absence optionally names the
-- colleague who covers while the employee is away, and absence categories can
-- require one. The deputy is an employee of the absence's organization and never
-- the absent employee; deleting that employee clears only the deputy.
ALTER TABLE "absence_category" ADD COLUMN IF NOT EXISTS "deputy_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "absence_entry" ADD COLUMN IF NOT EXISTS "deputy_employee_id" uuid;--> statement-breakpoint
ALTER TABLE "absence_entry" ADD CONSTRAINT "absence_entry_deputy_employee_fk" FOREIGN KEY ("deputy_employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE SET NULL ("deputy_employee_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absence_entry" ADD CONSTRAINT "absence_entry_deputy_check" CHECK ("absence_entry"."deputy_employee_id" IS NULL OR ("absence_entry"."organization_id" IS NOT NULL AND "absence_entry"."deputy_employee_id" <> "absence_entry"."employee_id"));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "absenceEntry_org_deputyEmployeeId_idx" ON "absence_entry" USING btree ("organization_id","deputy_employee_id") WHERE "absence_entry"."deputy_employee_id" IS NOT NULL;
