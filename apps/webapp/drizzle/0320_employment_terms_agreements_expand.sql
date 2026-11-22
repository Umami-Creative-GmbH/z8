-- Phase 1 Expand (0320): Employment terms divergence/on-call/profile columns,
-- employee_employment_history_day, linear employment_term_agreement chain,
-- statutory_threshold, contract_review_acknowledgement, and temporary Terms Bridge Trigger (O(1) DDL only).
-- Pre-step concurrent unique index `employee_employment_history_id_org_uidx` is built
-- non-transactionally by the shared boundary-aware migration engine before this migration executes.

ALTER TABLE "employee_employment_history"
	ADD CONSTRAINT "employee_employment_history_id_org_uidx"
	UNIQUE USING INDEX "employee_employment_history_id_org_uidx";
--> statement-breakpoint
ALTER TABLE "employee_employment_history" ADD COLUMN IF NOT EXISTS "valid_from_date" date;
--> statement-breakpoint
ALTER TABLE "employee_employment_history" ADD COLUMN IF NOT EXISTS "valid_until_date" date;
--> statement-breakpoint
ALTER TABLE "employee_employment_history" ADD COLUMN IF NOT EXISTS "schedule_mode" text;
--> statement-breakpoint
ALTER TABLE "employee_employment_history" ADD COLUMN IF NOT EXISTS "presence_override" text;
--> statement-breakpoint
ALTER TABLE "employee_employment_history" ADD COLUMN IF NOT EXISTS "balance_mode" text;
--> statement-breakpoint
ALTER TABLE "employee_employment_history" ADD COLUMN IF NOT EXISTS "schedule_source" text;
--> statement-breakpoint
ALTER TABLE "employee_employment_history" ADD COLUMN IF NOT EXISTS "source_template_version_id" uuid;
--> statement-breakpoint
ALTER TABLE "employee_employment_history" ADD COLUMN IF NOT EXISTS "source_batch_item_id" uuid;
--> statement-breakpoint
ALTER TABLE "employee_employment_history" ADD COLUMN IF NOT EXISTS "employment_profile" text DEFAULT 'regular' NOT NULL;
--> statement-breakpoint
ALTER TABLE "employee_employment_history" ADD COLUMN IF NOT EXISTS "arbzg_scope" text DEFAULT 'standard' NOT NULL;
--> statement-breakpoint
ALTER TABLE "employee_employment_history" ADD COLUMN IF NOT EXISTS "on_call_hours_kind" text;
--> statement-breakpoint
ALTER TABLE "employee_employment_history" ADD COLUMN IF NOT EXISTS "on_call_weekly_minutes" integer;
--> statement-breakpoint
ALTER TABLE "employee_employment_history" ADD COLUMN IF NOT EXISTS "on_call_daily_minutes" integer;
--> statement-breakpoint
ALTER TABLE "employee_employment_history" ADD COLUMN IF NOT EXISTS "migrated_legacy_terms" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "employee_employment_history"
	ADD CONSTRAINT "employee_employment_history_template_version_fk"
	FOREIGN KEY ("source_template_version_id", "organization_id")
	REFERENCES "contract_template_version"("id", "organization_id")
	ON DELETE NO ACTION NOT VALID;
--> statement-breakpoint
ALTER TABLE "employee_employment_history"
	ADD CONSTRAINT "employee_employment_history_schedule_mode_check"
	CHECK ("schedule_mode" IS NULL OR "schedule_mode" IN ('inherit', 'policy', 'hours_only', 'custom_days')) NOT VALID;
--> statement-breakpoint
ALTER TABLE "employee_employment_history"
	ADD CONSTRAINT "employee_employment_history_presence_override_check"
	CHECK ("presence_override" IS NULL OR "presence_override" IN ('inherit', 'exempt', 'require_onsite')) NOT VALID;
--> statement-breakpoint
ALTER TABLE "employee_employment_history"
	ADD CONSTRAINT "employee_employment_history_balance_mode_check"
	CHECK ("balance_mode" IS NULL OR "balance_mode" IN ('tracked', 'trust_based')) NOT VALID;
--> statement-breakpoint
ALTER TABLE "employee_employment_history"
	ADD CONSTRAINT "employee_employment_history_schedule_source_check"
	CHECK ("schedule_source" IS NULL OR "schedule_source" IN ('policy', 'published_shifts', 'on_call')) NOT VALID;
--> statement-breakpoint
ALTER TABLE "employee_employment_history"
	ADD CONSTRAINT "employee_employment_history_profile_check"
	CHECK ("employment_profile" IN ('regular', 'minijob', 'short_term', 'working_student', 'apprentice')) NOT VALID;
--> statement-breakpoint
ALTER TABLE "employee_employment_history"
	ADD CONSTRAINT "employee_employment_history_arbzg_scope_check"
	CHECK ("arbzg_scope" IN ('standard', 'executive_exempt')) NOT VALID;
