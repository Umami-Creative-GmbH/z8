ALTER TYPE "public"."notification_type" ADD VALUE 'shift_pickup_requested' BEFORE 'shift_pickup_approved';--> statement-breakpoint
CREATE TABLE "cron_schedule_override" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_name" varchar(100) NOT NULL,
	"preset_id" varchar(100) NOT NULL,
	"pattern" varchar(100) NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holiday_category_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"assignment_type" "holiday_preset_assignment_type" NOT NULL,
	"team_id" uuid,
	"employee_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "holidayCategoryAssignment_target_shape_chk" CHECK ((
				"holiday_category_assignment"."assignment_type" = 'organization'
				AND "holiday_category_assignment"."team_id" IS NULL
				AND "holiday_category_assignment"."employee_id" IS NULL
			) OR (
				"holiday_category_assignment"."assignment_type" = 'team'
				AND "holiday_category_assignment"."team_id" IS NOT NULL
				AND "holiday_category_assignment"."employee_id" IS NULL
			) OR (
				"holiday_category_assignment"."assignment_type" = 'employee'
				AND "holiday_category_assignment"."employee_id" IS NOT NULL
				AND "holiday_category_assignment"."team_id" IS NULL
			))
);
--> statement-breakpoint
CREATE TABLE "payroll_access_employee" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"grant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_access_grant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"payroll_employee_id" uuid NOT NULL,
	"scope" text DEFAULT 'specific' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp NOT NULL,
	"updated_by" text,
	CONSTRAINT "payrollAccessGrant_id_organizationId_idx" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "payroll_access_team" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"grant_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
DROP INDEX "workPolicyPreset_system_name_idx";--> statement-breakpoint
DROP INDEX "workPolicyPreset_org_name_idx";--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "target_team_id" text;--> statement-breakpoint
ALTER TABLE "organization_email_config" ADD COLUMN "smtp_ip_mode" text DEFAULT 'auto';--> statement-breakpoint
ALTER TABLE "work_period" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "work_period" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "work_period" ADD COLUMN "deletion_reason" text;--> statement-breakpoint
ALTER TABLE "work_period" ADD COLUMN "deletion_approval_request_id" uuid;--> statement-breakpoint
ALTER TABLE "cron_schedule_override" ADD CONSTRAINT "cron_schedule_override_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_category_assignment" ADD CONSTRAINT "holiday_category_assignment_category_id_holiday_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."holiday_category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_category_assignment" ADD CONSTRAINT "holiday_category_assignment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_category_assignment" ADD CONSTRAINT "holiday_category_assignment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_category_assignment" ADD CONSTRAINT "holiday_category_assignment_team_id_organization_id_team_id_organization_id_fk" FOREIGN KEY ("team_id","organization_id") REFERENCES "public"."team"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_category_assignment" ADD CONSTRAINT "holiday_category_assignment_employee_id_organization_id_employee_id_organization_id_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_access_employee" ADD CONSTRAINT "payroll_access_employee_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_access_employee" ADD CONSTRAINT "payroll_access_employee_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_access_employee" ADD CONSTRAINT "payroll_access_employee_grant_id_organization_id_payroll_access_grant_id_organization_id_fk" FOREIGN KEY ("grant_id","organization_id") REFERENCES "public"."payroll_access_grant"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_access_employee" ADD CONSTRAINT "payroll_access_employee_employee_id_organization_id_employee_id_organization_id_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_access_grant" ADD CONSTRAINT "payroll_access_grant_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_access_grant" ADD CONSTRAINT "payroll_access_grant_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_access_grant" ADD CONSTRAINT "payroll_access_grant_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_access_grant" ADD CONSTRAINT "payroll_access_grant_payroll_employee_id_organization_id_employee_id_organization_id_fk" FOREIGN KEY ("payroll_employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_access_team" ADD CONSTRAINT "payroll_access_team_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_access_team" ADD CONSTRAINT "payroll_access_team_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_access_team" ADD CONSTRAINT "payroll_access_team_grant_id_organization_id_payroll_access_grant_id_organization_id_fk" FOREIGN KEY ("grant_id","organization_id") REFERENCES "public"."payroll_access_grant"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_access_team" ADD CONSTRAINT "payroll_access_team_team_id_organization_id_team_id_organization_id_fk" FOREIGN KEY ("team_id","organization_id") REFERENCES "public"."team"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_cron_schedule_override_job_name_unique" ON "cron_schedule_override" USING btree ("job_name");--> statement-breakpoint
CREATE INDEX "idx_cron_schedule_override_updated_by" ON "cron_schedule_override" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "holidayCategoryAssignment_categoryId_idx" ON "holiday_category_assignment" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "holidayCategoryAssignment_organizationId_idx" ON "holiday_category_assignment" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "holidayCategoryAssignment_teamId_idx" ON "holiday_category_assignment" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "holidayCategoryAssignment_employeeId_idx" ON "holiday_category_assignment" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "holidayCategoryAssignment_category_org_idx" ON "holiday_category_assignment" USING btree ("category_id","organization_id","assignment_type") WHERE assignment_type = 'organization' AND is_active = true;--> statement-breakpoint
CREATE UNIQUE INDEX "holidayCategoryAssignment_category_team_idx" ON "holiday_category_assignment" USING btree ("category_id","team_id") WHERE team_id IS NOT NULL AND is_active = true;--> statement-breakpoint
CREATE UNIQUE INDEX "holidayCategoryAssignment_category_employee_idx" ON "holiday_category_assignment" USING btree ("category_id","employee_id") WHERE employee_id IS NOT NULL AND is_active = true;--> statement-breakpoint
CREATE INDEX "payrollAccessEmployee_organizationId_idx" ON "payroll_access_employee" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "payrollAccessEmployee_grantId_idx" ON "payroll_access_employee" USING btree ("grant_id");--> statement-breakpoint
CREATE INDEX "payrollAccessEmployee_employeeId_idx" ON "payroll_access_employee" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payrollAccessEmployee_grant_employee_idx" ON "payroll_access_employee" USING btree ("grant_id","employee_id");--> statement-breakpoint
CREATE INDEX "payrollAccessGrant_organizationId_idx" ON "payroll_access_grant" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "payrollAccessGrant_payrollEmployeeId_idx" ON "payroll_access_grant" USING btree ("payroll_employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payrollAccessGrant_active_employee_idx" ON "payroll_access_grant" USING btree ("organization_id","payroll_employee_id") WHERE is_active = true;--> statement-breakpoint
CREATE INDEX "payrollAccessTeam_organizationId_idx" ON "payroll_access_team" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "payrollAccessTeam_grantId_idx" ON "payroll_access_team" USING btree ("grant_id");--> statement-breakpoint
CREATE INDEX "payrollAccessTeam_teamId_idx" ON "payroll_access_team" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payrollAccessTeam_grant_team_idx" ON "payroll_access_team" USING btree ("grant_id","team_id");--> statement-breakpoint
ALTER TABLE "work_period" ADD CONSTRAINT "work_period_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_period" ADD CONSTRAINT "work_period_deletion_approval_request_id_organization_id_approval_request_id_organization_id_fk" FOREIGN KEY ("deletion_approval_request_id","organization_id") REFERENCES "public"."approval_request"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workPeriod_org_deletedAt_idx" ON "work_period" USING btree ("organization_id","deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workPolicyPreset_system_name_idx" ON "work_policy_preset" USING btree ("name") WHERE "work_policy_preset"."organization_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "workPolicyPreset_org_name_idx" ON "work_policy_preset" USING btree ("organization_id","name") WHERE "work_policy_preset"."organization_id" IS NOT NULL;