-- #860: kiosk clocking. Receipts of kiosk clock commands name their kiosk (by value,
-- like every work identity on a receipt) and record the kiosk as their actor; the
-- employee's user stays creator provenance on the entries only.
ALTER TABLE "completed_work_operation" ADD COLUMN IF NOT EXISTS "kiosk_id" uuid;
--> statement-breakpoint
ALTER TABLE "completed_work_operation" DROP CONSTRAINT IF EXISTS "completed_work_operation_writer_check";
--> statement-breakpoint
ALTER TABLE "completed_work_operation" ADD CONSTRAINT "completed_work_operation_writer_check" CHECK ("writer" IN ('web_clock_out', 'direct_http', 'reviewed_import', 'runtime_demo', 'bot_clock_out', 'admin_time_edit', 'self_service_time_edit', 'http_direct_correction', 'work_period_attribution_edit', 'manager_on_behalf', 'manual_entry', 'time_correction_request', 'time_correction_decision', 'time_correction_cancellation', 'policy_clock_out_decision', 'historical_gap_repair', 'work_period_split', 'historical_repair_proposal', 'automatic_break_enforcement', 'employee_departure', 'automatic_clock_out', 'kiosk_clock'));
--> statement-breakpoint
ALTER TABLE "completed_work_operation" DROP CONSTRAINT IF EXISTS "completed_work_operation_actor_check";
--> statement-breakpoint
ALTER TABLE "completed_work_operation" ADD CONSTRAINT "completed_work_operation_actor_check" CHECK (("actor_kind" = 'human' AND "actor_user_id" IS NOT NULL) OR "actor_kind" IN ('system', 'unknown_historical') OR ("actor_kind" = 'kiosk' AND "actor_user_id" IS NULL));
--> statement-breakpoint
ALTER TABLE "completed_work_operation" DROP CONSTRAINT IF EXISTS "completed_work_operation_kiosk_check";
--> statement-breakpoint
ALTER TABLE "completed_work_operation" ADD CONSTRAINT "completed_work_operation_kiosk_check" CHECK (("writer" = 'kiosk_clock') = ("actor_kind" = 'kiosk') AND ("actor_kind" = 'kiosk') = ("kiosk_id" IS NOT NULL));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "completedWorkOperation_org_kiosk_idx" ON "completed_work_operation" USING btree ("organization_id","kiosk_id") WHERE "completed_work_operation"."kiosk_id" IS NOT NULL;
