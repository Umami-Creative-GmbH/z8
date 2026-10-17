-- #884: a project's task requirement (Projects ADR 0002), off by default, and
-- the same setting on project templates, copied once onto new projects.
ALTER TABLE "project" ADD COLUMN "requires_task" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_template" ADD COLUMN "requires_task" boolean DEFAULT false NOT NULL;
