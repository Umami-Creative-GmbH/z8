CREATE TABLE "legal_entity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"registration_number" text,
	"tax_id" text,
	"country_code" text,
	"street" text,
	"city" text,
	"postal_code" text,
	"country" text,
	"default_currency" text DEFAULT 'EUR' NOT NULL,
	"timezone" text DEFAULT 'Europe/Berlin' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "legal_entity_admin" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
DROP INDEX "changePolicy_org_name_idx";--> statement-breakpoint
DROP INDEX "changePolicyAssignment_org_default_idx";--> statement-breakpoint
DROP INDEX "holidayAssignment_holiday_org_idx";--> statement-breakpoint
DROP INDEX "holidayPreset_org_location_idx";--> statement-breakpoint
DROP INDEX "holidayPresetAssignment_org_default_idx";--> statement-breakpoint
DROP INDEX "payrollExportConfig_org_format_active_idx";--> statement-breakpoint
DROP INDEX "vacationAllowance_org_name_active_idx";--> statement-breakpoint
DROP INDEX "vacationAllowance_org_company_default_idx";--> statement-breakpoint
DROP INDEX "vacationPolicyAssignment_org_default_idx";--> statement-breakpoint
DROP INDEX "workPolicy_org_name_idx";--> statement-breakpoint
DROP INDEX "workPolicyAssignment_org_default_idx";--> statement-breakpoint
DROP INDEX "changePolicyAssignment_resolution_idx";--> statement-breakpoint
ALTER TABLE "change_policy" ADD COLUMN "legal_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "change_policy_assignment" ADD COLUMN "legal_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "holiday" ADD COLUMN "legal_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "holiday_assignment" ADD COLUMN "legal_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "holiday_category" ADD COLUMN "legal_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "holiday_preset" ADD COLUMN "legal_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "holiday_preset_assignment" ADD COLUMN "legal_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "employee" ADD COLUMN "legal_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "payroll_export_config" ADD COLUMN "legal_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "payroll_export_job" ADD COLUMN "legal_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "scheduled_export" ADD COLUMN "legal_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "scheduled_export_execution" ADD COLUMN "legal_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "vacation_allowance" ADD COLUMN "legal_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "vacation_policy_assignment" ADD COLUMN "legal_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "work_policy" ADD COLUMN "legal_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "work_policy_assignment" ADD COLUMN "legal_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "work_policy_violation" ADD COLUMN "legal_entity_id" uuid;--> statement-breakpoint
INSERT INTO legal_entity (id, organization_id, name, legal_name, default_currency, timezone, is_default, is_active, created_at, updated_at)
SELECT gen_random_uuid(), id, name, name, 'EUR', 'Europe/Berlin', true, true, now(), now()
FROM organization
WHERE NOT EXISTS (
	SELECT 1 FROM legal_entity WHERE legal_entity.organization_id = organization.id
);--> statement-breakpoint
UPDATE employee
SET legal_entity_id = legal_entity.id
FROM legal_entity
WHERE employee.organization_id = legal_entity.organization_id
	AND legal_entity.is_default = true
	AND employee.legal_entity_id IS NULL;--> statement-breakpoint
UPDATE holiday_category
SET legal_entity_id = legal_entity.id
FROM legal_entity
WHERE holiday_category.organization_id = legal_entity.organization_id
	AND legal_entity.is_default = true
	AND holiday_category.legal_entity_id IS NULL;--> statement-breakpoint
UPDATE holiday
SET legal_entity_id = legal_entity.id
FROM legal_entity
WHERE holiday.organization_id = legal_entity.organization_id
	AND legal_entity.is_default = true
	AND holiday.legal_entity_id IS NULL;--> statement-breakpoint
UPDATE holiday_preset
SET legal_entity_id = legal_entity.id
FROM legal_entity
WHERE holiday_preset.organization_id = legal_entity.organization_id
	AND legal_entity.is_default = true
	AND holiday_preset.legal_entity_id IS NULL;--> statement-breakpoint
