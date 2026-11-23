-- Phase 1 Expand (0321): Retrospective departure mode, review/event kinds,
-- and durable contract_change_batch + contract_change_batch_item tables.

ALTER TABLE "employee_departure"
	DROP CONSTRAINT IF EXISTS "employeeDeparture_mode_check";
--> statement-breakpoint
ALTER TABLE "employee_departure"
	ADD CONSTRAINT "employeeDeparture_mode_check"
	CHECK ("mode" IN ('scheduled', 'immediate', 'retrospective'));
--> statement-breakpoint
ALTER TABLE "employee_departure"
	DROP CONSTRAINT IF EXISTS "employeeDeparture_scheduled_day_check";
--> statement-breakpoint
ALTER TABLE "employee_departure"
	ADD CONSTRAINT "employeeDeparture_scheduled_day_check"
	CHECK ("mode" NOT IN ('scheduled', 'retrospective') OR "last_working_day" IS NOT NULL);
--> statement-breakpoint
ALTER TABLE "employee_departure_review"
	DROP CONSTRAINT IF EXISTS "employeeDepartureReview_kind_check";
--> statement-breakpoint
ALTER TABLE "employee_departure_review"
	ADD CONSTRAINT "employeeDepartureReview_kind_check"
	CHECK ("kind" IN ('clock_out', 'clock_repair', 'approval_handover', 'future_work', 'employment_terms', 'work_after_cutoff', 'payroll_reconciliation'));
--> statement-breakpoint
ALTER TABLE "employee_departure_event"
	DROP CONSTRAINT IF EXISTS "employeeDepartureEvent_kind_check";
--> statement-breakpoint
ALTER TABLE "employee_departure_event"
	ADD CONSTRAINT "employeeDepartureEvent_kind_check"
	CHECK ("kind" IN (
		'departure_scheduled',
		'departure_rescheduled',
		'departure_canceled',
		'departure_superseded',
		'departure_blocked',
		'departure_effective',
		'employee_rehired',
		'review_resolved',
		'task_failed',
		'replacement_assigned',
		'employee_deactivated',
		'employee_reactivated',
		'departure_recorded_retrospectively',
		'departure_date_corrected'
	));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contract_change_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"request_id" uuid NOT NULL,
	"request_fingerprint" text NOT NULL,
	"operation_kind" text NOT NULL,
	"execution_mode" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"total_items" integer DEFAULT 0 NOT NULL,
	"completed_items" integer DEFAULT 0 NOT NULL,
	"failed_items" integer DEFAULT 0 NOT NULL,
	"skipped_items" integer DEFAULT 0 NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_change_batch_organization_id_organization_id_fk"
		FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE,
	CONSTRAINT "contract_change_batch_created_by_user_id_fk"
		FOREIGN KEY ("created_by") REFERENCES "user"("id"),
	CONSTRAINT "contract_change_batch_id_org_unique" UNIQUE ("id", "organization_id"),
	CONSTRAINT "contract_change_batch_operation_kind_check"
		CHECK ("operation_kind" IN ('bulk_template_apply', 'bulk_adopt_default', 'bulk_terms_update', 'csv_contract_import', 'csv_departure_import')),
	CONSTRAINT "contract_change_batch_execution_mode_check"
		CHECK ("execution_mode" IN ('inline', 'async')),
	CONSTRAINT "contract_change_batch_status_check"
		CHECK ("status" IN ('pending', 'running', 'completed', 'completed_with_errors', 'failed', 'canceled')),
	CONSTRAINT "contract_change_batch_counts_check"
		CHECK ("total_items" >= 0 AND "completed_items" >= 0 AND "failed_items" >= 0 AND "skipped_items" >= 0 AND "attempt_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contractChangeBatch_org_request_uidx"
	ON "contract_change_batch" ("organization_id", "request_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contractChangeBatch_claimable_idx"
	ON "contract_change_batch" ("status", "lease_expires_at", "created_at", "id")
	WHERE "status" IN ('pending', 'running');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contractChangeBatch_org_created_idx"
	ON "contract_change_batch" ("organization_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contract_change_batch_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"batch_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"item_index" integer NOT NULL,
	"operation_dedupe_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"error_code" text,
	"error_message" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_change_batch_item_organization_id_organization_id_fk"
		FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE,
	CONSTRAINT "contract_change_batch_item_batch_fk"
		FOREIGN KEY ("batch_id", "organization_id")
		REFERENCES "contract_change_batch"("id", "organization_id") ON DELETE CASCADE,
	CONSTRAINT "contract_change_batch_item_employee_fk"
		FOREIGN KEY ("employee_id", "organization_id")
		REFERENCES "employee"("id", "organization_id") ON DELETE CASCADE,
	CONSTRAINT "contract_change_batch_item_id_org_unique" UNIQUE ("id", "organization_id"),
	CONSTRAINT "contract_change_batch_item_status_check"
		CHECK ("status" IN ('pending', 'running', 'completed', 'skipped', 'failed')),
	CONSTRAINT "contract_change_batch_item_index_attempt_check"
		CHECK ("item_index" >= 0 AND "attempt_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contractChangeBatchItem_batch_employee_uidx"
	ON "contract_change_batch_item" ("batch_id", "employee_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contractChangeBatchItem_org_dedupe_uidx"
	ON "contract_change_batch_item" ("organization_id", "operation_dedupe_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contractChangeBatchItem_claimable_idx"
	ON "contract_change_batch_item" ("batch_id", "employee_id")
	WHERE "status" IN ('pending', 'running');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contractChangeBatchItem_org_status_idx"
	ON "contract_change_batch_item" ("organization_id", "status");
--> statement-breakpoint
ALTER TABLE "employee_employment_history"
	ADD CONSTRAINT "employee_employment_history_batch_item_fk"
	FOREIGN KEY ("source_batch_item_id", "organization_id")
	REFERENCES "contract_change_batch_item"("id", "organization_id")
	ON DELETE NO ACTION NOT VALID;
--> statement-breakpoint
-- A1-16: Expand nullable source_batch_item_id on work_policy_assignment in Phase 1 (0321)
-- so new assignment writers can run cleanly while parked at Drain Gate 1 before 0322 adds constraints.
ALTER TABLE "work_policy_assignment"
	ADD COLUMN IF NOT EXISTS "source_batch_item_id" uuid;
