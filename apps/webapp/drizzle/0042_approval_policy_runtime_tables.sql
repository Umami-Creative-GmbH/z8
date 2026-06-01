DO $$ BEGIN
	CREATE TYPE "public"."approval_policy_condition_type" AS ENUM('approval_type', 'team', 'location', 'absence_category', 'travel_expense_amount', 'overtime_risk', 'employee_group');
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	CREATE TYPE "public"."approval_policy_condition_operator" AS ENUM('equals', 'in', 'gte', 'lte', 'between');
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	CREATE TYPE "public"."approval_policy_approver_type" AS ENUM('direct_manager', 'manager_manager', 'org_admin', 'specific_employee');
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	CREATE TYPE "public"."approval_chain_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	CREATE TYPE "public"."approval_policy_overtime_risk" AS ENUM('none', 'warning', 'violation');
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'location_id_organizationId_idx' AND conrelid = 'public.location'::regclass)
		AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = 'location_id_organizationId_idx' AND n.nspname = 'public') THEN
		ALTER TABLE "public"."location" ADD CONSTRAINT "location_id_organizationId_idx" UNIQUE("id","organization_id");
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'absenceCategory_id_organizationId_idx' AND conrelid = 'public.absence_category'::regclass)
		AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = 'absenceCategory_id_organizationId_idx' AND n.nspname = 'public') THEN
		ALTER TABLE "public"."absence_category" ADD CONSTRAINT "absenceCategory_id_organizationId_idx" UNIQUE("id","organization_id");
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approvalRequest_id_organizationId_idx' AND conrelid = 'public.approval_request'::regclass)
		AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = 'approvalRequest_id_organizationId_idx' AND n.nspname = 'public') THEN
		ALTER TABLE "public"."approval_request" ADD CONSTRAINT "approvalRequest_id_organizationId_idx" UNIQUE("id","organization_id");
	END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "employee_group" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "employeeGroup_id_organizationId_idx" UNIQUE("id", "organization_id"),
	CONSTRAINT "employee_group_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "approval_policy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT false NOT NULL,
	"priority" integer NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "approvalPolicy_id_organizationId_idx" UNIQUE("id", "organization_id"),
	CONSTRAINT "approval_policy_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "approval_policy_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "approval_policy_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "approval_policy_condition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"policy_id" uuid NOT NULL,
	"condition_type" "public"."approval_policy_condition_type" NOT NULL,
	"operator" "public"."approval_policy_condition_operator" NOT NULL,
	"value_json" jsonb,
	"amount_min" numeric(12, 2),
	"amount_max" numeric(12, 2),
	"overtime_risk" "public"."approval_policy_overtime_risk",
	"team_id" uuid,
	"location_id" uuid,
	"absence_category_id" uuid,
	"employee_group_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "approval_policy_condition_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "approval_policy_condition_policy_id_organization_id_approval_policy_id_organization_id_fk" FOREIGN KEY ("policy_id", "organization_id") REFERENCES "public"."approval_policy"("id", "organization_id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "approval_policy_condition_team_id_organization_id_team_id_organization_id_fk" FOREIGN KEY ("team_id", "organization_id") REFERENCES "public"."team"("id", "organization_id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "approval_policy_condition_location_id_organization_id_location_id_organization_id_fk" FOREIGN KEY ("location_id", "organization_id") REFERENCES "public"."location"("id", "organization_id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "approval_policy_condition_absence_category_id_organization_id_absence_category_id_organization_id_fk" FOREIGN KEY ("absence_category_id", "organization_id") REFERENCES "public"."absence_category"("id", "organization_id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "approval_policy_condition_employee_group_id_organization_id_employee_group_id_organization_id_fk" FOREIGN KEY ("employee_group_id", "organization_id") REFERENCES "public"."employee_group"("id", "organization_id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "approval_policy_stage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"policy_id" uuid NOT NULL,
	"step_order" integer NOT NULL,
	"label" text NOT NULL,
	"approver_type" "public"."approval_policy_approver_type" NOT NULL,
	"approver_employee_id" uuid,
	"fallback_behavior" text DEFAULT 'fail' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "approvalPolicyStage_id_organizationId_idx" UNIQUE("id", "organization_id"),
	CONSTRAINT "approval_policy_stage_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "approval_policy_stage_policy_id_organization_id_approval_policy_id_organization_id_fk" FOREIGN KEY ("policy_id", "organization_id") REFERENCES "public"."approval_policy"("id", "organization_id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "approval_policy_stage_approver_employee_id_organization_id_employee_id_organization_id_fk" FOREIGN KEY ("approver_employee_id", "organization_id") REFERENCES "public"."employee"("id", "organization_id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "approval_chain_instance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"policy_id" uuid NOT NULL,
	"policy_name_snapshot" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"requester_employee_id" uuid NOT NULL,
	"current_stage_order" integer NOT NULL,
	"status" "public"."approval_chain_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"completed_at" timestamp,
	CONSTRAINT "approvalChainInstance_id_organizationId_idx" UNIQUE("id", "organization_id"),
	CONSTRAINT "approval_chain_instance_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "approval_chain_instance_policy_id_organization_id_approval_policy_id_organization_id_fk" FOREIGN KEY ("policy_id", "organization_id") REFERENCES "public"."approval_policy"("id", "organization_id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "approval_chain_instance_requester_employee_id_organization_id_employee_id_organization_id_fk" FOREIGN KEY ("requester_employee_id", "organization_id") REFERENCES "public"."employee"("id", "organization_id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "employee_group_member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"group_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "employee_group_member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "employee_group_member_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "employee_group_member_group_id_organization_id_employee_group_id_organization_id_fk" FOREIGN KEY ("group_id", "organization_id") REFERENCES "public"."employee_group"("id", "organization_id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "employee_group_member_employee_id_organization_id_employee_id_organization_id_fk" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "public"."employee"("id", "organization_id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "approval_chain_stage_instance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"chain_instance_id" uuid NOT NULL,
	"policy_stage_id" uuid NOT NULL,
	"step_order" integer NOT NULL,
	"label_snapshot" text NOT NULL,
	"approver_type_snapshot" text NOT NULL,
	"resolved_approver_employee_id" uuid NOT NULL,
	"approval_request_id" uuid,
	"status" "public"."approval_chain_status" DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "approval_chain_stage_instance_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "approval_chain_stage_instance_chain_instance_id_organization_id_approval_chain_instance_id_organization_id_fk" FOREIGN KEY ("chain_instance_id", "organization_id") REFERENCES "public"."approval_chain_instance"("id", "organization_id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "approval_chain_stage_instance_approval_request_id_organization_id_approval_request_id_organization_id_fk" FOREIGN KEY ("approval_request_id", "organization_id") REFERENCES "public"."approval_request"("id", "organization_id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "approval_chain_stage_instance_resolved_approver_employee_id_organization_id_employee_id_organization_id_fk" FOREIGN KEY ("resolved_approver_employee_id", "organization_id") REFERENCES "public"."employee"("id", "organization_id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "approval_chain_stage_instance_decided_by_organization_id_employee_id_organization_id_fk" FOREIGN KEY ("decided_by", "organization_id") REFERENCES "public"."employee"("id", "organization_id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employeeGroup_organizationId_idx" ON "employee_group" USING btree ("organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "employeeGroup_org_name_idx" ON "employee_group" USING btree ("organization_id", "name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approvalPolicy_organizationId_idx" ON "approval_policy" USING btree ("organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "approvalPolicy_org_priority_idx" ON "approval_policy" USING btree ("organization_id", "priority");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approvalPolicyCondition_org_policy_idx" ON "approval_policy_condition" USING btree ("organization_id", "policy_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approvalPolicyCondition_type_idx" ON "approval_policy_condition" USING btree ("condition_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approvalPolicyStage_org_policy_idx" ON "approval_policy_stage" USING btree ("organization_id", "policy_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "approvalPolicyStage_policy_order_idx" ON "approval_policy_stage" USING btree ("policy_id", "step_order");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approvalChainInstance_org_entity_idx" ON "approval_chain_instance" USING btree ("organization_id", "entity_type", "entity_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approvalChainInstance_org_status_idx" ON "approval_chain_instance" USING btree ("organization_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employeeGroupMember_org_group_idx" ON "employee_group_member" USING btree ("organization_id", "group_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "employeeGroupMember_group_employee_idx" ON "employee_group_member" USING btree ("group_id", "employee_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approvalChainStageInstance_org_chain_idx" ON "approval_chain_stage_instance" USING btree ("organization_id", "chain_instance_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "approvalChainStageInstance_request_idx" ON "approval_chain_stage_instance" USING btree ("approval_request_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "approvalChainStageInstance_chain_order_idx" ON "approval_chain_stage_instance" USING btree ("chain_instance_id", "step_order");
