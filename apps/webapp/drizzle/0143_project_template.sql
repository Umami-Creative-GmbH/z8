-- Project templates (#878): reusable blueprints for new projects. A template
-- is its own entity, never a project row (ADR 0001), so nothing can book to it
-- and no project read sees it. Its rows stay in the template's organization
-- through composite foreign keys. Deleting a referenced team or employee keeps
-- the template row with a null reference and its last known name.
CREATE TABLE "project_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"icon" text,
	"color" text,
	"budget_hours" numeric(8, 2),
	"deadline_offset_days" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp NOT NULL,
	"updated_by" text,
	CONSTRAINT "project_template_id_org_idx" UNIQUE("id","organization_id"),
	CONSTRAINT "project_template_name_check" CHECK (length(btrim("project_template"."name")) > 0),
	CONSTRAINT "project_template_budget_check" CHECK ("project_template"."budget_hours" IS NULL OR "project_template"."budget_hours" > 0),
	CONSTRAINT "project_template_deadline_offset_check" CHECK ("project_template"."deadline_offset_days" IS NULL OR "project_template"."deadline_offset_days" BETWEEN 0 AND 3650)
);
--> statement-breakpoint
CREATE TABLE "project_template_task" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"template_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"estimate_hours" numeric(8, 2),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_template_task_name_check" CHECK (length(btrim("project_template_task"."name")) > 0),
	CONSTRAINT "project_template_task_estimate_check" CHECK ("project_template_task"."estimate_hours" IS NULL OR "project_template_task"."estimate_hours" > 0)
);
--> statement-breakpoint
CREATE TABLE "project_template_manager" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"template_id" uuid NOT NULL,
	"employee_id" uuid,
	"display_name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_template_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"template_id" uuid NOT NULL,
	"assignment_type" "project_assignment_type" NOT NULL,
	"team_id" uuid,
	"employee_id" uuid,
	"display_name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	CONSTRAINT "project_template_assignment_target_check" CHECK (("project_template_assignment"."assignment_type" = 'team' AND "project_template_assignment"."employee_id" IS NULL) OR ("project_template_assignment"."assignment_type" = 'employee' AND "project_template_assignment"."team_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "project_template" ADD CONSTRAINT "project_template_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_template" ADD CONSTRAINT "project_template_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_template" ADD CONSTRAINT "project_template_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_template_task" ADD CONSTRAINT "project_template_task_template_fk" FOREIGN KEY ("template_id","organization_id") REFERENCES "public"."project_template"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_template_manager" ADD CONSTRAINT "project_template_manager_template_fk" FOREIGN KEY ("template_id","organization_id") REFERENCES "public"."project_template"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_template_manager" ADD CONSTRAINT "project_template_manager_employee_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE SET NULL ("employee_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_template_manager" ADD CONSTRAINT "project_template_manager_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_template_assignment" ADD CONSTRAINT "project_template_assignment_template_fk" FOREIGN KEY ("template_id","organization_id") REFERENCES "public"."project_template"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_template_assignment" ADD CONSTRAINT "project_template_assignment_team_fk" FOREIGN KEY ("team_id","organization_id") REFERENCES "public"."team"("id","organization_id") ON DELETE SET NULL ("team_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_template_assignment" ADD CONSTRAINT "project_template_assignment_employee_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE SET NULL ("employee_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_template_assignment" ADD CONSTRAINT "project_template_assignment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "projectTemplate_organizationId_idx" ON "project_template" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projectTemplate_org_name_unique_idx" ON "project_template" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE INDEX "projectTemplateTask_templateId_idx" ON "project_template_task" USING btree ("template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projectTemplateTask_template_name_unique_idx" ON "project_template_task" USING btree ("template_id",lower("name"));--> statement-breakpoint
CREATE INDEX "projectTemplateManager_templateId_idx" ON "project_template_manager" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "projectTemplateManager_employeeId_idx" ON "project_template_manager" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projectTemplateManager_unique_idx" ON "project_template_manager" USING btree ("template_id","employee_id") WHERE employee_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "projectTemplateAssignment_templateId_idx" ON "project_template_assignment" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "projectTemplateAssignment_teamId_idx" ON "project_template_assignment" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "projectTemplateAssignment_employeeId_idx" ON "project_template_assignment" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projectTemplateAssignment_team_unique_idx" ON "project_template_assignment" USING btree ("template_id","team_id") WHERE team_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "projectTemplateAssignment_employee_unique_idx" ON "project_template_assignment" USING btree ("template_id","employee_id") WHERE employee_id IS NOT NULL;
