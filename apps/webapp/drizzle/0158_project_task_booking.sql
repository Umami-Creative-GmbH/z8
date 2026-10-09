-- Booking time to a project task (#873). A project allocation and its mirrored
-- legacy work period may name a task of their project. The composite foreign
-- keys prove the task is in the same organization and project. A booked task
-- is never deleted on its own: the application refuses it under the task's row
-- lock, and the allocation's key (no action) refuses it in the database too.
-- Hard-deleting a project keeps its legacy work periods, as before tasks: they
-- lose the project and, with it, the task (the period's key sets only task_id
-- to null, and the trigger clears the task whenever the project is cleared).
ALTER TABLE "time_record_allocation" ADD COLUMN "task_id" uuid;--> statement-breakpoint
ALTER TABLE "work_period" ADD COLUMN "task_id" uuid;--> statement-breakpoint
ALTER TABLE "time_record_allocation" ADD CONSTRAINT "timeRecordAllocation_task_fk" FOREIGN KEY ("task_id","project_id","organization_id") REFERENCES "public"."project_task"("id","project_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_period" ADD CONSTRAINT "workPeriod_task_fk" FOREIGN KEY ("task_id","project_id","organization_id") REFERENCES "public"."project_task"("id","project_id","organization_id") ON DELETE SET NULL ("task_id") ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "timeRecordAllocation_taskId_idx" ON "time_record_allocation" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "workPeriod_taskId_idx" ON "work_period" USING btree ("task_id");--> statement-breakpoint
ALTER TABLE "time_record_allocation" ADD CONSTRAINT "timeRecordAllocation_task_project_chk" CHECK ("time_record_allocation"."task_id" IS NULL OR ("time_record_allocation"."allocation_kind" = 'project' AND "time_record_allocation"."project_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "work_period" ADD CONSTRAINT "workPeriod_task_project_chk" CHECK ("work_period"."task_id" IS NULL OR "work_period"."project_id" IS NOT NULL);--> statement-breakpoint
CREATE OR REPLACE FUNCTION "work_period_task_follows_project"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	NEW.task_id := NULL;
	RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "work_period_task_follows_project_trigger" BEFORE UPDATE OF "project_id" ON "work_period" FOR EACH ROW WHEN (NEW.project_id IS NULL AND NEW.task_id IS NOT NULL) EXECUTE FUNCTION "work_period_task_follows_project"();
