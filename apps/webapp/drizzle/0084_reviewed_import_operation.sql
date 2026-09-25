-- #284: reviewed imports through the completed-work operation.
-- Additive and inactive: only organizations whose append control is active commit
-- imported work through the operation, so no import receipt, source key or hold is
-- written until activation.
ALTER TABLE "completed_work_operation" ADD COLUMN "source_key" text;--> statement-breakpoint
ALTER TABLE "completed_work_operation" DROP CONSTRAINT "completed_work_operation_kind_check";--> statement-breakpoint
ALTER TABLE "completed_work_operation" ADD CONSTRAINT "completed_work_operation_kind_check" CHECK ("completed_work_operation"."kind" IN ('close_active_work', 'import_completed_work', 'import_open_work'));--> statement-breakpoint
ALTER TABLE "completed_work_operation" DROP CONSTRAINT "completed_work_operation_writer_check";--> statement-breakpoint
ALTER TABLE "completed_work_operation" ADD CONSTRAINT "completed_work_operation_writer_check" CHECK ("completed_work_operation"."writer" IN ('web_clock_out', 'reviewed_import'));--> statement-breakpoint
ALTER TABLE "completed_work_operation" ADD CONSTRAINT "completed_work_operation_source_check" CHECK (("completed_work_operation"."writer" = 'reviewed_import') = ("completed_work_operation"."source_key" IS NOT NULL));--> statement-breakpoint
CREATE UNIQUE INDEX "completedWorkOperation_org_source_idx" ON "completed_work_operation" USING btree ("organization_id","source_key") WHERE "completed_work_operation"."source_key" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "time_entry_append_position" DROP CONSTRAINT "time_entry_append_position_operation_check";--> statement-breakpoint
ALTER TABLE "time_entry_append_position" ADD CONSTRAINT "time_entry_append_position_operation_check" CHECK ("time_entry_append_position"."admitted_operation" IN ('live_clock_in', 'live_clock_out', 'reviewed_import') AND "time_entry_append_position"."last_operation" IN ('live_clock_in', 'live_clock_out', 'reviewed_import'));--> statement-breakpoint
ALTER TABLE "import_staged_row" ADD COLUMN "commit_hold" jsonb;
