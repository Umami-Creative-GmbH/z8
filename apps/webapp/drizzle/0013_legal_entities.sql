CREATE TYPE "public"."approval_chain_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."approval_policy_approver_type" AS ENUM('direct_manager', 'manager_manager', 'org_admin', 'specific_employee');--> statement-breakpoint
CREATE TYPE "public"."approval_policy_condition_operator" AS ENUM('equals', 'in', 'gte', 'lte', 'between');--> statement-breakpoint
CREATE TYPE "public"."approval_policy_condition_type" AS ENUM('approval_type', 'team', 'location', 'absence_category', 'travel_expense_amount', 'overtime_risk', 'employee_group');--> statement-breakpoint
CREATE TYPE "public"."approval_policy_overtime_risk" AS ENUM('none', 'warning', 'violation');--> statement-breakpoint
CREATE TABLE "approval_chain_instance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"policy_id" uuid NOT NULL,
	"policy_name_snapshot" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"requester_employee_id" uuid NOT NULL,
	"current_stage_order" integer NOT NULL,
	"status" "approval_chain_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "approval_chain_stage_instance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"chain_instance_id" uuid NOT NULL,
	"policy_stage_id" uuid NOT NULL,
	"step_order" integer NOT NULL,
	"label_snapshot" text NOT NULL,
	"approver_type_snapshot" text NOT NULL,
	"resolved_approver_employee_id" uuid NOT NULL,
	"approval_request_id" uuid,
	"status" "approval_chain_status" DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_policy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT false NOT NULL,
	"priority" integer NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_policy_condition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"policy_id" uuid NOT NULL,
	"condition_type" "approval_policy_condition_type" NOT NULL,
	"operator" "approval_policy_condition_operator" NOT NULL,
	"value_json" jsonb,
	"amount_min" numeric(12, 2),
	"amount_max" numeric(12, 2),
	"overtime_risk" "approval_policy_overtime_risk",
	"team_id" uuid,
	"location_id" uuid,
	"absence_category_id" uuid,
	"employee_group_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_policy_stage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"policy_id" uuid NOT NULL,
	"step_order" integer NOT NULL,
	"label" text NOT NULL,
	"approver_type" "approval_policy_approver_type" NOT NULL,
	"approver_employee_id" uuid,
	"fallback_behavior" text DEFAULT 'fail' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_group" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_group_member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"group_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
