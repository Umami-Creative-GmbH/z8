-- #281: atomic desktop break close/resume shares the completed-work receipt.
-- Additive and inactive: only organizations whose append control is active accept
-- break commands, so no close/resume receipt is written until activation.
ALTER TABLE "completed_work_operation" DROP CONSTRAINT "completed_work_operation_kind_check";--> statement-breakpoint
ALTER TABLE "completed_work_operation" ADD CONSTRAINT "completed_work_operation_kind_check" CHECK ("completed_work_operation"."kind" IN ('close_active_work', 'start_live_work', 'import_completed_work', 'import_open_work', 'create_completed_work', 'amend_completed_work', 'close_resume_work'));