--> statement-breakpoint
-- PostgreSQL 3-valued-logic-safe § 12 TzBfG on-call check: NULL schedule_source can never bypass validation.
ALTER TABLE "employee_employment_history"
	ADD CONSTRAINT "employee_employment_history_on_call_check"
	CHECK ((
		(
			"schedule_source" IS DISTINCT FROM 'on_call'
			AND "on_call_hours_kind" IS NULL
			AND "on_call_weekly_minutes" IS NULL
			AND "on_call_daily_minutes" IS NULL
		)
		OR (
			"schedule_source" = 'on_call'
			AND "on_call_hours_kind" IN ('exact', 'minimum', 'maximum', 'unspecified')
			AND (
				("on_call_hours_kind" = 'unspecified' AND "on_call_weekly_minutes" IS NULL)
				OR ("on_call_hours_kind" IN ('exact', 'minimum', 'maximum') AND "on_call_weekly_minutes" BETWEEN 1 AND 10080)
			)
			AND ("on_call_daily_minutes" IS NULL OR "on_call_daily_minutes" BETWEEN 1 AND 1440)
		)
	) IS TRUE) NOT VALID;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "employee_employment_history_day" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"employment_history_id" uuid NOT NULL,
	"day_of_week" "day_of_week" NOT NULL,
	"minutes_per_day" integer NOT NULL,
	"is_work_day" boolean DEFAULT true NOT NULL,
	"latest_clock_in" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_employment_history_day_organization_id_organization_id_fk"
		FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE,
	CONSTRAINT "employee_employment_history_day_history_fk"
		FOREIGN KEY ("employment_history_id", "organization_id")
		REFERENCES "employee_employment_history"("id", "organization_id") ON DELETE CASCADE,
	CONSTRAINT "employeeEmploymentHistoryDay_history_day_unique" UNIQUE ("employment_history_id", "day_of_week"),
	CONSTRAINT "employee_employment_history_day_minutes_check"
		CHECK ("minutes_per_day" >= 0 AND "minutes_per_day" <= 1440),
	CONSTRAINT "employee_employment_history_day_workday_minutes_check"
		CHECK ("is_work_day" OR "minutes_per_day" = 0),
	CONSTRAINT "employee_employment_history_day_latest_clock_in_check"
		CHECK ("latest_clock_in" IS NULL OR "latest_clock_in" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employeeEmploymentHistoryDay_org_history_idx"
	ON "employee_employment_history_day" ("organization_id", "employment_history_id");
--> statement-breakpoint
-- Strict single-root linear extension chain per employment period
CREATE TABLE IF NOT EXISTS "employment_term_agreement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"employment_period_id" uuid NOT NULL,
	"sequence_number" integer NOT NULL,
	"supersedes_id" uuid,
	"previous_sequence_number" integer GENERATED ALWAYS AS (
		CASE WHEN "sequence_number" > 1 THEN "sequence_number" - 1 ELSE NULL END
	) STORED,
	"kind" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "employment_term_agreement_organization_id_organization_id_fk"
		FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE,
	CONSTRAINT "employment_term_agreement_period_fk"
		FOREIGN KEY ("employment_period_id", "organization_id", "employee_id")
		REFERENCES "employee_employment_period"("id", "organization_id", "employee_id") ON DELETE CASCADE,
	CONSTRAINT "employment_term_agreement_created_by_user_id_fk"
		FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE SET NULL,
	CONSTRAINT "employment_term_agreement_period_seq_unique"
		UNIQUE ("employment_period_id", "sequence_number"),
	CONSTRAINT "employment_term_agreement_chain_target_unique"
		UNIQUE ("id", "organization_id", "employee_id", "employment_period_id", "sequence_number"),
	CONSTRAINT "employment_term_agreement_supersedes_fk"
		FOREIGN KEY ("supersedes_id", "organization_id", "employee_id", "employment_period_id", "previous_sequence_number")
		REFERENCES "employment_term_agreement"("id", "organization_id", "employee_id", "employment_period_id", "sequence_number")
		ON DELETE NO ACTION,
	CONSTRAINT "employment_term_agreement_seq_check" CHECK ("sequence_number" >= 1),
	CONSTRAINT "employment_term_agreement_root_check" CHECK (("sequence_number" = 1) = ("supersedes_id" IS NULL)),
	CONSTRAINT "employment_term_agreement_kind_check" CHECK ("kind" IN ('permanent', 'fixed_term')),
	CONSTRAINT "employment_term_agreement_kind_ends_reason_check"
		CHECK ((
			("kind" = 'permanent' AND "ends_on" IS NULL AND "reason" IS NULL)
			OR ("kind" = 'fixed_term' AND "ends_on" IS NOT NULL AND "ends_on" >= "starts_on")
		) IS TRUE)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "employmentTermAgreement_supersedes_uidx"
	ON "employment_term_agreement" ("supersedes_id")
	WHERE "supersedes_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employmentTermAgreement_org_employee_idx"
	ON "employment_term_agreement" ("organization_id", "employee_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employmentTermAgreement_period_idx"
	ON "employment_term_agreement" ("organization_id", "employment_period_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "statutory_threshold" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text,
	"country_code" text NOT NULL,
	"threshold_key" text NOT NULL,
	"effective_from_date" date NOT NULL,
	"effective_until_date" date,
	"numeric_value" numeric(12, 2),
	"integer_value" integer,
	"currency" text,
	"unit" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "statutory_threshold_organization_id_organization_id_fk"
		FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE,
	CONSTRAINT "statutory_threshold_date_range_check"
		CHECK ("effective_until_date" IS NULL OR "effective_until_date" > "effective_from_date"),
	CONSTRAINT "statutory_threshold_value_check"
		CHECK ("numeric_value" IS NOT NULL OR "integer_value" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "statutoryThreshold_system_key_date_uidx"
	ON "statutory_threshold" ("country_code", "threshold_key", "effective_from_date")
	WHERE "organization_id" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "statutoryThreshold_org_key_date_uidx"
	ON "statutory_threshold" ("organization_id", "country_code", "threshold_key", "effective_from_date")
	WHERE "organization_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "statutoryThreshold_lookup_idx"
	ON "statutory_threshold" ("country_code", "threshold_key", "effective_from_date");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contract_review_acknowledgement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"employment_history_id" uuid,
	"agreement_id" uuid,
	"review_kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"acknowledged_by" text NOT NULL,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "contract_review_ack_organization_id_organization_id_fk"
		FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE,
	CONSTRAINT "contract_review_ack_employee_fk"
		FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employee"("id", "organization_id") ON DELETE CASCADE,
	CONSTRAINT "contract_review_ack_history_fk"
		FOREIGN KEY ("employment_history_id", "organization_id")
		REFERENCES "employee_employment_history"("id", "organization_id") ON DELETE CASCADE,
	CONSTRAINT "contract_review_ack_agreement_fk"
		FOREIGN KEY ("agreement_id") REFERENCES "employment_term_agreement"("id") ON DELETE CASCADE,
	CONSTRAINT "contract_review_ack_user_fk"
		FOREIGN KEY ("acknowledged_by") REFERENCES "user"("id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contractReviewAck_org_dedupe_uidx"
	ON "contract_review_acknowledgement" ("organization_id", "dedupe_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contractReviewAck_org_employee_idx"
	ON "contract_review_acknowledgement" ("organization_id", "employee_id");
--> statement-breakpoint
-- Temporary Terms Bridge Trigger: synchronizes valid_from/valid_until <-> valid_from_date/valid_until_date
CREATE OR REPLACE FUNCTION "z8_bridge_employment_history_dates"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'INSERT' THEN
		IF NEW."valid_from_date" IS NULL AND NEW."valid_from" IS NOT NULL THEN
			NEW."valid_from_date" := "z8_terms_timestamp_to_calendar_date"(NEW."valid_from", NEW."organization_id");
		ELSIF NEW."valid_from" IS NULL AND NEW."valid_from_date" IS NOT NULL THEN
			NEW."valid_from" := NEW."valid_from_date"::timestamp;
		END IF;

		IF NEW."valid_until_date" IS NULL AND NEW."valid_until" IS NOT NULL THEN
			NEW."valid_until_date" := "z8_terms_timestamp_to_calendar_date"(NEW."valid_until", NEW."organization_id");
		ELSIF NEW."valid_until" IS NULL AND NEW."valid_until_date" IS NOT NULL THEN
			NEW."valid_until" := NEW."valid_until_date"::timestamp;
		END IF;
		RETURN NEW;
	END IF;

	IF TG_OP = 'UPDATE' THEN
		IF NEW."valid_from" IS DISTINCT FROM OLD."valid_from"
			AND NEW."valid_from_date" IS NOT DISTINCT FROM OLD."valid_from_date"
		THEN
			NEW."valid_from_date" := "z8_terms_timestamp_to_calendar_date"(NEW."valid_from", NEW."organization_id");
		ELSIF NEW."valid_from_date" IS DISTINCT FROM OLD."valid_from_date"
			AND NEW."valid_from" IS NOT DISTINCT FROM OLD."valid_from"
		THEN
			NEW."valid_from" := NEW."valid_from_date"::timestamp;
		END IF;

		IF NEW."valid_until" IS DISTINCT FROM OLD."valid_until"
			AND NEW."valid_until_date" IS NOT DISTINCT FROM OLD."valid_until_date"
		THEN
			NEW."valid_until_date" := "z8_terms_timestamp_to_calendar_date"(NEW."valid_until", NEW."organization_id");
		ELSIF NEW."valid_until_date" IS DISTINCT FROM OLD."valid_until_date"
			AND NEW."valid_until" IS NOT DISTINCT FROM OLD."valid_until"
		THEN
			NEW."valid_until" := CASE
				WHEN NEW."valid_until_date" IS NULL THEN NULL
				ELSE NEW."valid_until_date"::timestamp
			END;
		END IF;
		RETURN NEW;
	END IF;

	RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_01_bridge_employment_history_dates" ON "employee_employment_history";
CREATE TRIGGER "trg_01_bridge_employment_history_dates"
	BEFORE INSERT OR UPDATE ON "employee_employment_history"
	FOR EACH ROW
	EXECUTE FUNCTION "z8_bridge_employment_history_dates"();
