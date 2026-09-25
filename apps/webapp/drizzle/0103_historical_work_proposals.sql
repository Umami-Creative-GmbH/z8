-- #323: separately authorized explicit historical proposals (field repair and append
-- continuation). Additive and inactive: proposals may be read, created and approved,
-- but application needs the organization's active historical_work_repair_control, which
-- has no application setter. An applied field repair writes a receipt (kind
-- apply_historical_repair_proposal); an applied continuation establishes the employee's
-- append position with admission authorized_continuation.
CREATE TABLE "historical_work_proposal" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"work_period_id" uuid,
	"fingerprint" text NOT NULL,
	"proposal" jsonb NOT NULL,
	"reason" text NOT NULL,
	"proposed_by" text NOT NULL,
	"proposed_at" timestamp with time zone NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"outcome" jsonb,
	CONSTRAINT "historical_work_proposal_kind_check" CHECK ("historical_work_proposal"."kind" IN ('field_repair', 'append_continuation') AND ("historical_work_proposal"."kind" = 'field_repair') = ("historical_work_proposal"."work_period_id" IS NOT NULL)),
	CONSTRAINT "historical_work_proposal_status_check" CHECK ("historical_work_proposal"."status" IN ('proposed', 'approved', 'applied', 'stale', 'rejected')),
	CONSTRAINT "historical_work_proposal_approval_check" CHECK ("historical_work_proposal"."status" NOT IN ('approved', 'applied') OR ("historical_work_proposal"."approved_by" IS NOT NULL AND "historical_work_proposal"."approved_at" IS NOT NULL)),
	CONSTRAINT "historical_work_proposal_resolution_check" CHECK (("historical_work_proposal"."status" IN ('applied', 'stale', 'rejected')) = ("historical_work_proposal"."resolved_by" IS NOT NULL AND "historical_work_proposal"."resolved_at" IS NOT NULL AND "historical_work_proposal"."outcome" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "historical_work_proposal" ADD CONSTRAINT "historical_work_proposal_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "historical_work_proposal" ADD CONSTRAINT "historical_work_proposal_proposed_by_user_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "historical_work_proposal" ADD CONSTRAINT "historical_work_proposal_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "historical_work_proposal" ADD CONSTRAINT "historical_work_proposal_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "historical_work_proposal" ADD CONSTRAINT "historical_work_proposal_employee_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "historicalWorkProposal_org_employee_idx" ON "historical_work_proposal" USING btree ("organization_id","employee_id");--> statement-breakpoint
ALTER TABLE "completed_work_operation" DROP CONSTRAINT "completed_work_operation_kind_check";--> statement-breakpoint
ALTER TABLE "completed_work_operation" ADD CONSTRAINT "completed_work_operation_kind_check" CHECK ("completed_work_operation"."kind" IN ('close_active_work', 'start_live_work', 'import_completed_work', 'import_open_work', 'create_completed_work', 'amend_completed_work', 'close_resume_work', 'submit_time_correction', 'finalize_time_correction', 'cancel_time_correction', 'split_policy_clock_out_break', 'repair_historical_gap', 'apply_historical_repair_proposal'));--> statement-breakpoint
ALTER TABLE "completed_work_operation" DROP CONSTRAINT "completed_work_operation_writer_check";--> statement-breakpoint
ALTER TABLE "completed_work_operation" ADD CONSTRAINT "completed_work_operation_writer_check" CHECK ("completed_work_operation"."writer" IN ('web_clock_out', 'direct_http', 'reviewed_import', 'runtime_demo', 'bot_clock_out', 'admin_time_edit', 'self_service_time_edit', 'http_direct_correction', 'work_period_attribution_edit', 'manager_on_behalf', 'manual_entry', 'time_correction_request', 'time_correction_decision', 'time_correction_cancellation', 'policy_clock_out_decision', 'historical_gap_repair', 'historical_repair_proposal'));--> statement-breakpoint
ALTER TABLE "time_entry_append_position" DROP CONSTRAINT "time_entry_append_position_count_check";--> statement-breakpoint
ALTER TABLE "time_entry_append_position" DROP CONSTRAINT "time_entry_append_position_admission_check";--> statement-breakpoint
ALTER TABLE "time_entry_append_position" DROP CONSTRAINT "time_entry_append_position_operation_check";--> statement-breakpoint
ALTER TABLE "time_entry_append_position" ADD COLUMN "admitted_history_digest" text;--> statement-breakpoint
ALTER TABLE "time_entry_append_position" ADD COLUMN "continuation_proposal_id" uuid;--> statement-breakpoint
ALTER TABLE "time_entry_append_position" ADD CONSTRAINT "time_entry_append_position_continuation_proposal_id_historical_work_proposal_id_fk" FOREIGN KEY ("continuation_proposal_id") REFERENCES "public"."historical_work_proposal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry_append_position" ADD CONSTRAINT "time_entry_append_position_count_check" CHECK (("time_entry_append_position"."entry_count" > "time_entry_append_position"."admitted_entry_count" OR ("time_entry_append_position"."admission" = 'authorized_continuation' AND "time_entry_append_position"."entry_count" = "time_entry_append_position"."admitted_entry_count")) AND "time_entry_append_position"."admitted_entry_count" >= 0);--> statement-breakpoint
ALTER TABLE "time_entry_append_position" ADD CONSTRAINT "time_entry_append_position_admission_check" CHECK (("time_entry_append_position"."admission" = 'empty_history' AND "time_entry_append_position"."admitted_tip_entry_id" IS NULL AND "time_entry_append_position"."admitted_tip_hash" IS NULL AND "time_entry_append_position"."admitted_entry_count" = 0 AND "time_entry_append_position"."admitted_history_digest" IS NULL AND "time_entry_append_position"."continuation_proposal_id" IS NULL) OR ("time_entry_append_position"."admission" = 'verified_lineage' AND "time_entry_append_position"."admitted_tip_entry_id" IS NOT NULL AND "time_entry_append_position"."admitted_tip_hash" IS NOT NULL AND "time_entry_append_position"."admitted_entry_count" > 0 AND "time_entry_append_position"."admitted_history_digest" IS NULL AND "time_entry_append_position"."continuation_proposal_id" IS NULL) OR ("time_entry_append_position"."admission" = 'authorized_continuation' AND "time_entry_append_position"."admitted_tip_entry_id" IS NOT NULL AND "time_entry_append_position"."admitted_tip_hash" IS NOT NULL AND "time_entry_append_position"."admitted_entry_count" > 0 AND "time_entry_append_position"."admitted_history_digest" IS NOT NULL AND "time_entry_append_position"."continuation_proposal_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "time_entry_append_position" ADD CONSTRAINT "time_entry_append_position_operation_check" CHECK ("time_entry_append_position"."admitted_operation" IN ('live_clock_in', 'live_clock_out', 'reviewed_import', 'demo_generation', 'demo_correction', 'completed_work_correction', 'manual_entry', 'time_correction_submission', 'policy_clock_out_break', 'authorized_continuation') AND "time_entry_append_position"."last_operation" IN ('live_clock_in', 'live_clock_out', 'reviewed_import', 'demo_generation', 'demo_correction', 'completed_work_correction', 'manual_entry', 'time_correction_submission', 'policy_clock_out_break', 'authorized_continuation'));
