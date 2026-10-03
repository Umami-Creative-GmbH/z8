-- #485 (Clocking 7/7): the departure clock-out closes adopted organizations' live
-- work through the append writer (#476 decision 16), under its own receipt writer.
-- Additive: only the writer CHECK widens; no row changes.
ALTER TABLE "completed_work_operation" DROP CONSTRAINT "completed_work_operation_writer_check";--> statement-breakpoint
ALTER TABLE "completed_work_operation" ADD CONSTRAINT "completed_work_operation_writer_check" CHECK ("completed_work_operation"."writer" IN ('web_clock_out', 'direct_http', 'reviewed_import', 'runtime_demo', 'bot_clock_out', 'admin_time_edit', 'self_service_time_edit', 'http_direct_correction', 'work_period_attribution_edit', 'manager_on_behalf', 'manual_entry', 'time_correction_request', 'time_correction_decision', 'time_correction_cancellation', 'policy_clock_out_decision', 'historical_gap_repair', 'work_period_split', 'historical_repair_proposal', 'automatic_break_enforcement', 'employee_departure'));
