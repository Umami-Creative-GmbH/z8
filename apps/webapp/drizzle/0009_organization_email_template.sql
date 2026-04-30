CREATE TYPE "public"."employment_review_state" AS ENUM('draft', 'pending', 'confirmed');--> statement-breakpoint
CREATE TYPE "public"."employment_status" AS ENUM('active', 'inactive', 'terminated', 'leave');--> statement-breakpoint
CREATE TYPE "public"."work_model" AS ENUM('onsite', 'hybrid', 'remote', 'flexible');--> statement-breakpoint
CREATE TABLE "organization_email_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"template_key" text NOT NULL,
	"subject" text NOT NULL,
	"editor_document" jsonb NOT NULL,
	"html" text NOT NULL,
	"plain_text" text,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_employment_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"valid_from" timestamp NOT NULL,
	"valid_until" timestamp,
	"status" "employment_status" DEFAULT 'active' NOT NULL,
	"contract_type" "contract_type" DEFAULT 'fixed' NOT NULL,
	"weekly_contract_minutes" integer NOT NULL,
	"probation_starts_on" timestamp,
	"probation_ends_on" timestamp,
	"work_model" "work_model" DEFAULT 'onsite' NOT NULL,
	"work_policy_id" uuid,
	"hourly_rate" text,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"change_reason" text,
	"review_state" "employment_review_state" DEFAULT 'draft' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
DROP INDEX "workPolicyAssignment_employee_idx";--> statement-breakpoint
ALTER TABLE "absence_category" ALTER COLUMN "updated_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "organization_email_template" ADD CONSTRAINT "organization_email_template_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_email_template" ADD CONSTRAINT "organization_email_template_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_email_template" ADD CONSTRAINT "organization_email_template_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_employment_history" ADD CONSTRAINT "employee_employment_history_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_employment_history" ADD CONSTRAINT "employee_employment_history_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_employment_history" ADD CONSTRAINT "employee_employment_history_work_policy_id_work_policy_id_fk" FOREIGN KEY ("work_policy_id") REFERENCES "public"."work_policy"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_employment_history" ADD CONSTRAINT "employee_employment_history_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_employment_history" ADD CONSTRAINT "employee_employment_history_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organizationEmailTemplate_org_template_idx" ON "organization_email_template" USING btree ("organization_id","template_key");--> statement-breakpoint
CREATE INDEX "organizationEmailTemplate_organizationId_idx" ON "organization_email_template" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "employeeEmploymentHistory_employeeId_idx" ON "employee_employment_history" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "employeeEmploymentHistory_organizationId_idx" ON "employee_employment_history" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "employeeEmploymentHistory_employee_validFrom_idx" ON "employee_employment_history" USING btree ("employee_id","valid_from");--> statement-breakpoint
CREATE INDEX "employeeEmploymentHistory_employee_reviewState_idx" ON "employee_employment_history" USING btree ("employee_id","review_state");--> statement-breakpoint
CREATE INDEX "employeeEmploymentHistory_workPolicyId_idx" ON "employee_employment_history" USING btree ("work_policy_id");--> statement-breakpoint
CREATE INDEX "workPolicyAssignment_employee_effective_idx" ON "work_policy_assignment" USING btree ("employee_id","effective_from","effective_until");--> statement-breakpoint
CREATE INDEX "workPolicyAssignment_employee_active_idx" ON "work_policy_assignment" USING btree ("employee_id","is_active");