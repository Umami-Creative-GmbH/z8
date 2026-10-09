-- Project tasks (#872): named pieces of work inside exactly one project.
-- The composite foreign key keeps a task in its project's organization, and
-- (id, project_id, organization_id) is the target for booking references (#873).
CREATE TYPE "public"."project_task_state" AS ENUM('open', 'done');--> statement-breakpoint
CREATE TABLE "project_task" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"estimate_hours" numeric(8, 2),
	"state" "project_task_state" DEFAULT 'open' NOT NULL,
	"done_at" timestamp,
	"done_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp NOT NULL,
	"updated_by" text,
	CONSTRAINT "project_task_id_project_org_idx" UNIQUE("id","project_id","organization_id"),
	CONSTRAINT "project_task_name_check" CHECK (length(btrim("project_task"."name")) > 0),
	CONSTRAINT "project_task_estimate_check" CHECK ("project_task"."estimate_hours" IS NULL OR "project_task"."estimate_hours" > 0),
	CONSTRAINT "project_task_done_check" CHECK (("project_task"."state" = 'done') = ("project_task"."done_at" IS NOT NULL AND "project_task"."done_by" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "project_task" ADD CONSTRAINT "project_task_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_task" ADD CONSTRAINT "project_task_done_by_user_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_task" ADD CONSTRAINT "project_task_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_task" ADD CONSTRAINT "project_task_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_task" ADD CONSTRAINT "project_task_project_fk" FOREIGN KEY ("project_id","organization_id") REFERENCES "public"."project"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "projectTask_organizationId_idx" ON "project_task" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "projectTask_projectId_state_idx" ON "project_task" USING btree ("project_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "projectTask_project_name_unique_idx" ON "project_task" USING btree ("project_id",lower("name"));