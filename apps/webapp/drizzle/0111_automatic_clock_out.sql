-- #568: organization automatic clock-out limits and committed closure/delivery evidence.
-- Missing settings rows read as enabled/720/revision-0; no organization backfill.
CREATE TABLE "organization_time_tracking_settings" (
	"organization_id" text PRIMARY KEY NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
	"auto_clock_out_enabled" boolean DEFAULT true NOT NULL,
	"max_uninterrupted_minutes" integer DEFAULT 720 NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_time_tracking_settings_limit_check" CHECK ("max_uninterrupted_minutes" BETWEEN 1 AND 2147483647),
	CONSTRAINT "organization_time_tracking_settings_revision_check" CHECK ("revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "automatic_clock_out_execution" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
	"employee_id" uuid NOT NULL,
	"work_period_id" uuid NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"cutoff_time" timestamp with time zone NOT NULL,
	"max_uninterrupted_minutes" integer NOT NULL,
	"settings_revision" integer NOT NULL,
	"timezone" text NOT NULL,
	"utc_offset_minutes" integer NOT NULL,
	"recipient_user_id" text NOT NULL REFERENCES "user"("id"),
	"provenance_user_id" text NOT NULL REFERENCES "user"("id"),
	"clock_out_entry_id" uuid NOT NULL,
	"closure_payload" jsonb NOT NULL,
	"processed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "automatic_clock_out_execution_employee_fk" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employee"("id", "organization_id") ON DELETE cascade,
	CONSTRAINT "automatic_clock_out_execution_limit_check" CHECK ("max_uninterrupted_minutes" BETWEEN 1 AND 2147483647),
	CONSTRAINT "automatic_clock_out_execution_revision_check" CHECK ("settings_revision" >= 0),
	CONSTRAINT "automatic_clock_out_execution_cutoff_check" CHECK ("cutoff_time" = "start_time" + "max_uninterrupted_minutes" * INTERVAL '1 minute'),
	CONSTRAINT "automatic_clock_out_execution_offset_check" CHECK ("utc_offset_minutes" BETWEEN -840 AND 840),
	CONSTRAINT "automatic_clock_out_execution_payload_check" CHECK (jsonb_typeof("closure_payload") = 'object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "automaticClockOutExecution_ownership_idx" ON "automatic_clock_out_execution" ("id", "organization_id", "employee_id");
--> statement-breakpoint
CREATE INDEX "automaticClockOutExecution_org_period_idx" ON "automatic_clock_out_execution" ("organization_id", "work_period_id");
--> statement-breakpoint
CREATE FUNCTION "automatic_clock_out_execution_refuse_update"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'Committed automatic clock-out execution evidence is immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "automatic_clock_out_execution_immutable" BEFORE UPDATE ON "automatic_clock_out_execution"
FOR EACH ROW EXECUTE FUNCTION "automatic_clock_out_execution_refuse_update"();
--> statement-breakpoint
CREATE TABLE "automatic_clock_out_task" (
	"id" uuid DEFAULT gen_random_uuid() PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
	"employee_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"claim_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automatic_clock_out_task_employee_fk" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employee"("id", "organization_id") ON DELETE cascade,
	CONSTRAINT "automatic_clock_out_task_execution_fk" FOREIGN KEY ("operation_id", "organization_id", "employee_id") REFERENCES "automatic_clock_out_execution"("id", "organization_id", "employee_id") ON DELETE cascade,
	CONSTRAINT "automatic_clock_out_task_kind_check" CHECK ("kind" IN ('follow_up', 'plan_notification', 'notification_channel')),
	CONSTRAINT "automatic_clock_out_task_status_check" CHECK ("status" IN ('pending', 'processing', 'completed', 'failed')),
	CONSTRAINT "automatic_clock_out_task_attempts_check" CHECK ("attempt_count" >= 0),
	CONSTRAINT "automatic_clock_out_task_lease_check" CHECK (("status" = 'processing' AND "claim_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL) OR ("status" <> 'processing' AND "claim_token" IS NULL AND "lease_expires_at" IS NULL)),
	CONSTRAINT "automatic_clock_out_task_payload_check" CHECK (jsonb_typeof("payload") = 'object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "automaticClockOutTask_org_dedupe_idx" ON "automatic_clock_out_task" ("organization_id", "dedupe_key");
--> statement-breakpoint
CREATE INDEX "automaticClockOutTask_due_idx" ON "automatic_clock_out_task" ("status", "available_at", "id");
--> statement-breakpoint
CREATE INDEX "automaticClockOutTask_lease_idx" ON "automatic_clock_out_task" ("status", "lease_expires_at", "id");
--> statement-breakpoint
-- The singleton contains only internal pagination/lease state, never tenant configuration.
CREATE TABLE "automatic_clock_out_scan_state" (
	"id" text DEFAULT 'maintenance' PRIMARY KEY NOT NULL,
	"cursor" jsonb,
	"claim_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automatic_clock_out_scan_state_id_check" CHECK ("id" = 'maintenance'),
	CONSTRAINT "automatic_clock_out_scan_state_lease_check" CHECK (("claim_token" IS NULL) = ("lease_expires_at" IS NULL)),
	CONSTRAINT "automatic_clock_out_scan_state_cursor_check" CHECK ("cursor" IS NULL OR (
		jsonb_typeof("cursor") = 'object'
		AND "cursor" ?& ARRAY['organizationId', 'employeeId', 'workPeriodId']
		AND "cursor" - ARRAY['organizationId', 'employeeId', 'workPeriodId'] = '{}'::jsonb
		AND jsonb_typeof("cursor"->'organizationId') = 'string'
		AND jsonb_typeof("cursor"->'employeeId') = 'string'
		AND jsonb_typeof("cursor"->'workPeriodId') = 'string'
	))
);
--> statement-breakpoint
INSERT INTO "automatic_clock_out_scan_state" ("id") VALUES ('maintenance');
--> statement-breakpoint
ALTER TYPE "notification_type" ADD VALUE 'automatic_clock_out';
--> statement-breakpoint
ALTER TABLE "completed_work_operation" DROP CONSTRAINT "completed_work_operation_writer_check";
--> statement-breakpoint
ALTER TABLE "completed_work_operation" ADD CONSTRAINT "completed_work_operation_writer_check" CHECK ("writer" IN ('web_clock_out', 'direct_http', 'reviewed_import', 'runtime_demo', 'bot_clock_out', 'admin_time_edit', 'self_service_time_edit', 'http_direct_correction', 'work_period_attribution_edit', 'manager_on_behalf', 'manual_entry', 'time_correction_request', 'time_correction_decision', 'time_correction_cancellation', 'policy_clock_out_decision', 'historical_gap_repair', 'work_period_split', 'historical_repair_proposal', 'automatic_break_enforcement', 'employee_departure', 'automatic_clock_out'));
