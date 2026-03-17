CREATE TYPE "public"."time_record_allocation_kind" AS ENUM('project', 'cost_center');--> statement-breakpoint
CREATE TYPE "public"."time_record_approval_decision_action" AS ENUM('submitted', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."time_record_approval_state" AS ENUM('draft', 'pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."time_record_kind" AS ENUM('work', 'absence', 'break', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."time_record_origin" AS ENUM('manual', 'clock', 'import', 'system');--> statement-breakpoint
CREATE TYPE "public"."travel_expense_claim_status" AS ENUM('draft', 'submitted', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."travel_expense_decision_action" AS ENUM('approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."travel_expense_type" AS ENUM('receipt', 'mileage', 'per_diem');--> statement-breakpoint
CREATE TABLE "time_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"record_kind" time_record_kind NOT NULL,
	"start_at" timestamp NOT NULL,
	"end_at" timestamp,
	"duration_minutes" integer,
	"approval_state" time_record_approval_state DEFAULT 'draft' NOT NULL,
	"origin" time_record_origin DEFAULT 'manual' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp NOT NULL,
	"updated_by" text,
	CONSTRAINT "timeRecord_id_organizationId_idx" UNIQUE("id","organization_id"),
	CONSTRAINT "timeRecord_id_recordKind_idx" UNIQUE("id","record_kind"),
	CONSTRAINT "timeRecord_durationMinutes_nonNegative_chk" CHECK ("time_record"."duration_minutes" IS NULL OR "time_record"."duration_minutes" >= 0),
	CONSTRAINT "timeRecord_endAt_afterStartAt_chk" CHECK ("time_record"."end_at" IS NULL OR "time_record"."end_at" >= "time_record"."start_at")
);
--> statement-breakpoint
CREATE TABLE "time_record_absence" (
	"record_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"record_kind" time_record_kind DEFAULT 'absence' NOT NULL,
	"absence_category_id" uuid NOT NULL,
	"start_period" "day_period" DEFAULT 'full_day' NOT NULL,
	"end_period" "day_period" DEFAULT 'full_day' NOT NULL,
	"counts_against_vacation" boolean DEFAULT true NOT NULL,
	CONSTRAINT "timeRecordAbsence_recordKind_absence_chk" CHECK ("time_record_absence"."record_kind" = 'absence')
);
--> statement-breakpoint
CREATE TABLE "time_record_allocation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"record_id" uuid NOT NULL,
	"allocation_kind" time_record_allocation_kind NOT NULL,
	"project_id" uuid,
	"cost_center_id" uuid,
	"weight_percent" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "timeRecordAllocation_kind_target_chk" CHECK ((
				"time_record_allocation"."allocation_kind" = 'project' AND "time_record_allocation"."project_id" IS NOT NULL AND "time_record_allocation"."cost_center_id" IS NULL
			) OR (
				"time_record_allocation"."allocation_kind" = 'cost_center' AND "time_record_allocation"."cost_center_id" IS NOT NULL AND "time_record_allocation"."project_id" IS NULL
			))
);
--> statement-breakpoint
CREATE TABLE "time_record_approval_decision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"record_id" uuid NOT NULL,
	"actor_employee_id" uuid NOT NULL,
	"action" time_record_approval_decision_action NOT NULL,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_record_break" (
	"record_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"record_kind" time_record_kind DEFAULT 'break' NOT NULL,
	"is_paid" boolean DEFAULT false NOT NULL,
	"auto_insert_reason" text,
	CONSTRAINT "timeRecordBreak_recordKind_break_chk" CHECK ("time_record_break"."record_kind" = 'break')
);
--> statement-breakpoint
CREATE TABLE "time_record_work" (
	"record_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"record_kind" time_record_kind DEFAULT 'work' NOT NULL,
	"work_category_id" uuid,
	"work_location_type" "work_location_type",
	"computation_metadata" text,
	CONSTRAINT "timeRecordWork_recordKind_work_chk" CHECK ("time_record_work"."record_kind" = 'work')
);
--> statement-breakpoint
CREATE TABLE "travel_expense_attachment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"storage_provider" text NOT NULL,
	"storage_bucket" text,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text,
	"size_bytes" integer,
	"checksum_sha256" text,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "travel_expense_claim" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"approver_id" uuid,
	"type" "travel_expense_type" NOT NULL,
	"status" "travel_expense_claim_status" DEFAULT 'draft' NOT NULL,
	"trip_start" timestamp NOT NULL,
	"trip_end" timestamp NOT NULL,
	"destination_city" text,
	"destination_country" text,
	"project_id" uuid,
	"original_currency" text NOT NULL,
	"original_amount" numeric(12, 2) NOT NULL,
	"calculated_currency" text NOT NULL,
	"calculated_amount" numeric(12, 2) NOT NULL,
	"notes" text,
	"submitted_at" timestamp,
	"decided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "travel_expense_decision_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"actor_employee_id" uuid NOT NULL,
	"approver_id" uuid,
	"action" "travel_expense_decision_action" NOT NULL,
	"reason" text,
	"comment" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "travel_expense_policy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"effective_from" timestamp NOT NULL,
	"effective_to" timestamp,
	"currency" text NOT NULL,
	"mileage_rate_per_km" numeric(10, 4),
	"per_diem_rate_per_day" numeric(10, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "apikey" RENAME COLUMN "user_id" TO "reference_id";--> statement-breakpoint
ALTER TABLE "apikey" DROP CONSTRAINT "apikey_user_id_user_id_fk";
--> statement-breakpoint
DROP INDEX "apikey_userId_idx";--> statement-breakpoint
ALTER TABLE "apikey" ADD COLUMN "config_id" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "absence_entry" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "absence_entry" ADD COLUMN "canonical_record_id" uuid;--> statement-breakpoint
ALTER TABLE "approval_request" ADD COLUMN "canonical_record_id" uuid;--> statement-breakpoint
ALTER TABLE "work_period" ADD COLUMN "canonical_record_id" uuid;--> statement-breakpoint
ALTER TABLE "time_record" ADD CONSTRAINT "time_record_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_record" ADD CONSTRAINT "time_record_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_record" ADD CONSTRAINT "time_record_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_record" ADD CONSTRAINT "time_record_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_record_absence" ADD CONSTRAINT "time_record_absence_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_record_absence" ADD CONSTRAINT "time_record_absence_absence_category_id_absence_category_id_fk" FOREIGN KEY ("absence_category_id") REFERENCES "public"."absence_category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_record_absence" ADD CONSTRAINT "time_record_absence_record_id_organization_id_time_record_id_organization_id_fk" FOREIGN KEY ("record_id","organization_id") REFERENCES "public"."time_record"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_record_absence" ADD CONSTRAINT "time_record_absence_record_id_record_kind_time_record_id_record_kind_fk" FOREIGN KEY ("record_id","record_kind") REFERENCES "public"."time_record"("id","record_kind") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_record_allocation" ADD CONSTRAINT "time_record_allocation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_record_allocation" ADD CONSTRAINT "time_record_allocation_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_record_allocation" ADD CONSTRAINT "time_record_allocation_cost_center_id_cost_center_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_center"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_record_allocation" ADD CONSTRAINT "timeRecordAllocation_recordId_work_fk" FOREIGN KEY ("record_id") REFERENCES "public"."time_record_work"("record_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_record_allocation" ADD CONSTRAINT "timeRecordAllocation_record_org_fk" FOREIGN KEY ("record_id","organization_id") REFERENCES "public"."time_record"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_record_approval_decision" ADD CONSTRAINT "time_record_approval_decision_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_record_approval_decision" ADD CONSTRAINT "time_record_approval_decision_actor_employee_id_employee_id_fk" FOREIGN KEY ("actor_employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_record_approval_decision" ADD CONSTRAINT "time_record_approval_decision_record_id_organization_id_time_record_id_organization_id_fk" FOREIGN KEY ("record_id","organization_id") REFERENCES "public"."time_record"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_record_break" ADD CONSTRAINT "time_record_break_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_record_break" ADD CONSTRAINT "time_record_break_record_id_organization_id_time_record_id_organization_id_fk" FOREIGN KEY ("record_id","organization_id") REFERENCES "public"."time_record"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_record_break" ADD CONSTRAINT "time_record_break_record_id_record_kind_time_record_id_record_kind_fk" FOREIGN KEY ("record_id","record_kind") REFERENCES "public"."time_record"("id","record_kind") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_record_work" ADD CONSTRAINT "time_record_work_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_record_work" ADD CONSTRAINT "time_record_work_work_category_id_work_category_id_fk" FOREIGN KEY ("work_category_id") REFERENCES "public"."work_category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_record_work" ADD CONSTRAINT "time_record_work_record_id_organization_id_time_record_id_organization_id_fk" FOREIGN KEY ("record_id","organization_id") REFERENCES "public"."time_record"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_record_work" ADD CONSTRAINT "time_record_work_record_id_record_kind_time_record_id_record_kind_fk" FOREIGN KEY ("record_id","record_kind") REFERENCES "public"."time_record"("id","record_kind") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_attachment" ADD CONSTRAINT "travel_expense_attachment_claim_id_travel_expense_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."travel_expense_claim"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_attachment" ADD CONSTRAINT "travel_expense_attachment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_attachment" ADD CONSTRAINT "travel_expense_attachment_uploaded_by_employee_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_claim" ADD CONSTRAINT "travel_expense_claim_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_claim" ADD CONSTRAINT "travel_expense_claim_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_claim" ADD CONSTRAINT "travel_expense_claim_approver_id_employee_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."employee"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_claim" ADD CONSTRAINT "travel_expense_claim_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_claim" ADD CONSTRAINT "travel_expense_claim_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_claim" ADD CONSTRAINT "travel_expense_claim_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_decision_log" ADD CONSTRAINT "travel_expense_decision_log_claim_id_travel_expense_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."travel_expense_claim"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_decision_log" ADD CONSTRAINT "travel_expense_decision_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_decision_log" ADD CONSTRAINT "travel_expense_decision_log_actor_employee_id_employee_id_fk" FOREIGN KEY ("actor_employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_decision_log" ADD CONSTRAINT "travel_expense_decision_log_approver_id_employee_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."employee"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_policy" ADD CONSTRAINT "travel_expense_policy_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_policy" ADD CONSTRAINT "travel_expense_policy_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_policy" ADD CONSTRAINT "travel_expense_policy_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "timeRecord_organizationId_idx" ON "time_record" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "timeRecord_employeeId_idx" ON "time_record" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "timeRecord_recordKind_idx" ON "time_record" USING btree ("record_kind");--> statement-breakpoint
CREATE INDEX "timeRecord_approvalState_idx" ON "time_record" USING btree ("approval_state");--> statement-breakpoint
CREATE INDEX "timeRecord_org_startAt_idx" ON "time_record" USING btree ("organization_id","start_at");--> statement-breakpoint
CREATE INDEX "timeRecord_startAt_idx" ON "time_record" USING btree ("start_at");--> statement-breakpoint
CREATE INDEX "timeRecord_employee_org_startAt_idx" ON "time_record" USING btree ("employee_id","organization_id","start_at");--> statement-breakpoint
CREATE INDEX "timeRecordAbsence_organizationId_idx" ON "time_record_absence" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "timeRecordAbsence_absenceCategoryId_idx" ON "time_record_absence" USING btree ("absence_category_id");--> statement-breakpoint
CREATE INDEX "timeRecordAllocation_organizationId_idx" ON "time_record_allocation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "timeRecordAllocation_recordId_idx" ON "time_record_allocation" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "timeRecordAllocation_projectId_idx" ON "time_record_allocation" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "timeRecordAllocation_costCenterId_idx" ON "time_record_allocation" USING btree ("cost_center_id");--> statement-breakpoint
CREATE INDEX "timeRecordApprovalDecision_organizationId_idx" ON "time_record_approval_decision" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "timeRecordApprovalDecision_recordId_idx" ON "time_record_approval_decision" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "timeRecordApprovalDecision_actorEmployeeId_idx" ON "time_record_approval_decision" USING btree ("actor_employee_id");--> statement-breakpoint
CREATE INDEX "timeRecordApprovalDecision_createdAt_idx" ON "time_record_approval_decision" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "timeRecordBreak_organizationId_idx" ON "time_record_break" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "timeRecordWork_organizationId_idx" ON "time_record_work" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "timeRecordWork_workCategoryId_idx" ON "time_record_work" USING btree ("work_category_id");--> statement-breakpoint
CREATE INDEX "travelExpenseAttachment_claimId_idx" ON "travel_expense_attachment" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "travelExpenseAttachment_organizationId_idx" ON "travel_expense_attachment" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "travelExpenseAttachment_uploadedBy_idx" ON "travel_expense_attachment" USING btree ("uploaded_by");--> statement-breakpoint
CREATE UNIQUE INDEX "travelExpenseAttachment_claim_storageKey_idx" ON "travel_expense_attachment" USING btree ("claim_id","storage_key");--> statement-breakpoint
CREATE INDEX "travelExpenseClaim_organizationId_idx" ON "travel_expense_claim" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "travelExpenseClaim_employeeId_idx" ON "travel_expense_claim" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "travelExpenseClaim_approverId_idx" ON "travel_expense_claim" USING btree ("approver_id");--> statement-breakpoint
CREATE INDEX "travelExpenseClaim_projectId_idx" ON "travel_expense_claim" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "travelExpenseClaim_status_idx" ON "travel_expense_claim" USING btree ("status");--> statement-breakpoint
CREATE INDEX "travelExpenseClaim_type_idx" ON "travel_expense_claim" USING btree ("type");--> statement-breakpoint
CREATE INDEX "travelExpenseClaim_tripStart_idx" ON "travel_expense_claim" USING btree ("trip_start");--> statement-breakpoint
CREATE INDEX "travelExpenseClaim_submittedAt_idx" ON "travel_expense_claim" USING btree ("submitted_at");--> statement-breakpoint
CREATE INDEX "travelExpenseDecisionLog_claimId_idx" ON "travel_expense_decision_log" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "travelExpenseDecisionLog_organizationId_idx" ON "travel_expense_decision_log" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "travelExpenseDecisionLog_actorEmployeeId_idx" ON "travel_expense_decision_log" USING btree ("actor_employee_id");--> statement-breakpoint
CREATE INDEX "travelExpenseDecisionLog_approverId_idx" ON "travel_expense_decision_log" USING btree ("approver_id");--> statement-breakpoint
CREATE INDEX "travelExpenseDecisionLog_createdAt_idx" ON "travel_expense_decision_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "travelExpensePolicy_organizationId_idx" ON "travel_expense_policy" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "travelExpensePolicy_effectiveFrom_idx" ON "travel_expense_policy" USING btree ("effective_from");--> statement-breakpoint
CREATE INDEX "travelExpensePolicy_effectiveTo_idx" ON "travel_expense_policy" USING btree ("effective_to");--> statement-breakpoint
CREATE INDEX "travelExpensePolicy_isActive_idx" ON "travel_expense_policy" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "travelExpensePolicy_org_active_idx" ON "travel_expense_policy" USING btree ("organization_id") WHERE is_active = true;--> statement-breakpoint
ALTER TABLE "absence_entry" ADD CONSTRAINT "absence_entry_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absence_entry" ADD CONSTRAINT "absence_entry_canonical_record_id_organization_id_time_record_id_organization_id_fk" FOREIGN KEY ("canonical_record_id","organization_id") REFERENCES "public"."time_record"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_canonical_record_id_organization_id_time_record_id_organization_id_fk" FOREIGN KEY ("canonical_record_id","organization_id") REFERENCES "public"."time_record"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_period" ADD CONSTRAINT "work_period_canonical_record_id_organization_id_time_record_id_organization_id_fk" FOREIGN KEY ("canonical_record_id","organization_id") REFERENCES "public"."time_record"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "apikey_configId_idx" ON "apikey" USING btree ("config_id");--> statement-breakpoint
CREATE INDEX "apikey_referenceId_idx" ON "apikey" USING btree ("reference_id");--> statement-breakpoint
CREATE INDEX "absenceEntry_org_canonicalRecordId_idx" ON "absence_entry" USING btree ("organization_id","canonical_record_id");--> statement-breakpoint
CREATE INDEX "approvalRequest_org_canonicalRecordId_idx" ON "approval_request" USING btree ("organization_id","canonical_record_id");--> statement-breakpoint
CREATE INDEX "workPeriod_org_canonicalRecordId_idx" ON "work_period" USING btree ("organization_id","canonical_record_id");