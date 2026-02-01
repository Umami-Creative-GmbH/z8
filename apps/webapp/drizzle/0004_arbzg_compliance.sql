-- ArbZG Compliance: New enums for rest period enforcement and compliance exceptions
CREATE TYPE "public"."rest_period_enforcement" AS ENUM('block', 'warn', 'none');--> statement-breakpoint
CREATE TYPE "public"."compliance_exception_type" AS ENUM('rest_period', 'overtime_daily', 'overtime_weekly', 'overtime_monthly');--> statement-breakpoint
CREATE TYPE "public"."compliance_exception_status" AS ENUM('pending', 'approved', 'rejected', 'expired', 'used');--> statement-breakpoint

-- Extend time_regulation_violation_type enum with new ArbZG violation types
ALTER TYPE "public"."time_regulation_violation_type" ADD VALUE 'rest_period';--> statement-breakpoint
ALTER TYPE "public"."time_regulation_violation_type" ADD VALUE 'overtime_daily';--> statement-breakpoint
ALTER TYPE "public"."time_regulation_violation_type" ADD VALUE 'overtime_weekly';--> statement-breakpoint
ALTER TYPE "public"."time_regulation_violation_type" ADD VALUE 'overtime_monthly';--> statement-breakpoint

-- Extend notification_type enum with compliance-related notifications
ALTER TYPE "public"."notification_type" ADD VALUE 'rest_period_warning';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'rest_period_violation';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'overtime_warning';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'overtime_violation';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'compliance_exception_requested';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'compliance_exception_approved';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'compliance_exception_rejected';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'compliance_exception_expired';--> statement-breakpoint

-- Add ArbZG compliance columns to work_policy_regulation
ALTER TABLE "work_policy_regulation" ADD COLUMN "min_rest_period_minutes" integer;--> statement-breakpoint
ALTER TABLE "work_policy_regulation" ADD COLUMN "rest_period_enforcement" "rest_period_enforcement" DEFAULT 'warn';--> statement-breakpoint
ALTER TABLE "work_policy_regulation" ADD COLUMN "overtime_daily_threshold_minutes" integer;--> statement-breakpoint
ALTER TABLE "work_policy_regulation" ADD COLUMN "overtime_weekly_threshold_minutes" integer;--> statement-breakpoint
ALTER TABLE "work_policy_regulation" ADD COLUMN "overtime_monthly_threshold_minutes" integer;--> statement-breakpoint
ALTER TABLE "work_policy_regulation" ADD COLUMN "alert_before_limit_minutes" integer DEFAULT 30;--> statement-breakpoint
ALTER TABLE "work_policy_regulation" ADD COLUMN "alert_threshold_percent" integer DEFAULT 80;--> statement-breakpoint

-- Create compliance_exception table for pre-approval and post-hoc exception tracking
CREATE TABLE "compliance_exception" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"exception_type" "compliance_exception_type" NOT NULL,
	"status" "compliance_exception_status" DEFAULT 'pending' NOT NULL,
	"reason" text NOT NULL,
	"planned_duration_minutes" integer,
	"actual_duration_minutes" integer,
	"valid_from" timestamp DEFAULT now() NOT NULL,
	"valid_until" timestamp NOT NULL,
	"approver_id" uuid,
	"approved_at" timestamp,
	"rejection_reason" text,
	"was_used" boolean DEFAULT false NOT NULL,
	"work_period_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

-- Add foreign key constraints
ALTER TABLE "compliance_exception" ADD CONSTRAINT "compliance_exception_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_exception" ADD CONSTRAINT "compliance_exception_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_exception" ADD CONSTRAINT "compliance_exception_approver_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."employee"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_exception" ADD CONSTRAINT "compliance_exception_work_period_id_fk" FOREIGN KEY ("work_period_id") REFERENCES "public"."work_period"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_exception" ADD CONSTRAINT "compliance_exception_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- Create indexes for efficient querying
CREATE INDEX "complianceException_organizationId_idx" ON "compliance_exception" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "complianceException_employeeId_idx" ON "compliance_exception" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "complianceException_status_idx" ON "compliance_exception" USING btree ("status");--> statement-breakpoint
CREATE INDEX "complianceException_employeeId_status_idx" ON "compliance_exception" USING btree ("employee_id", "status");--> statement-breakpoint
CREATE INDEX "complianceException_organizationId_status_idx" ON "compliance_exception" USING btree ("organization_id", "status");--> statement-breakpoint
CREATE INDEX "complianceException_validUntil_idx" ON "compliance_exception" USING btree ("valid_until");
