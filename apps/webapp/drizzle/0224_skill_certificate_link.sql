-- Skill certificates (#1144, Scheduling ADR 0001): a certificate in the
-- personnel file may name the one employee skill of the same employee it
-- proves. employee_skill has no organization_id, so the reference goes through
-- the document's employee instead: (employee_skill_id, employee_id) must be an
-- employee skill of that very employee, and the document's own employee
-- reference already ties the employee to the organization.
-- The target of employee-scoped references to an employee skill.
ALTER TABLE "employee_skill" ADD CONSTRAINT "employeeSkill_id_employeeId_idx" UNIQUE("id","employee_id");--> statement-breakpoint
ALTER TABLE "employee_document" ADD COLUMN "employee_skill_id" uuid;--> statement-breakpoint
-- Removing the employee skill clears only the link; the certificate stays.
ALTER TABLE "employee_document" ADD CONSTRAINT "employee_document_employee_skill_fk" FOREIGN KEY ("employee_skill_id","employee_id") REFERENCES "public"."employee_skill"("id","employee_id") ON DELETE SET NULL ("employee_skill_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_document" ADD CONSTRAINT "employee_document_employee_skill_check" CHECK ("employee_document"."employee_skill_id" IS NULL OR "employee_document"."category" = 'certificate');--> statement-breakpoint
CREATE INDEX "employeeDocument_employeeSkill_idx" ON "employee_document" USING btree ("employee_skill_id") WHERE employee_skill_id IS NOT NULL;
