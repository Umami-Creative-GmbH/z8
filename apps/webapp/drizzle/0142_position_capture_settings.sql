-- #825 (spec #766, Time Tracking ADR 0004): position capture settings, capture
-- assignments, versioned position notices, position consents and "Not now" answers.
-- No positions are stored by this migration.
CREATE TABLE "position_capture_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"assignment_type" "holiday_preset_assignment_type" NOT NULL,
	"team_id" uuid,
	"employee_id" uuid,
	"priority" integer DEFAULT 0 NOT NULL,
	"capture_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "position_capture_assignment_target_check" CHECK (("position_capture_assignment"."assignment_type" = 'organization' and "position_capture_assignment"."team_id" is null and "position_capture_assignment"."employee_id" is null and "position_capture_assignment"."priority" = 0)
			or ("position_capture_assignment"."assignment_type" = 'team' and "position_capture_assignment"."team_id" is not null and "position_capture_assignment"."employee_id" is null and "position_capture_assignment"."priority" = 1)
			or ("position_capture_assignment"."assignment_type" = 'employee' and "position_capture_assignment"."employee_id" is not null and "position_capture_assignment"."team_id" is null and "position_capture_assignment"."priority" = 2))
);--> statement-breakpoint
CREATE TABLE "position_capture_setting" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"purpose_statement" text,
	"retention_days" integer DEFAULT 90 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "positionCaptureSetting_organizationId_idx" UNIQUE("organization_id"),
	CONSTRAINT "position_capture_setting_retention_check" CHECK ("position_capture_setting"."retention_days" between 7 and 365),
	CONSTRAINT "position_capture_setting_purpose_check" CHECK ("position_capture_setting"."enabled" = false or "position_capture_setting"."purpose_statement" is not null)
);--> statement-breakpoint
CREATE TABLE "position_consent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"notice_id" uuid NOT NULL,
	"granted_at" timestamp NOT NULL,
	"withdrawn_at" timestamp,
	CONSTRAINT "position_consent_withdrawal_check" CHECK ("position_consent"."withdrawn_at" is null or "position_consent"."withdrawn_at" >= "position_consent"."granted_at")
);--> statement-breakpoint
CREATE TABLE "position_notice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"version" integer NOT NULL,
	"purpose_statement" text NOT NULL,
	"retention_days" integer NOT NULL,
	"template_revision" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "positionNotice_id_organizationId_idx" UNIQUE("id","organization_id"),
	CONSTRAINT "position_notice_version_check" CHECK ("position_notice"."version" >= 1)
);--> statement-breakpoint
CREATE TABLE "position_notice_decline" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"notice_id" uuid NOT NULL,
	"declined_at" timestamp NOT NULL
);--> statement-breakpoint
ALTER TABLE "position_capture_assignment" ADD CONSTRAINT "position_capture_assignment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_capture_assignment" ADD CONSTRAINT "position_capture_assignment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_capture_assignment" ADD CONSTRAINT "position_capture_assignment_team_fk" FOREIGN KEY ("team_id","organization_id") REFERENCES "public"."team"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_capture_assignment" ADD CONSTRAINT "position_capture_assignment_employee_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_capture_setting" ADD CONSTRAINT "position_capture_setting_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_capture_setting" ADD CONSTRAINT "position_capture_setting_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_consent" ADD CONSTRAINT "position_consent_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_consent" ADD CONSTRAINT "position_consent_employee_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_consent" ADD CONSTRAINT "position_consent_notice_fk" FOREIGN KEY ("notice_id","organization_id") REFERENCES "public"."position_notice"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_notice" ADD CONSTRAINT "position_notice_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_notice" ADD CONSTRAINT "position_notice_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_notice_decline" ADD CONSTRAINT "position_notice_decline_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_notice_decline" ADD CONSTRAINT "position_notice_decline_employee_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_notice_decline" ADD CONSTRAINT "position_notice_decline_notice_fk" FOREIGN KEY ("notice_id","organization_id") REFERENCES "public"."position_notice"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "positionCaptureAssignment_organizationId_idx" ON "position_capture_assignment" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "positionCaptureAssignment_teamId_idx" ON "position_capture_assignment" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "positionCaptureAssignment_employeeId_idx" ON "position_capture_assignment" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "positionCaptureAssignment_org_idx" ON "position_capture_assignment" USING btree ("organization_id") WHERE assignment_type = 'organization';--> statement-breakpoint
CREATE UNIQUE INDEX "positionCaptureAssignment_team_idx" ON "position_capture_assignment" USING btree ("organization_id","team_id") WHERE team_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "positionCaptureAssignment_employee_idx" ON "position_capture_assignment" USING btree ("organization_id","employee_id") WHERE employee_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "positionConsent_organizationId_idx" ON "position_consent" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "positionConsent_employeeId_idx" ON "position_consent" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "positionConsent_unwithdrawn_idx" ON "position_consent" USING btree ("employee_id","notice_id") WHERE withdrawn_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "positionNotice_org_version_idx" ON "position_notice" USING btree ("organization_id","version");--> statement-breakpoint
CREATE INDEX "positionNoticeDecline_organizationId_idx" ON "position_notice_decline" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "positionNoticeDecline_employee_notice_idx" ON "position_notice_decline" USING btree ("employee_id","notice_id");
