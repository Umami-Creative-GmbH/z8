-- Booking time to a project task (#873). A project allocation and its mirrored
-- legacy work period may name a task of their project. The composite foreign
-- keys prove the task is in the same organization and project, and (no action
-- on delete) keep a booked task from being deleted.
ALTER TABLE "time_record_allocation" ADD COLUMN "task_id" uuid;--> statement-breakpoint
ALTER TABLE "work_period" ADD COLUMN "task_id" uuid;--> statement-breakpoint
ALTER TABLE "time_record_allocation" ADD CONSTRAINT "timeRecordAllocation_task_fk" FOREIGN KEY ("task_id","project_id","organization_id") REFERENCES "public"."project_task"("id","project_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_period" ADD CONSTRAINT "workPeriod_task_fk" FOREIGN KEY ("task_id","project_id","organization_id") REFERENCES "public"."project_task"("id","project_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "timeRecordAllocation_taskId_idx" ON "time_record_allocation" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "workPeriod_taskId_idx" ON "work_period" USING btree ("task_id");--> statement-breakpoint
ALTER TABLE "time_record_allocation" ADD CONSTRAINT "timeRecordAllocation_task_project_chk" CHECK ("time_record_allocation"."task_id" IS NULL OR ("time_record_allocation"."allocation_kind" = 'project' AND "time_record_allocation"."project_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "work_period" ADD CONSTRAINT "workPeriod_task_project_chk" CHECK ("work_period"."task_id" IS NULL OR "work_period"."project_id" IS NOT NULL);