CREATE UNIQUE INDEX "approvalChainInstance_id_organizationId_idx" ON "approval_chain_instance" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "approvalPolicy_id_organizationId_idx" ON "approval_policy" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employeeGroup_id_organizationId_idx" ON "employee_group" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "legalEntity_id_organizationId_idx" ON "legal_entity" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "absenceCategory_id_organizationId_idx" ON "absence_category" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "approvalRequest_id_organizationId_idx" ON "approval_request" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_id_org_entity_idx" ON "employee" USING btree ("id","organization_id","legal_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_id_organizationId_idx" ON "employee" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "location_id_organizationId_idx" ON "location" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_id_organizationId_idx" ON "team" USING btree ("id","organization_id");--> statement-breakpoint
ALTER TABLE "approval_chain_instance" ADD CONSTRAINT "approval_chain_instance_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_chain_instance" ADD CONSTRAINT "approval_chain_instance_policy_id_organization_id_approval_policy_id_organization_id_fk" FOREIGN KEY ("policy_id","organization_id") REFERENCES "public"."approval_policy"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_chain_instance" ADD CONSTRAINT "approval_chain_instance_requester_employee_id_organization_id_employee_id_organization_id_fk" FOREIGN KEY ("requester_employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_chain_stage_instance" ADD CONSTRAINT "approval_chain_stage_instance_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_chain_stage_instance" ADD CONSTRAINT "approval_chain_stage_instance_chain_instance_id_organization_id_approval_chain_instance_id_organization_id_fk" FOREIGN KEY ("chain_instance_id","organization_id") REFERENCES "public"."approval_chain_instance"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_chain_stage_instance" ADD CONSTRAINT "approval_chain_stage_instance_approval_request_id_organization_id_approval_request_id_organization_id_fk" FOREIGN KEY ("approval_request_id","organization_id") REFERENCES "public"."approval_request"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_chain_stage_instance" ADD CONSTRAINT "approval_chain_stage_instance_resolved_approver_employee_id_organization_id_employee_id_organization_id_fk" FOREIGN KEY ("resolved_approver_employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_chain_stage_instance" ADD CONSTRAINT "approval_chain_stage_instance_decided_by_organization_id_employee_id_organization_id_fk" FOREIGN KEY ("decided_by","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_policy" ADD CONSTRAINT "approval_policy_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_policy" ADD CONSTRAINT "approval_policy_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_policy" ADD CONSTRAINT "approval_policy_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_policy_condition" ADD CONSTRAINT "approval_policy_condition_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_policy_condition" ADD CONSTRAINT "approval_policy_condition_policy_id_organization_id_approval_policy_id_organization_id_fk" FOREIGN KEY ("policy_id","organization_id") REFERENCES "public"."approval_policy"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_policy_condition" ADD CONSTRAINT "approval_policy_condition_team_id_organization_id_team_id_organization_id_fk" FOREIGN KEY ("team_id","organization_id") REFERENCES "public"."team"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_policy_condition" ADD CONSTRAINT "approval_policy_condition_location_id_organization_id_location_id_organization_id_fk" FOREIGN KEY ("location_id","organization_id") REFERENCES "public"."location"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_policy_condition" ADD CONSTRAINT "approval_policy_condition_absence_category_id_organization_id_absence_category_id_organization_id_fk" FOREIGN KEY ("absence_category_id","organization_id") REFERENCES "public"."absence_category"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_policy_condition" ADD CONSTRAINT "approval_policy_condition_employee_group_id_organization_id_employee_group_id_organization_id_fk" FOREIGN KEY ("employee_group_id","organization_id") REFERENCES "public"."employee_group"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_policy_stage" ADD CONSTRAINT "approval_policy_stage_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_policy_stage" ADD CONSTRAINT "approval_policy_stage_policy_id_organization_id_approval_policy_id_organization_id_fk" FOREIGN KEY ("policy_id","organization_id") REFERENCES "public"."approval_policy"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_policy_stage" ADD CONSTRAINT "approval_policy_stage_approver_employee_id_organization_id_employee_id_organization_id_fk" FOREIGN KEY ("approver_employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_group" ADD CONSTRAINT "employee_group_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_group_member" ADD CONSTRAINT "employee_group_member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_group_member" ADD CONSTRAINT "employee_group_member_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_group_member" ADD CONSTRAINT "employee_group_member_group_id_organization_id_employee_group_id_organization_id_fk" FOREIGN KEY ("group_id","organization_id") REFERENCES "public"."employee_group"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_group_member" ADD CONSTRAINT "employee_group_member_employee_id_organization_id_employee_id_organization_id_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_entity" ADD CONSTRAINT "legal_entity_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_entity" ADD CONSTRAINT "legal_entity_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_entity" ADD CONSTRAINT "legal_entity_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_entity_admin" ADD CONSTRAINT "legal_entity_admin_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_entity_admin" ADD CONSTRAINT "legal_entity_admin_legal_entity_id_legal_entity_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_entity_admin" ADD CONSTRAINT "legal_entity_admin_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_entity_admin" ADD CONSTRAINT "legal_entity_admin_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_entity_admin" ADD CONSTRAINT "legal_entity_admin_legal_entity_id_organization_id_legal_entity_id_organization_id_fk" FOREIGN KEY ("legal_entity_id","organization_id") REFERENCES "public"."legal_entity"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_entity_admin" ADD CONSTRAINT "legal_entity_admin_employee_id_organization_id_legal_entity_id_employee_id_organization_id_legal_entity_id_fk" FOREIGN KEY ("employee_id","organization_id","legal_entity_id") REFERENCES "public"."employee"("id","organization_id","legal_entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approvalChainInstance_org_entity_idx" ON "approval_chain_instance" USING btree ("organization_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "approvalChainInstance_org_status_idx" ON "approval_chain_instance" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "approvalChainStageInstance_org_chain_idx" ON "approval_chain_stage_instance" USING btree ("organization_id","chain_instance_id");--> statement-breakpoint
CREATE UNIQUE INDEX "approvalChainStageInstance_request_idx" ON "approval_chain_stage_instance" USING btree ("approval_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "approvalChainStageInstance_chain_order_idx" ON "approval_chain_stage_instance" USING btree ("chain_instance_id","step_order");--> statement-breakpoint
CREATE INDEX "approvalPolicy_organizationId_idx" ON "approval_policy" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "approvalPolicy_org_priority_idx" ON "approval_policy" USING btree ("organization_id","priority");--> statement-breakpoint
CREATE INDEX "approvalPolicyCondition_org_policy_idx" ON "approval_policy_condition" USING btree ("organization_id","policy_id");--> statement-breakpoint
CREATE INDEX "approvalPolicyCondition_type_idx" ON "approval_policy_condition" USING btree ("condition_type");--> statement-breakpoint
CREATE INDEX "approvalPolicyStage_org_policy_idx" ON "approval_policy_stage" USING btree ("organization_id","policy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "approvalPolicyStage_id_organizationId_idx" ON "approval_policy_stage" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "approvalPolicyStage_policy_order_idx" ON "approval_policy_stage" USING btree ("policy_id","step_order");--> statement-breakpoint
CREATE INDEX "employeeGroup_organizationId_idx" ON "employee_group" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employeeGroup_org_name_idx" ON "employee_group" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "employeeGroupMember_org_group_idx" ON "employee_group_member" USING btree ("organization_id","group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employeeGroupMember_group_employee_idx" ON "employee_group_member" USING btree ("group_id","employee_id");--> statement-breakpoint
CREATE INDEX "legalEntity_organizationId_idx" ON "legal_entity" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "legalEntity_isActive_idx" ON "legal_entity" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "legalEntity_org_name_idx" ON "legal_entity" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "legalEntity_org_default_active_idx" ON "legal_entity" USING btree ("organization_id") WHERE is_default = true AND is_active = true;--> statement-breakpoint
CREATE INDEX "legalEntityAdmin_organizationId_idx" ON "legal_entity_admin" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "legalEntityAdmin_legalEntityId_idx" ON "legal_entity_admin" USING btree ("legal_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "legalEntityAdmin_entity_employee_idx" ON "legal_entity_admin" USING btree ("legal_entity_id","employee_id");--> statement-breakpoint
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
CREATE INDEX "changePolicyAssignment_resolution_idx" ON "change_policy_assignment" USING btree ("organization_id","legal_entity_id","assignment_type","is_active");
