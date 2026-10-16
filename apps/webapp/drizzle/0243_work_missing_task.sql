-- #884 (#1295): the missing-task marker (Projects ADR 0002). A booking accepted
-- without a task while its project's task requirement was active is marked on
-- the canonical project allocation and mirrored on the legacy work period, like
-- the task. Only project work without a task can be marked. Existing bookings
-- stay unmarked: the marker is never retroactive.
--
-- The marker is a hint, not a change of the work: it stays out of the 0224
-- closed-month guard's column list, so turning a requirement off can clear it
-- in closed months too.
ALTER TABLE "work_period" ADD COLUMN "missing_task" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "time_record_allocation" ADD COLUMN "missing_task" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "work_period" ADD CONSTRAINT "workPeriod_missing_task_chk" CHECK (NOT "work_period"."missing_task" OR ("work_period"."project_id" IS NOT NULL AND "work_period"."task_id" IS NULL));--> statement-breakpoint
ALTER TABLE "time_record_allocation" ADD CONSTRAINT "timeRecordAllocation_missing_task_chk" CHECK (NOT "time_record_allocation"."missing_task" OR ("time_record_allocation"."allocation_kind" = 'project' AND "time_record_allocation"."task_id" IS NULL));--> statement-breakpoint
-- Hard-deleting a project clears a legacy period's project (0158): the marker
-- goes with it, as the task does.
CREATE OR REPLACE FUNCTION "work_period_task_follows_project"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	NEW.task_id := NULL;
	NEW.missing_task := false;
	RETURN NEW;
END
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "work_period_task_follows_project_trigger" ON "work_period";--> statement-breakpoint
CREATE TRIGGER "work_period_task_follows_project_trigger" BEFORE UPDATE OF "project_id" ON "work_period" FOR EACH ROW WHEN (NEW.project_id IS NULL AND (NEW.task_id IS NOT NULL OR NEW.missing_task)) EXECUTE FUNCTION "work_period_task_follows_project"();
