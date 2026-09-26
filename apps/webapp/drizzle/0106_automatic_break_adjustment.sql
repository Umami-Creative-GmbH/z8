-- #305: ordinary automatic break adjustment through the completed-work operation, with a
-- durable intent that survives process loss, date changes and unresolved review.
-- Additive and inactive: only organizations whose append control is active commit intents,
-- append adjustment entries through the append collaborator or write adjustment receipts,
-- so nothing changes until activation. Every CHECK keeps the full union of earlier slices.
CREATE TABLE "work_break_adjustment_intent" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"work_period_id" uuid NOT NULL,
	"closure_entry_id" uuid,
	"triggered_by_user_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"blocker" text,
	"observed_graph_revision" integer,
	"requested_at" timestamp with time zone NOT NULL,
	"deferred_at" timestamp with time zone,
	"checked_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_error" text,
	CONSTRAINT "work_break_adjustment_intent_status_check" CHECK ("work_break_adjustment_intent"."status" IN ('pending', 'deferred')),
	CONSTRAINT "work_break_adjustment_intent_blocker_check" CHECK (("work_break_adjustment_intent"."status" = 'deferred') = ("work_break_adjustment_intent"."blocker" IS NOT NULL AND "work_break_adjustment_intent"."observed_graph_revision" IS NOT NULL AND "work_break_adjustment_intent"."deferred_at" IS NOT NULL) AND ("work_break_adjustment_intent"."blocker" IS NULL OR "work_break_adjustment_intent"."blocker" IN ('work_period_pending_approval', 'pending_time_correction_approval', 'completed_work_review_required', 'work_occupancy_conflict', 'append_review_required'))),
	CONSTRAINT "work_break_adjustment_intent_attempts_check" CHECK ("work_break_adjustment_intent"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "work_break_adjustment_intent" ADD CONSTRAINT "work_break_adjustment_intent_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_break_adjustment_intent" ADD CONSTRAINT "work_break_adjustment_intent_triggered_by_user_id_user_id_fk" FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_break_adjustment_intent" ADD CONSTRAINT "work_break_adjustment_intent_employee_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workBreakAdjustmentIntent_org_period_idx" ON "work_break_adjustment_intent" USING btree ("organization_id","work_period_id");--> statement-breakpoint
CREATE INDEX "workBreakAdjustmentIntent_checked_idx" ON "work_break_adjustment_intent" USING btree ("checked_at","requested_at");--> statement-breakpoint
ALTER TABLE "completed_work_operation" DROP CONSTRAINT "completed_work_operation_kind_check";--> statement-breakpoint
ALTER TABLE "completed_work_operation" ADD CONSTRAINT "completed_work_operation_kind_check" CHECK ("completed_work_operation"."kind" IN ('close_active_work', 'start_live_work', 'import_completed_work', 'import_open_work', 'create_completed_work', 'amend_completed_work', 'close_resume_work', 'submit_time_correction', 'finalize_time_correction', 'cancel_time_correction', 'split_policy_clock_out_break', 'repair_historical_gap', 'split_completed_work', 'apply_historical_repair_proposal', 'automatic_break_adjustment'));--> statement-breakpoint
ALTER TABLE "completed_work_operation" DROP CONSTRAINT "completed_work_operation_writer_check";--> statement-breakpoint
ALTER TABLE "completed_work_operation" ADD CONSTRAINT "completed_work_operation_writer_check" CHECK ("completed_work_operation"."writer" IN ('web_clock_out', 'direct_http', 'reviewed_import', 'runtime_demo', 'bot_clock_out', 'admin_time_edit', 'self_service_time_edit', 'http_direct_correction', 'work_period_attribution_edit', 'manager_on_behalf', 'manual_entry', 'time_correction_request', 'time_correction_decision', 'time_correction_cancellation', 'policy_clock_out_decision', 'historical_gap_repair', 'work_period_split', 'historical_repair_proposal', 'automatic_break_enforcement'));--> statement-breakpoint
ALTER TABLE "time_entry_append_position" DROP CONSTRAINT "time_entry_append_position_operation_check";--> statement-breakpoint
ALTER TABLE "time_entry_append_position" ADD CONSTRAINT "time_entry_append_position_operation_check" CHECK ("time_entry_append_position"."admitted_operation" IN ('live_clock_in', 'live_clock_out', 'reviewed_import', 'demo_generation', 'demo_correction', 'completed_work_correction', 'manual_entry', 'time_correction_submission', 'policy_clock_out_break', 'completed_work_split', 'authorized_continuation', 'automatic_break_adjustment') AND "time_entry_append_position"."last_operation" IN ('live_clock_in', 'live_clock_out', 'reviewed_import', 'demo_generation', 'demo_correction', 'completed_work_correction', 'manual_entry', 'time_correction_submission', 'policy_clock_out_break', 'completed_work_split', 'authorized_continuation', 'automatic_break_adjustment'));
