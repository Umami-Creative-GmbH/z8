-- #285: runtime demo generation, correction and cleanup adopt the work/append contract.
-- Additive and inactive: only organizations whose append control is active admit demo
-- appends or write demo receipts, so nothing changes until activation.
ALTER TABLE "time_entry_append_position" DROP CONSTRAINT "time_entry_append_position_operation_check";--> statement-breakpoint
ALTER TABLE "time_entry_append_position" ADD CONSTRAINT "time_entry_append_position_operation_check" CHECK ("time_entry_append_position"."admitted_operation" IN ('live_clock_in', 'live_clock_out', 'demo_generation', 'demo_correction') AND "time_entry_append_position"."last_operation" IN ('live_clock_in', 'live_clock_out', 'demo_generation', 'demo_correction'));--> statement-breakpoint
ALTER TABLE "completed_work_operation" DROP CONSTRAINT "completed_work_operation_kind_check";--> statement-breakpoint
ALTER TABLE "completed_work_operation" ADD CONSTRAINT "completed_work_operation_kind_check" CHECK ("completed_work_operation"."kind" IN ('close_active_work', 'start_live_work', 'create_completed_work'));--> statement-breakpoint
ALTER TABLE "completed_work_operation" DROP CONSTRAINT "completed_work_operation_writer_check";--> statement-breakpoint
ALTER TABLE "completed_work_operation" ADD CONSTRAINT "completed_work_operation_writer_check" CHECK ("completed_work_operation"."writer" IN ('web_clock_out', 'direct_http', 'runtime_demo'));
