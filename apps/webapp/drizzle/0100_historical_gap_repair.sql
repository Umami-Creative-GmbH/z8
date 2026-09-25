-- #320: evidence-only historical gap repair through the completed-work operation.
-- Additive and inactive: repair runs only for organizations whose repair control is
-- active, and there is no application setter, so nothing changes until activation.
-- Each applied repair writes a receipt (kind repair_historical_gap) in the same
-- transaction as the facts it fills.
CREATE TABLE "historical_work_repair_control" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"mode" text DEFAULT 'inactive' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "historical_work_repair_control_mode_check" CHECK ("historical_work_repair_control"."mode" IN ('inactive', 'active'))
);
--> statement-breakpoint
ALTER TABLE "historical_work_repair_control" ADD CONSTRAINT "historical_work_repair_control_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completed_work_operation" DROP CONSTRAINT "completed_work_operation_kind_check";--> statement-breakpoint
ALTER TABLE "completed_work_operation" ADD CONSTRAINT "completed_work_operation_kind_check" CHECK ("completed_work_operation"."kind" IN ('close_active_work', 'start_live_work', 'import_completed_work', 'import_open_work', 'create_completed_work', 'amend_completed_work', 'close_resume_work', 'submit_time_correction', 'finalize_time_correction', 'cancel_time_correction', 'repair_historical_gap'));--> statement-breakpoint
ALTER TABLE "completed_work_operation" DROP CONSTRAINT "completed_work_operation_writer_check";--> statement-breakpoint
ALTER TABLE "completed_work_operation" ADD CONSTRAINT "completed_work_operation_writer_check" CHECK ("completed_work_operation"."writer" IN ('web_clock_out', 'direct_http', 'reviewed_import', 'runtime_demo', 'bot_clock_out', 'admin_time_edit', 'self_service_time_edit', 'http_direct_correction', 'work_period_attribution_edit', 'manager_on_behalf', 'manual_entry', 'time_correction_request', 'time_correction_decision', 'time_correction_cancellation', 'historical_gap_repair'));
