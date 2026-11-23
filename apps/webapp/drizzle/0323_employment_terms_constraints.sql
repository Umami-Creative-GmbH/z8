-- Phase 2A (0323): Employment terms constraints, sparse nullable operational columns,
-- confirmed-only per-stint btree_gist exclusion, partial source_batch_item_id uniqueness,
-- and validation of single-row checks including the 3VL-safe IS TRUE § 12 TzBfG on-call check.

SET LOCAL lock_timeout = '500ms';
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "btree_gist";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_01_bridge_employment_history_dates" ON "employee_employment_history";
--> statement-breakpoint
DROP FUNCTION IF EXISTS "z8_bridge_employment_history_dates"();
--> statement-breakpoint
ALTER TABLE "employee_employment_history"
	ALTER COLUMN "weekly_contract_minutes" DROP NOT NULL,
	ALTER COLUMN "work_model" DROP DEFAULT,
	ALTER COLUMN "work_model" DROP NOT NULL,
	ALTER COLUMN "valid_from_date" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "employee_employment_history"
	ADD CONSTRAINT "employee_employment_history_date_range_check"
	CHECK ("valid_until_date" IS NULL OR "valid_until_date" >= "valid_from_date");
--> statement-breakpoint
ALTER TABLE "employee_employment_history"
	ADD CONSTRAINT "employee_employment_history_weekly_min_check"
	CHECK ("weekly_contract_minutes" IS NULL OR ("weekly_contract_minutes" >= 0 AND "weekly_contract_minutes" <= 10080));
--> statement-breakpoint
ALTER TABLE "employee_employment_history"
	VALIDATE CONSTRAINT "employee_employment_history_template_version_fk";
--> statement-breakpoint
ALTER TABLE "employee_employment_history"
	VALIDATE CONSTRAINT "employee_employment_history_batch_item_fk";
--> statement-breakpoint
ALTER TABLE "employee_employment_history"
	VALIDATE CONSTRAINT "employee_employment_history_schedule_mode_check";
--> statement-breakpoint
ALTER TABLE "employee_employment_history"
	VALIDATE CONSTRAINT "employee_employment_history_presence_override_check";
--> statement-breakpoint
ALTER TABLE "employee_employment_history"
	VALIDATE CONSTRAINT "employee_employment_history_balance_mode_check";
--> statement-breakpoint
ALTER TABLE "employee_employment_history"
	VALIDATE CONSTRAINT "employee_employment_history_schedule_source_check";
--> statement-breakpoint
ALTER TABLE "employee_employment_history"
	VALIDATE CONSTRAINT "employee_employment_history_profile_check";
--> statement-breakpoint
ALTER TABLE "employee_employment_history"
	VALIDATE CONSTRAINT "employee_employment_history_arbzg_scope_check";
--> statement-breakpoint
ALTER TABLE "employee_employment_history"
	VALIDATE CONSTRAINT "employee_employment_history_on_call_check";
--> statement-breakpoint
ALTER TABLE "employee_employment_history"
	ADD CONSTRAINT "employee_employment_history_confirmed_stint_no_overlap_excl"
	EXCLUDE USING gist (
		"organization_id" WITH =,
		"employee_id" WITH =,
		"employment_period_id" WITH =,
		daterange("valid_from_date", "valid_until_date", '[)') WITH &&
	)
	WHERE (
		"review_state" = 'confirmed'
		AND "employment_period_id" IS NOT NULL
		AND ("valid_until_date" IS NULL OR "valid_until_date" > "valid_from_date")
	);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "employeeEmploymentHistory_source_batch_item_uidx"
	ON "employee_employment_history" ("source_batch_item_id")
	WHERE "source_batch_item_id" IS NOT NULL;
