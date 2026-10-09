-- Billable work and the project billable default (#900, spec #768).
-- A project's billable default says whether new work on it starts as billable
-- work; it can only be on while the project has a customer. Billability is part
-- of a work period's work attribution: the legacy period carries it next to its
-- project, and the canonical record carries it on its project allocation, so
-- billability without a project is impossible in either representation.
-- Existing work stays non-billable: nothing is backfilled (#901 adds a bulk action).
-- The columns are NOT NULL with a constant default, which PostgreSQL adds without
-- rewriting the tables.
-- Idempotent: the migration runner test replays every migration after 0141.
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "billable_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "work_period" ADD COLUMN IF NOT EXISTS "is_billable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "time_record_allocation" ADD COLUMN IF NOT EXISTS "is_billable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "project" ADD CONSTRAINT "project_billable_default_customer_chk" CHECK (NOT "project"."billable_default" OR "project"."customer_id" IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "work_period" ADD CONSTRAINT "workPeriod_billable_requires_project_chk" CHECK (NOT "work_period"."is_billable" OR "work_period"."project_id" IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "time_record_allocation" ADD CONSTRAINT "timeRecordAllocation_billable_project_chk" CHECK (NOT "time_record_allocation"."is_billable" OR "time_record_allocation"."allocation_kind" = 'project');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
