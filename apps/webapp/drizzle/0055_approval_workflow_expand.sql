-- daily digest recovery: begin
-- 0051_daily_digest_delivery.sql was never journaled. Recover both supported states:
-- a complete historical table is left unchanged; an absent table is created in full.
CREATE TABLE IF NOT EXISTS "daily_digest_delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"recipient_user_id" text NOT NULL,
	"platform" text NOT NULL,
	"type" text NOT NULL,
	"recipient_local_date" date NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"attempted_at" timestamp DEFAULT now() NOT NULL,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "daily_digest_delivery_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "daily_digest_delivery_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "daily_digest_delivery_status_check" CHECK ("status" IN ('processing', 'sent', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dailyDigestDelivery_recipient_date_unique_idx" ON "daily_digest_delivery" USING btree ("organization_id","recipient_user_id","platform","type","recipient_local_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dailyDigestDelivery_organization_status_idx" ON "daily_digest_delivery" USING btree ("organization_id","status");
--> statement-breakpoint
-- daily digest recovery: end
CREATE TYPE "public"."approval_actor_kind" AS ENUM('employee', 'system', 'legacy_unknown');--> statement-breakpoint
CREATE TYPE "public"."approval_assignment_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."approval_command_state" AS ENUM('reserved', 'completed');--> statement-breakpoint
CREATE TYPE "public"."approval_outbox_channel" AS ENUM('in_app', 'push', 'email', 'webhook', 'teams', 'telegram', 'discord', 'slack');--> statement-breakpoint
CREATE TYPE "public"."approval_outbox_disposition" AS ENUM('observe', 'deliver');--> statement-breakpoint
CREATE TYPE "public"."approval_outbox_expansion_status" AS ENUM('pending', 'expanded');--> statement-breakpoint
CREATE TYPE "public"."approval_outbox_status" AS ENUM('pending', 'processing', 'delivered', 'failed', 'suppressed');--> statement-breakpoint
CREATE TYPE "public"."approval_side_effect_mode" AS ENUM('legacy', 'canonical');--> statement-breakpoint
CREATE TYPE "public"."approval_stage_status" AS ENUM('waiting', 'pending', 'approved', 'rejected', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."approval_workflow_lifecycle_mode" AS ENUM('legacy', 'shadow', 'ready', 'canonical', 'complete');--> statement-breakpoint
CREATE TYPE "public"."approval_workflow_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."approval_workflow_type" AS ENUM('absence', 'time_correction', 'manual_time_submission', 'policy_clock_out', 'travel_expense', 'shift_request', 'compliance_exception');--> statement-breakpoint
CREATE TYPE "public"."shift_request_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TABLE "approval_inbox_projection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"workflow_id" uuid NOT NULL,
	"active_stage_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"status" "approval_workflow_status" NOT NULL,
	"display_payload" jsonb NOT NULL,
	"search_text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"workflow_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"disposition" "approval_outbox_disposition" NOT NULL,
	"expansion_status" "approval_outbox_expansion_status" DEFAULT 'pending' NOT NULL,
	"expanded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approvalOutbox_id_organizationId_idx" UNIQUE("id","organization_id"),
	CONSTRAINT "approvalOutbox_id_organizationId_disposition_idx" UNIQUE("id","organization_id","disposition")
);
--> statement-breakpoint
CREATE TABLE "approval_outbox_delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"outbox_id" uuid NOT NULL,
	"dedupe_key" text NOT NULL,
	"disposition" "approval_outbox_disposition" NOT NULL,
	"status" "approval_outbox_status" DEFAULT 'pending' NOT NULL,
	"channel" "approval_outbox_channel" NOT NULL,
	"recipient_kind" text NOT NULL,
	"recipient_employee_id" uuid,
	"recipient_address" text,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"claim_token" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"processed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_requester_projection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"workflow_id" uuid NOT NULL,
	"requester_employee_id" uuid,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"status" "approval_workflow_status" NOT NULL,
	"current_stage_order" integer,
	"display_payload" jsonb NOT NULL,
	"search_text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_stage_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"workflow_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"assignment_sequence" integer NOT NULL,
	"approver_employee_id" uuid NOT NULL,
	"status" "approval_assignment_status" DEFAULT 'pending' NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_actor_kind" "approval_actor_kind",
	"resolved_by_actor_id" uuid,
	"reassigned_by_employee_id" uuid,
	"reassigned_from_assignment_id" uuid,
	"reassignment_metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "approvalStageAssignment_id_organizationId_idx" UNIQUE("id","organization_id"),
	CONSTRAINT "approvalStageAssignment_workflow_stage_id_organizationId_idx" UNIQUE("workflow_id","stage_id","id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "approval_workflow" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"workflow_type" "approval_workflow_type" NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"requester_employee_id" uuid,
	"status" "approval_workflow_status" DEFAULT 'pending' NOT NULL,
	"current_stage_order" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"policy_snapshot" jsonb NOT NULL,
	"context_snapshot" jsonb NOT NULL,
	"display_snapshot" jsonb NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"decision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "approvalWorkflow_id_organizationId_idx" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "approval_workflow_command" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"workflow_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"actor_fingerprint" text NOT NULL,
	"command_fingerprint" text NOT NULL,
	"state" "approval_command_state" DEFAULT 'reserved' NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_workflow_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"workflow_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"event_index" integer NOT NULL,
	"event_type" text NOT NULL,
	"actor_kind" "approval_actor_kind" NOT NULL,
	"actor_employee_id" uuid,
	"actor_user_id" text,
	"previous_state" jsonb,
	"resulting_state" jsonb NOT NULL,
	"reason" text,
	"metadata" jsonb,
	"idempotency_key" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approvalWorkflowEvent_id_organizationId_idx" UNIQUE("id","organization_id"),
	CONSTRAINT "approvalWorkflowEvent_workflow_id_organizationId_idx" UNIQUE("workflow_id","id","organization_id"),
	CONSTRAINT "approvalWorkflowEvent_workflow_id_organizationId_eventType_idx" UNIQUE("workflow_id","id","organization_id","event_type")
);
--> statement-breakpoint
CREATE TABLE "approval_workflow_migration_issue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"workflow_id" uuid,
	"workflow_type" "approval_workflow_type" NOT NULL,
	"legacy_type" text,
	"legacy_id" uuid,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"issue_code" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"disposition" text DEFAULT 'open' NOT NULL,
	"operator_user_id" text,
	"disposed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_workflow_rollout" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"workflow_type" "approval_workflow_type" NOT NULL,
	"lifecycle_mode" "approval_workflow_lifecycle_mode" DEFAULT 'legacy' NOT NULL,
	"side_effect_mode" "approval_side_effect_mode" DEFAULT 'legacy' NOT NULL,
	"backfilled_through" timestamp with time zone,
	"mismatch_count" integer DEFAULT 0 NOT NULL,
	"last_reconciled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_workflow_stage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"workflow_id" uuid NOT NULL,
	"stage_order" integer NOT NULL,
	"label" text NOT NULL,
	"resolver_snapshot" jsonb NOT NULL,
	"activation_mode" text NOT NULL,
	"status" "approval_stage_status" DEFAULT 'waiting' NOT NULL,
	"activated_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"legacy_approval_request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "approvalWorkflowStage_id_organizationId_idx" UNIQUE("id","organization_id"),
	CONSTRAINT "approvalWorkflowStage_workflow_id_organizationId_idx" UNIQUE("workflow_id","id","organization_id")
);
--> statement-breakpoint
ALTER TABLE "absence_entry" DROP CONSTRAINT "absence_entry_organization_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "absence_entry" ADD COLUMN "approval_workflow_id" uuid;--> statement-breakpoint
ALTER TABLE "compliance_exception" ADD COLUMN "approval_workflow_id" uuid;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "shift_request" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "shift_request" ADD COLUMN "lifecycle_status" "shift_request_status";--> statement-breakpoint
ALTER TABLE "shift_request" ADD COLUMN "approval_workflow_id" uuid;--> statement-breakpoint
ALTER TABLE "work_period" ADD COLUMN "approval_workflow_id" uuid;--> statement-breakpoint
ALTER TABLE "travel_expense_claim" ADD COLUMN "approval_workflow_id" uuid;--> statement-breakpoint
ALTER TABLE "approval_inbox_projection" ADD CONSTRAINT "approval_inbox_projection_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_inbox_projection" ADD CONSTRAINT "approval_inbox_projection_workflow_id_active_stage_id_organization_id_approval_workflow_stage_workflow_id_id_organization_id_fk" FOREIGN KEY ("workflow_id","active_stage_id","organization_id") REFERENCES "public"."approval_workflow_stage"("workflow_id","id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_outbox" ADD CONSTRAINT "approval_outbox_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_outbox" ADD CONSTRAINT "approval_outbox_workflow_id_event_id_organization_id_event_type_approval_workflow_event_workflow_id_id_organization_id_event_type_fk" FOREIGN KEY ("workflow_id","event_id","organization_id","event_type") REFERENCES "public"."approval_workflow_event"("workflow_id","id","organization_id","event_type") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_outbox_delivery" ADD CONSTRAINT "approval_outbox_delivery_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_outbox_delivery" ADD CONSTRAINT "approval_outbox_delivery_outbox_id_organization_id_disposition_approval_outbox_id_organization_id_disposition_fk" FOREIGN KEY ("outbox_id","organization_id","disposition") REFERENCES "public"."approval_outbox"("id","organization_id","disposition") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_outbox_delivery" ADD CONSTRAINT "approval_outbox_delivery_recipient_employee_id_organization_id_employee_id_organization_id_fk" FOREIGN KEY ("recipient_employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requester_projection" ADD CONSTRAINT "approval_requester_projection_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requester_projection" ADD CONSTRAINT "approval_requester_projection_workflow_id_organization_id_approval_workflow_id_organization_id_fk" FOREIGN KEY ("workflow_id","organization_id") REFERENCES "public"."approval_workflow"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requester_projection" ADD CONSTRAINT "approval_requester_projection_requester_employee_id_organization_id_employee_id_organization_id_fk" FOREIGN KEY ("requester_employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_stage_assignment" ADD CONSTRAINT "approval_stage_assignment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_stage_assignment" ADD CONSTRAINT "approval_stage_assignment_workflow_id_stage_id_organization_id_approval_workflow_stage_workflow_id_id_organization_id_fk" FOREIGN KEY ("workflow_id","stage_id","organization_id") REFERENCES "public"."approval_workflow_stage"("workflow_id","id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_stage_assignment" ADD CONSTRAINT "approval_stage_assignment_approver_employee_id_organization_id_employee_id_organization_id_fk" FOREIGN KEY ("approver_employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_stage_assignment" ADD CONSTRAINT "approval_stage_assignment_resolved_by_actor_id_organization_id_employee_id_organization_id_fk" FOREIGN KEY ("resolved_by_actor_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_stage_assignment" ADD CONSTRAINT "approval_stage_assignment_reassigned_by_employee_id_organization_id_employee_id_organization_id_fk" FOREIGN KEY ("reassigned_by_employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_stage_assignment" ADD CONSTRAINT "approval_stage_assignment_workflow_id_stage_id_reassigned_from_assignment_id_organization_id_approval_stage_assignment_workflow_id_stage_id_id_organization_id_fk" FOREIGN KEY ("workflow_id","stage_id","reassigned_from_assignment_id","organization_id") REFERENCES "public"."approval_stage_assignment"("workflow_id","stage_id","id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_workflow" ADD CONSTRAINT "approval_workflow_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_workflow" ADD CONSTRAINT "approval_workflow_requester_employee_id_organization_id_employee_id_organization_id_fk" FOREIGN KEY ("requester_employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_workflow_command" ADD CONSTRAINT "approval_workflow_command_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_workflow_command" ADD CONSTRAINT "approval_workflow_command_workflow_id_organization_id_approval_workflow_id_organization_id_fk" FOREIGN KEY ("workflow_id","organization_id") REFERENCES "public"."approval_workflow"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_workflow_event" ADD CONSTRAINT "approval_workflow_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_workflow_event" ADD CONSTRAINT "approval_workflow_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_workflow_event" ADD CONSTRAINT "approval_workflow_event_workflow_id_organization_id_approval_workflow_id_organization_id_fk" FOREIGN KEY ("workflow_id","organization_id") REFERENCES "public"."approval_workflow"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_workflow_event" ADD CONSTRAINT "approval_workflow_event_actor_employee_id_organization_id_employee_id_organization_id_fk" FOREIGN KEY ("actor_employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_workflow_migration_issue" ADD CONSTRAINT "approval_workflow_migration_issue_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_workflow_migration_issue" ADD CONSTRAINT "approval_workflow_migration_issue_operator_user_id_user_id_fk" FOREIGN KEY ("operator_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_workflow_migration_issue" ADD CONSTRAINT "approval_workflow_migration_issue_workflow_id_organization_id_approval_workflow_id_organization_id_fk" FOREIGN KEY ("workflow_id","organization_id") REFERENCES "public"."approval_workflow"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_workflow_rollout" ADD CONSTRAINT "approval_workflow_rollout_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_workflow_stage" ADD CONSTRAINT "approval_workflow_stage_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_workflow_stage" ADD CONSTRAINT "approval_workflow_stage_workflow_id_organization_id_approval_workflow_id_organization_id_fk" FOREIGN KEY ("workflow_id","organization_id") REFERENCES "public"."approval_workflow"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approvalInboxProjection_org_workflow_stage_idx" ON "approval_inbox_projection" USING btree ("organization_id","workflow_id","active_stage_id");--> statement-breakpoint
CREATE INDEX "approvalInboxProjection_org_status_idx" ON "approval_inbox_projection" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "approvalOutbox_org_dedupe_idx" ON "approval_outbox" USING btree ("organization_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "approvalOutbox_org_createdAt_idx" ON "approval_outbox" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "approvalOutbox_pendingExpansion_createdAt_idx" ON "approval_outbox" USING btree ("expansion_status","created_at") WHERE expansion_status = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "approvalOutboxDelivery_org_dedupe_idx" ON "approval_outbox_delivery" USING btree ("organization_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "approvalOutboxDelivery_status_available_idx" ON "approval_outbox_delivery" USING btree ("status","available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "approvalRequesterProjection_org_workflow_idx" ON "approval_requester_projection" USING btree ("organization_id","workflow_id");--> statement-breakpoint
CREATE INDEX "approvalRequesterProjection_org_requester_status_idx" ON "approval_requester_projection" USING btree ("organization_id","requester_employee_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "approvalStageAssignment_org_workflow_stage_sequence_idx" ON "approval_stage_assignment" USING btree ("organization_id","workflow_id","stage_id","assignment_sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "approvalStageAssignment_org_workflow_stage_pending_approver_idx" ON "approval_stage_assignment" USING btree ("organization_id","workflow_id","stage_id","approver_employee_id") WHERE status = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "approvalWorkflow_org_source_pending_idx" ON "approval_workflow" USING btree ("organization_id","source_type","source_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "approvalWorkflow_org_status_idx" ON "approval_workflow" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "approvalWorkflowCommand_org_workflow_idempotency_idx" ON "approval_workflow_command" USING btree ("organization_id","workflow_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "approvalWorkflowEvent_org_workflow_version_index_idx" ON "approval_workflow_event" USING btree ("organization_id","workflow_id","version","event_index");--> statement-breakpoint
CREATE UNIQUE INDEX "approvalWorkflowEvent_org_idempotency_idx" ON "approval_workflow_event" USING btree ("organization_id","idempotency_key") WHERE idempotency_key IS NOT NULL;--> statement-breakpoint
CREATE INDEX "approvalWorkflowMigrationIssue_org_type_disposition_idx" ON "approval_workflow_migration_issue" USING btree ("organization_id","workflow_type","disposition");--> statement-breakpoint
CREATE UNIQUE INDEX "approvalWorkflowRollout_org_type_idx" ON "approval_workflow_rollout" USING btree ("organization_id","workflow_type");--> statement-breakpoint
CREATE UNIQUE INDEX "approvalWorkflowStage_org_workflow_order_idx" ON "approval_workflow_stage" USING btree ("organization_id","workflow_id","stage_order");--> statement-breakpoint
ALTER TABLE "absence_entry" ADD CONSTRAINT "absence_entry_approval_workflow_id_organization_id_approval_workflow_id_organization_id_fk" FOREIGN KEY ("approval_workflow_id","organization_id") REFERENCES "public"."approval_workflow"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absence_entry" ADD CONSTRAINT "absence_entry_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_exception" ADD CONSTRAINT "compliance_exception_approval_workflow_id_organization_id_approval_workflow_id_organization_id_fk" FOREIGN KEY ("approval_workflow_id","organization_id") REFERENCES "public"."approval_workflow"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_request" ADD CONSTRAINT "shift_request_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_request" ADD CONSTRAINT "shift_request_approval_workflow_id_organization_id_approval_workflow_id_organization_id_fk" FOREIGN KEY ("approval_workflow_id","organization_id") REFERENCES "public"."approval_workflow"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift" ADD CONSTRAINT "shift_organizationId_id_idx" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "shift_request" ADD CONSTRAINT "shift_request_organization_id_shift_id_shift_organization_id_id_fk" FOREIGN KEY ("organization_id","shift_id") REFERENCES "public"."shift"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_period" ADD CONSTRAINT "work_period_approval_workflow_id_organization_id_approval_workflow_id_organization_id_fk" FOREIGN KEY ("approval_workflow_id","organization_id") REFERENCES "public"."approval_workflow"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_claim" ADD CONSTRAINT "travel_expense_claim_approval_workflow_id_organization_id_approval_workflow_id_organization_id_fk" FOREIGN KEY ("approval_workflow_id","organization_id") REFERENCES "public"."approval_workflow"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "absenceEntry_org_approvalWorkflowId_idx" ON "absence_entry" USING btree ("organization_id","approval_workflow_id");--> statement-breakpoint
CREATE INDEX "complianceException_org_approvalWorkflowId_idx" ON "compliance_exception" USING btree ("organization_id","approval_workflow_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_org_idempotencyKey_idx" ON "notification" USING btree ("organization_id","idempotency_key") WHERE idempotency_key IS NOT NULL;--> statement-breakpoint
CREATE INDEX "shiftRequest_org_approvalWorkflowId_idx" ON "shift_request" USING btree ("organization_id","approval_workflow_id");--> statement-breakpoint
CREATE INDEX "workPeriod_org_approvalWorkflowId_idx" ON "work_period" USING btree ("organization_id","approval_workflow_id");--> statement-breakpoint
CREATE INDEX "travelExpenseClaim_org_approvalWorkflowId_idx" ON "travel_expense_claim" USING btree ("organization_id","approval_workflow_id");--> statement-breakpoint
ALTER TABLE "absence_entry" ADD CONSTRAINT "absence_entry_approval_workflow_organization_check" CHECK ("absence_entry"."approval_workflow_id" IS NULL OR "absence_entry"."organization_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "shift_request" ADD CONSTRAINT "shift_request_approval_workflow_organization_check" CHECK ("shift_request"."approval_workflow_id" IS NULL OR "shift_request"."organization_id" IS NOT NULL);
