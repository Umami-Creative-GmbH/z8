-- #308: strict versioned manual commands through the completed-work operation.
-- Additive and inactive: only organizations whose append control is active admit
-- manual appends or write manual receipts, so nothing changes until activation.
ALTER TABLE "time_entry_append_position" DROP CONSTRAINT "time_entry_append_position_operation_check";--> statement-breakpoint
ALTER TABLE "time_entry_append_position" ADD CONSTRAINT "time_entry_append_position_operation_check" CHECK ("time_entry_append_position"."admitted_operation" IN ('live_clock_in', 'live_clock_out', 'reviewed_import', 'demo_generation', 'demo_correction', 'completed_work_correction', 'manual_entry') AND "time_entry_append_position"."last_operation" IN ('live_clock_in', 'live_clock_out', 'reviewed_import', 'demo_generation', 'demo_correction', 'completed_work_correction', 'manual_entry'));--> statement-breakpoint
ALTER TABLE "completed_work_operation" DROP CONSTRAINT "completed_work_operation_writer_check";--> statement-breakpoint
ALTER TABLE "completed_work_operation" ADD CONSTRAINT "completed_work_operation_writer_check" CHECK ("completed_work_operation"."writer" IN ('web_clock_out', 'direct_http', 'reviewed_import', 'runtime_demo', 'bot_clock_out', 'admin_time_edit', 'self_service_time_edit', 'http_direct_correction', 'work_period_attribution_edit', 'manager_on_behalf', 'manual_entry'));