UPDATE holiday_preset_assignment
SET legal_entity_id = legal_entity.id
FROM legal_entity
WHERE holiday_preset_assignment.organization_id = legal_entity.organization_id
	AND legal_entity.is_default = true
	AND holiday_preset_assignment.legal_entity_id IS NULL;--> statement-breakpoint
UPDATE holiday_assignment
SET legal_entity_id = legal_entity.id
FROM legal_entity
WHERE holiday_assignment.organization_id = legal_entity.organization_id
	AND legal_entity.is_default = true
	AND holiday_assignment.legal_entity_id IS NULL;--> statement-breakpoint
UPDATE work_policy
SET legal_entity_id = legal_entity.id
FROM legal_entity
WHERE work_policy.organization_id = legal_entity.organization_id
	AND legal_entity.is_default = true
	AND work_policy.legal_entity_id IS NULL;--> statement-breakpoint
UPDATE work_policy_assignment
SET legal_entity_id = legal_entity.id
FROM legal_entity
WHERE work_policy_assignment.organization_id = legal_entity.organization_id
	AND legal_entity.is_default = true
	AND work_policy_assignment.legal_entity_id IS NULL;--> statement-breakpoint
UPDATE work_policy_violation
SET legal_entity_id = legal_entity.id
FROM legal_entity
WHERE work_policy_violation.organization_id = legal_entity.organization_id
	AND legal_entity.is_default = true
	AND work_policy_violation.legal_entity_id IS NULL;--> statement-breakpoint
UPDATE change_policy
SET legal_entity_id = legal_entity.id
FROM legal_entity
WHERE change_policy.organization_id = legal_entity.organization_id
	AND legal_entity.is_default = true
	AND change_policy.legal_entity_id IS NULL;--> statement-breakpoint
UPDATE change_policy_assignment
SET legal_entity_id = legal_entity.id
FROM legal_entity
WHERE change_policy_assignment.organization_id = legal_entity.organization_id
	AND legal_entity.is_default = true
	AND change_policy_assignment.legal_entity_id IS NULL;--> statement-breakpoint
UPDATE vacation_allowance
SET legal_entity_id = legal_entity.id
FROM legal_entity
WHERE vacation_allowance.organization_id = legal_entity.organization_id
	AND legal_entity.is_default = true
	AND vacation_allowance.legal_entity_id IS NULL;--> statement-breakpoint
UPDATE vacation_policy_assignment
SET legal_entity_id = legal_entity.id
FROM legal_entity
WHERE vacation_policy_assignment.organization_id = legal_entity.organization_id
	AND legal_entity.is_default = true
	AND vacation_policy_assignment.legal_entity_id IS NULL;--> statement-breakpoint
UPDATE payroll_export_config
SET legal_entity_id = legal_entity.id
FROM legal_entity
WHERE payroll_export_config.organization_id = legal_entity.organization_id
	AND legal_entity.is_default = true
	AND payroll_export_config.legal_entity_id IS NULL;--> statement-breakpoint
UPDATE payroll_export_job
SET legal_entity_id = legal_entity.id
FROM legal_entity
WHERE payroll_export_job.organization_id = legal_entity.organization_id
	AND legal_entity.is_default = true
	AND payroll_export_job.legal_entity_id IS NULL;--> statement-breakpoint
UPDATE scheduled_export
SET legal_entity_id = legal_entity.id
FROM legal_entity
WHERE scheduled_export.organization_id = legal_entity.organization_id
	AND legal_entity.is_default = true
	AND scheduled_export.legal_entity_id IS NULL;--> statement-breakpoint
UPDATE scheduled_export_execution
SET legal_entity_id = legal_entity.id
FROM legal_entity
WHERE scheduled_export_execution.organization_id = legal_entity.organization_id
	AND legal_entity.is_default = true
	AND scheduled_export_execution.legal_entity_id IS NULL;--> statement-breakpoint
