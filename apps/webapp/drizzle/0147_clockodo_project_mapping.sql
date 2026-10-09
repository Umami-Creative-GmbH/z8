-- Clockodo project mapping (#907, spec #768 Billable Time).
-- Maps a Clockodo project to an EXISTING Z8 project of the same organization, so
-- imported Clockodo work carries its project and Clockodo's billable value. The
-- import never creates projects; an unmapped Clockodo project imports its work
-- without a project (never billable). The project reference is organization-
-- scoped; deleting the project or the organization removes the mapping.
-- Additive only. Idempotent: the migration runner test replays every migration
-- after 0141.
CREATE TABLE IF NOT EXISTS "clockodo_project_mapping" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"clockodo_project_id" integer NOT NULL,
	"clockodo_project_name" text NOT NULL,
	"project_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "clockodo_project_mapping" ADD CONSTRAINT "clockodo_project_mapping_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "clockodo_project_mapping" ADD CONSTRAINT "clockodo_project_mapping_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "clockodo_project_mapping" ADD CONSTRAINT "clockodo_project_mapping_project_fk" FOREIGN KEY ("project_id","organization_id") REFERENCES "public"."project"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "clockodoProjectMapping_org_clockodoProject_unique_idx" ON "clockodo_project_mapping" USING btree ("organization_id","clockodo_project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clockodoProjectMapping_project_idx" ON "clockodo_project_mapping" USING btree ("organization_id","project_id");