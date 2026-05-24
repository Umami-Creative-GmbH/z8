CREATE TABLE "works_council_access_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_employee_id" uuid,
	"event_type" text NOT NULL,
	"date_range_start" timestamp with time zone,
	"date_range_end" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "works_council_review_export" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"requested_by_employee_id" uuid,
	"date_range_start" timestamp with time zone NOT NULL,
	"date_range_end" timestamp with time zone NOT NULL,
	"visibility_snapshot" jsonb NOT NULL,
	"status" text NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "works_council_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"identity_visibility" text DEFAULT 'aggregated' NOT NULL,
	"absence_visibility" text DEFAULT 'hidden' NOT NULL,
	"export_enabled" boolean DEFAULT false NOT NULL,
	"minimum_aggregation_threshold" integer DEFAULT 5 NOT NULL,
	"visible_team_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"visible_location_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
DROP INDEX "employeeManagers_unique_idx";--> statement-breakpoint
ALTER TABLE "works_council_access_audit" ADD CONSTRAINT "works_council_access_audit_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works_council_access_audit" ADD CONSTRAINT "works_council_access_audit_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works_council_access_audit" ADD CONSTRAINT "works_council_access_audit_actor_employee_id_employee_id_fk" FOREIGN KEY ("actor_employee_id") REFERENCES "public"."employee"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works_council_review_export" ADD CONSTRAINT "works_council_review_export_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works_council_review_export" ADD CONSTRAINT "works_council_review_export_requested_by_user_id_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works_council_review_export" ADD CONSTRAINT "works_council_review_export_requested_by_employee_id_employee_id_fk" FOREIGN KEY ("requested_by_employee_id") REFERENCES "public"."employee"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works_council_settings" ADD CONSTRAINT "works_council_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works_council_settings" ADD CONSTRAINT "works_council_settings_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works_council_settings" ADD CONSTRAINT "works_council_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "worksCouncilAccessAudit_org_createdAt_idx" ON "works_council_access_audit" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "worksCouncilAccessAudit_actor_createdAt_idx" ON "works_council_access_audit" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "worksCouncilAccessAudit_eventType_idx" ON "works_council_access_audit" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "worksCouncilReviewExport_org_createdAt_idx" ON "works_council_review_export" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "worksCouncilReviewExport_requestedBy_idx" ON "works_council_review_export" USING btree ("requested_by_user_id");--> statement-breakpoint
CREATE INDEX "worksCouncilReviewExport_range_idx" ON "works_council_review_export" USING btree ("organization_id","date_range_start","date_range_end");--> statement-breakpoint
CREATE UNIQUE INDEX "worksCouncilSettings_organizationId_idx" ON "works_council_settings" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "worksCouncilSettings_enabled_idx" ON "works_council_settings" USING btree ("enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "employeeManagers_unique_idx" ON "employee_managers" USING btree ("employee_id","manager_id");