ALTER TABLE "change_policy" ALTER COLUMN "legal_entity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "change_policy_assignment" ALTER COLUMN "legal_entity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "holiday" ALTER COLUMN "legal_entity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "holiday_assignment" ALTER COLUMN "legal_entity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "holiday_category" ALTER COLUMN "legal_entity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "holiday_preset" ALTER COLUMN "legal_entity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "holiday_preset_assignment" ALTER COLUMN "legal_entity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "employee" ALTER COLUMN "legal_entity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_export_config" ALTER COLUMN "legal_entity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_export_job" ALTER COLUMN "legal_entity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduled_export" ALTER COLUMN "legal_entity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduled_export_execution" ALTER COLUMN "legal_entity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "vacation_allowance" ALTER COLUMN "legal_entity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "vacation_policy_assignment" ALTER COLUMN "legal_entity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "work_policy" ALTER COLUMN "legal_entity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "work_policy_assignment" ALTER COLUMN "legal_entity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "work_policy_violation" ALTER COLUMN "legal_entity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "legal_entity" ADD CONSTRAINT "legal_entity_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_entity" ADD CONSTRAINT "legal_entity_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_entity" ADD CONSTRAINT "legal_entity_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_entity_admin" ADD CONSTRAINT "legal_entity_admin_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_entity_admin" ADD CONSTRAINT "legal_entity_admin_legal_entity_id_legal_entity_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_entity_admin" ADD CONSTRAINT "legal_entity_admin_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_entity_admin" ADD CONSTRAINT "legal_entity_admin_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "legalEntity_organizationId_idx" ON "legal_entity" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "legalEntity_isActive_idx" ON "legal_entity" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "legalEntity_id_organizationId_idx" ON "legal_entity" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "legalEntity_org_name_idx" ON "legal_entity" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "legalEntity_org_default_active_idx" ON "legal_entity" USING btree ("organization_id") WHERE is_default = true AND is_active = true;--> statement-breakpoint
CREATE INDEX "legalEntityAdmin_organizationId_idx" ON "legal_entity_admin" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "legalEntityAdmin_legalEntityId_idx" ON "legal_entity_admin" USING btree ("legal_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "legalEntityAdmin_entity_employee_idx" ON "legal_entity_admin" USING btree ("legal_entity_id","employee_id");--> statement-breakpoint
CREATE INDEX "changePolicy_legalEntityId_idx" ON "change_policy" USING btree ("legal_entity_id");--> statement-breakpoint
CREATE INDEX "changePolicy_org_entity_idx" ON "change_policy" USING btree ("organization_id","legal_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "changePolicy_org_entity_name_idx" ON "change_policy" USING btree ("organization_id","legal_entity_id","name");--> statement-breakpoint
CREATE INDEX "changePolicyAssignment_legalEntityId_idx" ON "change_policy_assignment" USING btree ("legal_entity_id");--> statement-breakpoint
CREATE INDEX "changePolicyAssignment_org_entity_idx" ON "change_policy_assignment" USING btree ("organization_id","legal_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "changePolicyAssignment_entity_default_idx" ON "change_policy_assignment" USING btree ("organization_id","legal_entity_id","assignment_type") WHERE assignment_type = 'organization' AND is_active = true;--> statement-breakpoint
CREATE INDEX "holiday_legalEntityId_idx" ON "holiday" USING btree ("legal_entity_id");--> statement-breakpoint
CREATE INDEX "holiday_org_entity_idx" ON "holiday" USING btree ("organization_id","legal_entity_id");--> statement-breakpoint
CREATE INDEX "holidayAssignment_legalEntityId_idx" ON "holiday_assignment" USING btree ("legal_entity_id");--> statement-breakpoint
CREATE INDEX "holidayAssignment_org_entity_idx" ON "holiday_assignment" USING btree ("organization_id","legal_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "holidayAssignment_holiday_entity_idx" ON "holiday_assignment" USING btree ("holiday_id","organization_id","legal_entity_id","assignment_type") WHERE assignment_type = 'organization' AND is_active = true;--> statement-breakpoint
CREATE INDEX "holidayCategory_legalEntityId_idx" ON "holiday_category" USING btree ("legal_entity_id");--> statement-breakpoint
CREATE INDEX "holidayCategory_org_entity_idx" ON "holiday_category" USING btree ("organization_id","legal_entity_id");--> statement-breakpoint
CREATE INDEX "holidayPreset_legalEntityId_idx" ON "holiday_preset" USING btree ("legal_entity_id");--> statement-breakpoint
CREATE INDEX "holidayPreset_org_entity_idx" ON "holiday_preset" USING btree ("organization_id","legal_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "holidayPreset_org_entity_location_idx" ON "holiday_preset" USING btree ("organization_id","legal_entity_id","country_code","state_code","region_code");--> statement-breakpoint
CREATE INDEX "holidayPresetAssignment_legalEntityId_idx" ON "holiday_preset_assignment" USING btree ("legal_entity_id");--> statement-breakpoint
CREATE INDEX "holidayPresetAssignment_org_entity_idx" ON "holiday_preset_assignment" USING btree ("organization_id","legal_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "holidayPresetAssignment_entity_default_idx" ON "holiday_preset_assignment" USING btree ("organization_id","legal_entity_id","assignment_type") WHERE assignment_type = 'organization' AND is_active = true;--> statement-breakpoint
CREATE INDEX "employee_legalEntityId_idx" ON "employee" USING btree ("legal_entity_id");--> statement-breakpoint
CREATE INDEX "employee_org_entity_idx" ON "employee" USING btree ("organization_id","legal_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_id_org_entity_idx" ON "employee" USING btree ("id","organization_id","legal_entity_id");--> statement-breakpoint
CREATE INDEX "payrollExportConfig_legalEntityId_idx" ON "payroll_export_config" USING btree ("legal_entity_id");--> statement-breakpoint
CREATE INDEX "payrollExportConfig_org_entity_idx" ON "payroll_export_config" USING btree ("organization_id","legal_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payrollExportConfig_org_entity_format_active_idx" ON "payroll_export_config" USING btree ("organization_id","legal_entity_id","format_id") WHERE is_active = true;--> statement-breakpoint
CREATE INDEX "payrollExportJob_legalEntityId_idx" ON "payroll_export_job" USING btree ("legal_entity_id");--> statement-breakpoint
CREATE INDEX "payrollExportJob_org_entity_idx" ON "payroll_export_job" USING btree ("organization_id","legal_entity_id");--> statement-breakpoint
CREATE INDEX "scheduledExport_legalEntityId_idx" ON "scheduled_export" USING btree ("legal_entity_id");--> statement-breakpoint
CREATE INDEX "scheduledExport_org_entity_idx" ON "scheduled_export" USING btree ("organization_id","legal_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scheduledExport_org_entity_name_active_idx" ON "scheduled_export" USING btree ("organization_id","legal_entity_id","name") WHERE is_active = true;--> statement-breakpoint
CREATE INDEX "scheduledExportExecution_legalEntityId_idx" ON "scheduled_export_execution" USING btree ("legal_entity_id");--> statement-breakpoint
CREATE INDEX "scheduledExportExecution_org_entity_idx" ON "scheduled_export_execution" USING btree ("organization_id","legal_entity_id");--> statement-breakpoint
CREATE INDEX "vacationAllowance_legalEntityId_idx" ON "vacation_allowance" USING btree ("legal_entity_id");--> statement-breakpoint
CREATE INDEX "vacationAllowance_org_entity_idx" ON "vacation_allowance" USING btree ("organization_id","legal_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vacationAllowance_org_entity_name_active_idx" ON "vacation_allowance" USING btree ("organization_id","legal_entity_id","name") WHERE is_active = true AND valid_until IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "vacationAllowance_entity_company_default_idx" ON "vacation_allowance" USING btree ("organization_id","legal_entity_id") WHERE is_company_default = true AND is_active = true AND valid_until IS NULL;--> statement-breakpoint
CREATE INDEX "vacationPolicyAssignment_legalEntityId_idx" ON "vacation_policy_assignment" USING btree ("legal_entity_id");--> statement-breakpoint
CREATE INDEX "vacationPolicyAssignment_org_entity_idx" ON "vacation_policy_assignment" USING btree ("organization_id","legal_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vacationPolicyAssignment_entity_default_idx" ON "vacation_policy_assignment" USING btree ("organization_id","legal_entity_id","assignment_type") WHERE assignment_type = 'organization' AND is_active = true;--> statement-breakpoint
CREATE INDEX "workPolicy_legalEntityId_idx" ON "work_policy" USING btree ("legal_entity_id");--> statement-breakpoint
CREATE INDEX "workPolicy_org_entity_idx" ON "work_policy" USING btree ("organization_id","legal_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workPolicy_org_entity_name_idx" ON "work_policy" USING btree ("organization_id","legal_entity_id","name");--> statement-breakpoint
CREATE INDEX "workPolicyAssignment_legalEntityId_idx" ON "work_policy_assignment" USING btree ("legal_entity_id");--> statement-breakpoint
CREATE INDEX "workPolicyAssignment_org_entity_idx" ON "work_policy_assignment" USING btree ("organization_id","legal_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workPolicyAssignment_entity_default_idx" ON "work_policy_assignment" USING btree ("organization_id","legal_entity_id","assignment_type") WHERE assignment_type = 'organization' AND is_active = true;--> statement-breakpoint
CREATE INDEX "workPolicyViolation_legalEntityId_idx" ON "work_policy_violation" USING btree ("legal_entity_id");--> statement-breakpoint
CREATE INDEX "workPolicyViolation_org_entity_idx" ON "work_policy_violation" USING btree ("organization_id","legal_entity_id");--> statement-breakpoint
CREATE INDEX "changePolicyAssignment_resolution_idx" ON "change_policy_assignment" USING btree ("organization_id","legal_entity_id","assignment_type","is_active");--> statement-breakpoint
ALTER TABLE "change_policy" ADD CONSTRAINT "change_policy_legal_entity_id_legal_entity_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_policy" ADD CONSTRAINT "change_policy_legal_entity_id_organization_id_legal_entity_id_organization_id_fk" FOREIGN KEY ("legal_entity_id","organization_id") REFERENCES "public"."legal_entity"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_policy_assignment" ADD CONSTRAINT "change_policy_assignment_legal_entity_id_legal_entity_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_policy_assignment" ADD CONSTRAINT "change_policy_assignment_legal_entity_id_organization_id_legal_entity_id_organization_id_fk" FOREIGN KEY ("legal_entity_id","organization_id") REFERENCES "public"."legal_entity"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday" ADD CONSTRAINT "holiday_legal_entity_id_legal_entity_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday" ADD CONSTRAINT "holiday_legal_entity_id_organization_id_legal_entity_id_organization_id_fk" FOREIGN KEY ("legal_entity_id","organization_id") REFERENCES "public"."legal_entity"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_assignment" ADD CONSTRAINT "holiday_assignment_legal_entity_id_legal_entity_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_assignment" ADD CONSTRAINT "holiday_assignment_legal_entity_id_organization_id_legal_entity_id_organization_id_fk" FOREIGN KEY ("legal_entity_id","organization_id") REFERENCES "public"."legal_entity"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_category" ADD CONSTRAINT "holiday_category_legal_entity_id_legal_entity_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_category" ADD CONSTRAINT "holiday_category_legal_entity_id_organization_id_legal_entity_id_organization_id_fk" FOREIGN KEY ("legal_entity_id","organization_id") REFERENCES "public"."legal_entity"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_preset" ADD CONSTRAINT "holiday_preset_legal_entity_id_legal_entity_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_preset" ADD CONSTRAINT "holiday_preset_legal_entity_id_organization_id_legal_entity_id_organization_id_fk" FOREIGN KEY ("legal_entity_id","organization_id") REFERENCES "public"."legal_entity"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_preset_assignment" ADD CONSTRAINT "holiday_preset_assignment_legal_entity_id_legal_entity_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_preset_assignment" ADD CONSTRAINT "holiday_preset_assignment_legal_entity_id_organization_id_legal_entity_id_organization_id_fk" FOREIGN KEY ("legal_entity_id","organization_id") REFERENCES "public"."legal_entity"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee" ADD CONSTRAINT "employee_legal_entity_id_legal_entity_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee" ADD CONSTRAINT "employee_legal_entity_id_organization_id_legal_entity_id_organization_id_fk" FOREIGN KEY ("legal_entity_id","organization_id") REFERENCES "public"."legal_entity"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_export_config" ADD CONSTRAINT "payroll_export_config_legal_entity_id_legal_entity_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_export_config" ADD CONSTRAINT "payroll_export_config_legal_entity_id_organization_id_legal_entity_id_organization_id_fk" FOREIGN KEY ("legal_entity_id","organization_id") REFERENCES "public"."legal_entity"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_export_job" ADD CONSTRAINT "payroll_export_job_legal_entity_id_legal_entity_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_export_job" ADD CONSTRAINT "payroll_export_job_legal_entity_id_organization_id_legal_entity_id_organization_id_fk" FOREIGN KEY ("legal_entity_id","organization_id") REFERENCES "public"."legal_entity"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_export" ADD CONSTRAINT "scheduled_export_legal_entity_id_legal_entity_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_export" ADD CONSTRAINT "scheduled_export_legal_entity_id_organization_id_legal_entity_id_organization_id_fk" FOREIGN KEY ("legal_entity_id","organization_id") REFERENCES "public"."legal_entity"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_export_execution" ADD CONSTRAINT "scheduled_export_execution_legal_entity_id_legal_entity_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_export_execution" ADD CONSTRAINT "scheduled_export_execution_legal_entity_id_organization_id_legal_entity_id_organization_id_fk" FOREIGN KEY ("legal_entity_id","organization_id") REFERENCES "public"."legal_entity"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_allowance" ADD CONSTRAINT "vacation_allowance_legal_entity_id_legal_entity_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_allowance" ADD CONSTRAINT "vacation_allowance_legal_entity_id_organization_id_legal_entity_id_organization_id_fk" FOREIGN KEY ("legal_entity_id","organization_id") REFERENCES "public"."legal_entity"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_policy_assignment" ADD CONSTRAINT "vacation_policy_assignment_legal_entity_id_legal_entity_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_policy_assignment" ADD CONSTRAINT "vacation_policy_assignment_legal_entity_id_organization_id_legal_entity_id_organization_id_fk" FOREIGN KEY ("legal_entity_id","organization_id") REFERENCES "public"."legal_entity"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_policy" ADD CONSTRAINT "work_policy_legal_entity_id_legal_entity_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_policy" ADD CONSTRAINT "work_policy_legal_entity_id_organization_id_legal_entity_id_organization_id_fk" FOREIGN KEY ("legal_entity_id","organization_id") REFERENCES "public"."legal_entity"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_policy_assignment" ADD CONSTRAINT "work_policy_assignment_legal_entity_id_legal_entity_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_policy_assignment" ADD CONSTRAINT "work_policy_assignment_legal_entity_id_organization_id_legal_entity_id_organization_id_fk" FOREIGN KEY ("legal_entity_id","organization_id") REFERENCES "public"."legal_entity"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_policy_violation" ADD CONSTRAINT "work_policy_violation_legal_entity_id_legal_entity_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_policy_violation" ADD CONSTRAINT "work_policy_violation_legal_entity_id_organization_id_legal_entity_id_organization_id_fk" FOREIGN KEY ("legal_entity_id","organization_id") REFERENCES "public"."legal_entity"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_entity_admin" ADD CONSTRAINT "legal_entity_admin_legal_entity_id_organization_id_legal_entity_id_organization_id_fk" FOREIGN KEY ("legal_entity_id","organization_id") REFERENCES "public"."legal_entity"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_entity_admin" ADD CONSTRAINT "legal_entity_admin_employee_id_organization_id_legal_entity_id_employee_id_organization_id_legal_entity_id_fk" FOREIGN KEY ("employee_id","organization_id","legal_entity_id") REFERENCES "public"."employee"("id","organization_id","legal_entity_id") ON DELETE no action ON UPDATE no action;
