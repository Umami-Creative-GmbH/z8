-- #1988 (spec #1934): German statutory foundation.
-- 1. Seeds platform-managed, effective-dated German statutory baselines (`organization_id IS NULL`)
--    and protects them from tenant writes: inserting, changing or deleting a system baseline
--    requires the transaction-local setting `z8.statutory_baseline_maintenance = 'on'`, which only
--    baseline migrations set.
-- 2. Extends `contract_review_acknowledgement` with subject, input fingerprint and legal note for
--    audited statutory acknowledgements, and makes statutory acknowledgements immutable.
-- 3. Adds organization statutory preferences and per-employee statutory context tables.

ALTER TABLE "statutory_threshold" ADD COLUMN IF NOT EXISTS "legal_reference" text;
--> statement-breakpoint
SELECT set_config('z8.statutory_baseline_maintenance', 'on', true);
--> statement-breakpoint
INSERT INTO "statutory_threshold" (
	"organization_id", "country_code", "threshold_key", "effective_from_date", "effective_until_date",
	"integer_value", "currency", "unit", "legal_reference", "notes"
)
VALUES
	-- Minijob monthly earnings cap (Geringfügigkeitsgrenze), § 8 Abs. 1 Nr. 1 SGB IV
	(NULL, 'DE', 'de_minijob_monthly_limit_cents', '2013-01-01', '2022-10-01', 45000, 'EUR', 'cents', '§ 8 Abs. 1 Nr. 1 SGB IV', 'Fixed 450 EUR limit'),
	(NULL, 'DE', 'de_minijob_monthly_limit_cents', '2022-10-01', '2024-01-01', 52000, 'EUR', 'cents', '§ 8 Abs. 1a SGB IV', 'Dynamic limit: minimum wage 12.00 EUR x 130 / 3'),
	(NULL, 'DE', 'de_minijob_monthly_limit_cents', '2024-01-01', '2025-01-01', 53800, 'EUR', 'cents', '§ 8 Abs. 1a SGB IV', 'Dynamic limit: minimum wage 12.41 EUR x 130 / 3'),
	(NULL, 'DE', 'de_minijob_monthly_limit_cents', '2025-01-01', '2026-01-01', 55600, 'EUR', 'cents', '§ 8 Abs. 1a SGB IV', 'Dynamic limit: minimum wage 12.82 EUR x 130 / 3'),
	(NULL, 'DE', 'de_minijob_monthly_limit_cents', '2026-01-01', '2027-01-01', 60300, 'EUR', 'cents', '§ 8 Abs. 1a SGB IV', 'Dynamic limit: minimum wage 13.90 EUR x 130 / 3'),
	(NULL, 'DE', 'de_minijob_monthly_limit_cents', '2027-01-01', NULL, 63300, 'EUR', 'cents', '§ 8 Abs. 1a SGB IV', 'Dynamic limit: minimum wage 14.60 EUR x 130 / 3'),
	-- Occasional unforeseeable exceedance, § 8 Abs. 1b SGB IV
	(NULL, 'DE', 'de_minijob_max_unforeseeable_months_per_12m', '2013-01-01', '2022-10-01', 3, NULL, 'months', 'Geringfügigkeits-Richtlinien (until 30.09.2022)', 'Up to three months within twelve months'),
	(NULL, 'DE', 'de_minijob_max_unforeseeable_months_per_12m', '2022-10-01', NULL, 2, NULL, 'months', '§ 8 Abs. 1b SGB IV', 'Up to two calendar months within twelve months'),
	(NULL, 'DE', 'de_minijob_unforeseeable_multiplier', '2022-10-01', NULL, 2, NULL, 'multiplier', '§ 8 Abs. 1b SGB IV', 'Each exceedance month at most twice the monthly limit'),
	-- Short-term employment, § 8 Abs. 1 Nr. 2 SGB IV (incl. pandemic extensions, § 115 SGB IV)
	(NULL, 'DE', 'de_short_term_max_work_days_per_year', '2015-01-01', '2020-03-01', 70, NULL, 'days', '§ 8 Abs. 1 Nr. 2 SGB IV', NULL),
	(NULL, 'DE', 'de_short_term_max_work_days_per_year', '2020-03-01', '2020-11-01', 115, NULL, 'days', '§ 115 SGB IV', 'Pandemic extension 01.03.-31.10.2020'),
	(NULL, 'DE', 'de_short_term_max_work_days_per_year', '2020-11-01', '2021-03-01', 70, NULL, 'days', '§ 8 Abs. 1 Nr. 2 SGB IV', NULL),
	(NULL, 'DE', 'de_short_term_max_work_days_per_year', '2021-03-01', '2021-11-01', 102, NULL, 'days', '§ 115 SGB IV', 'Pandemic extension 01.03.-31.10.2021'),
	(NULL, 'DE', 'de_short_term_max_work_days_per_year', '2021-11-01', NULL, 70, NULL, 'days', '§ 8 Abs. 1 Nr. 2 SGB IV', NULL),
	(NULL, 'DE', 'de_short_term_max_months_per_year', '2015-01-01', '2020-03-01', 3, NULL, 'months', '§ 8 Abs. 1 Nr. 2 SGB IV', NULL),
	(NULL, 'DE', 'de_short_term_max_months_per_year', '2020-03-01', '2020-11-01', 5, NULL, 'months', '§ 115 SGB IV', 'Pandemic extension 01.03.-31.10.2020'),
	(NULL, 'DE', 'de_short_term_max_months_per_year', '2020-11-01', '2021-03-01', 3, NULL, 'months', '§ 8 Abs. 1 Nr. 2 SGB IV', NULL),
	(NULL, 'DE', 'de_short_term_max_months_per_year', '2021-03-01', '2021-11-01', 4, NULL, 'months', '§ 115 SGB IV', 'Pandemic extension 01.03.-31.10.2021'),
	(NULL, 'DE', 'de_short_term_max_months_per_year', '2021-11-01', NULL, 3, NULL, 'months', '§ 8 Abs. 1 Nr. 2 SGB IV', NULL),
	-- Working student privilege, § 6 Abs. 1 Nr. 3 SGB V
	(NULL, 'DE', 'de_working_student_weekly_minutes', '2015-01-01', NULL, 1200, NULL, 'minutes', '§ 6 Abs. 1 Nr. 3 SGB V', '20 hours per week during lecture periods'),
	(NULL, 'DE', 'de_working_student_max_over_20h_weeks_per_12m', '2015-01-01', NULL, 26, NULL, 'weeks', '§ 6 Abs. 1 Nr. 3 SGB V', 'At most 26 weeks above 20 hours within twelve months'),
	(NULL, 'DE', 'de_working_student_max_over_20h_days_per_12m', '2015-01-01', NULL, 182, NULL, 'days', '§ 6 Abs. 1 Nr. 3 SGB V', 'Day equivalent of 26 weeks'),
	-- On-call work, § 12 TzBfG
	(NULL, 'DE', 'de_on_call_notice_full_days', '2001-01-01', NULL, 4, NULL, 'days', '§ 12 Abs. 3 TzBfG', 'Full calendar days between notification and shift'),
	(NULL, 'DE', 'de_on_call_min_call_minutes', '2001-01-01', NULL, 180, NULL, 'minutes', '§ 12 Abs. 1 Satz 4 TzBfG', 'Three consecutive hours per call when no daily duration is agreed'),
	(NULL, 'DE', 'de_on_call_default_weekly_minutes', '2001-01-01', '2019-01-01', 600, NULL, 'minutes', '§ 12 Abs. 1 Satz 3 TzBfG', '10 hours per week when no weekly duration is agreed'),
	(NULL, 'DE', 'de_on_call_default_weekly_minutes', '2019-01-01', NULL, 1200, NULL, 'minutes', '§ 12 Abs. 1 Satz 3 TzBfG', '20 hours per week when no weekly duration is agreed'),
	(NULL, 'DE', 'de_on_call_min_band_plus_pct', '2019-01-01', NULL, 25, NULL, 'percent', '§ 12 Abs. 2 TzBfG', 'Additional call-off above an agreed minimum'),
	(NULL, 'DE', 'de_on_call_max_band_minus_pct', '2019-01-01', NULL, 20, NULL, 'percent', '§ 12 Abs. 2 TzBfG', 'Call-off reduction below an agreed maximum'),
	-- Youth protection, JArbSchG
	(NULL, 'DE', 'de_jarbschg_max_daily_minutes', '2001-01-01', NULL, 480, NULL, 'minutes', '§ 8 Abs. 1 JArbSchG', NULL),
	(NULL, 'DE', 'de_jarbschg_max_daily_compensatory_minutes', '2001-01-01', NULL, 510, NULL, 'minutes', '§ 8 Abs. 2a JArbSchG', 'Only when other days of the week are shortened'),
	(NULL, 'DE', 'de_jarbschg_max_weekly_minutes', '2001-01-01', NULL, 2400, NULL, 'minutes', '§ 8 Abs. 1 JArbSchG', NULL),
	(NULL, 'DE', 'de_jarbschg_max_days_per_week', '2001-01-01', NULL, 5, NULL, 'days', '§ 15 JArbSchG', NULL),
	(NULL, 'DE', 'de_jarbschg_min_rest_minutes', '2001-01-01', NULL, 720, NULL, 'minutes', '§ 13 JArbSchG', NULL),
	(NULL, 'DE', 'de_jarbschg_break_after_270_minutes', '2001-01-01', NULL, 30, NULL, 'minutes', '§ 11 Abs. 1 Nr. 1 JArbSchG', 'Break for more than 4.5 up to 6 hours of work'),
	(NULL, 'DE', 'de_jarbschg_break_after_360_minutes', '2001-01-01', NULL, 60, NULL, 'minutes', '§ 11 Abs. 1 Nr. 2 JArbSchG', 'Break for more than 6 hours of work'),
	(NULL, 'DE', 'de_jarbschg_min_break_segment_minutes', '2001-01-01', NULL, 15, NULL, 'minutes', '§ 11 Abs. 1 Satz 3 JArbSchG', NULL),
	(NULL, 'DE', 'de_jarbschg_max_uninterrupted_minutes', '2001-01-01', NULL, 270, NULL, 'minutes', '§ 11 Abs. 2 Satz 2 JArbSchG', NULL),
	(NULL, 'DE', 'de_jarbschg_night_start', '2001-01-01', NULL, 1200, NULL, 'minute_of_day', '§ 14 Abs. 1 JArbSchG', '20:00 local time'),
	(NULL, 'DE', 'de_jarbschg_night_end', '2001-01-01', NULL, 360, NULL, 'minute_of_day', '§ 14 Abs. 1 JArbSchG', '06:00 local time')
ON CONFLICT ("country_code", "threshold_key", "effective_from_date") WHERE "organization_id" IS NULL
DO NOTHING;
--> statement-breakpoint
SELECT set_config('z8.statutory_baseline_maintenance', 'off', true);
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
-- One system baseline per key on any day: a later change must close the previous open-ended row,
-- or the migration fails here instead of the lookup silently using the older value.
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'statutory_threshold_system_no_overlap') THEN
		ALTER TABLE "statutory_threshold"
			ADD CONSTRAINT "statutory_threshold_system_no_overlap"
			EXCLUDE USING gist (
				"country_code" WITH =,
				"threshold_key" WITH =,
				daterange("effective_from_date", "effective_until_date", '[)') WITH &&
			) WHERE ("organization_id" IS NULL);
	END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "z8_guard_statutory_baseline"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF (TG_OP <> 'INSERT' AND OLD."organization_id" IS NULL)
		OR (TG_OP <> 'DELETE' AND NEW."organization_id" IS NULL)
	THEN
		IF coalesce(current_setting('z8.statutory_baseline_maintenance', true), '') <> 'on' THEN
			RAISE EXCEPTION 'Statutory baselines are platform-managed and read-only'
				USING ERRCODE = 'insufficient_privilege';
		END IF;
	END IF;
	IF TG_OP = 'DELETE' THEN
		RETURN OLD;
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "statutory_threshold_baseline_guard" ON "statutory_threshold";
--> statement-breakpoint
CREATE TRIGGER "statutory_threshold_baseline_guard"
	BEFORE INSERT OR UPDATE OR DELETE ON "statutory_threshold"
	FOR EACH ROW EXECUTE FUNCTION "z8_guard_statutory_baseline"();
--> statement-breakpoint
ALTER TABLE "contract_review_acknowledgement" ADD COLUMN IF NOT EXISTS "subject_key" text;
--> statement-breakpoint
ALTER TABLE "contract_review_acknowledgement" ADD COLUMN IF NOT EXISTS "input_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "contract_review_acknowledgement" ADD COLUMN IF NOT EXISTS "legal_note" text;
--> statement-breakpoint
-- The monitor finding kind the acknowledgement documents (e.g. `jarbschg_night_work`): several
-- findings may share an acknowledgement kind and subject (night and Sunday work on one shift).
ALTER TABLE "contract_review_acknowledgement" ADD COLUMN IF NOT EXISTS "finding_kind" text;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_review_ack_statutory_shape_check') THEN
		ALTER TABLE "contract_review_acknowledgement"
			ADD CONSTRAINT "contract_review_ack_statutory_shape_check"
			CHECK (
				("subject_key" IS NULL) = ("input_fingerprint" IS NULL)
				AND ("finding_kind" IS NULL) = ("input_fingerprint" IS NULL)
				AND (
					"input_fingerprint" IS NULL
					OR (
						"note" IS NOT NULL AND length(btrim("note")) > 0
						AND length(btrim("subject_key")) > 0
						AND length(btrim("finding_kind")) > 0
						AND length(btrim("input_fingerprint")) > 0
					)
				)
			);
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contractReviewAck_statutory_subject_idx"
	ON "contract_review_acknowledgement" (
		"organization_id", "employee_id", "review_kind", "finding_kind", "subject_key", "acknowledged_at"
	)
	WHERE "input_fingerprint" IS NOT NULL;
--> statement-breakpoint
-- Statutory acknowledgements are audit records: never updated, never turned into one by an update
-- (which could backdate it), and never deleted directly. Deletes cascading from the employee,
-- organization, agreement or employment history (nested trigger depth) stay allowed.
CREATE OR REPLACE FUNCTION "z8_guard_statutory_acknowledgement"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		IF OLD."input_fingerprint" IS NOT NULL AND pg_trigger_depth() <= 1 THEN
			RAISE EXCEPTION 'Statutory acknowledgements are immutable'
				USING ERRCODE = 'insufficient_privilege';
		END IF;
		RETURN OLD;
	END IF;
	IF OLD."input_fingerprint" IS NOT NULL OR NEW."input_fingerprint" IS NOT NULL THEN
		RAISE EXCEPTION 'Statutory acknowledgements are immutable'
			USING ERRCODE = 'insufficient_privilege';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "contract_review_ack_statutory_immutable" ON "contract_review_acknowledgement";
--> statement-breakpoint
CREATE TRIGGER "contract_review_ack_statutory_immutable"
	BEFORE UPDATE OR DELETE ON "contract_review_acknowledgement"
	FOR EACH ROW EXECUTE FUNCTION "z8_guard_statutory_acknowledgement"();
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_statutory_preference" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"warning_threshold_percent" integer DEFAULT 80 NOT NULL,
	"critical_threshold_percent" integer DEFAULT 95 NOT NULL,
	"block_jarbschg_shift_publish" boolean DEFAULT false NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_statutory_preference_organization_fk"
		FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE,
	CONSTRAINT "organization_statutory_preference_updated_by_fk"
		FOREIGN KEY ("updated_by") REFERENCES "user"("id") ON DELETE SET NULL,
	CONSTRAINT "organization_statutory_preference_percent_check"
		CHECK (
			"warning_threshold_percent" BETWEEN 1 AND 100
			AND "critical_threshold_percent" BETWEEN 1 AND 100
			AND "warning_threshold_percent" < "critical_threshold_percent"
		)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "employee_statutory_offset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"offset_kind" text NOT NULL,
	"valid_from_date" date NOT NULL,
	"valid_until_date" date,
	"amount_cents" integer,
	"currency" text,
	"count_value" integer,
	"source_employer" text,
	"note" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" text,
	"void_reason" text,
	CONSTRAINT "employee_statutory_offset_organization_fk"
		FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE,
	CONSTRAINT "employee_statutory_offset_employee_fk"
		FOREIGN KEY ("employee_id", "organization_id")
		REFERENCES "employee"("id", "organization_id") ON DELETE CASCADE,
	CONSTRAINT "employee_statutory_offset_created_by_fk"
		FOREIGN KEY ("created_by") REFERENCES "user"("id"),
	CONSTRAINT "employee_statutory_offset_voided_by_fk"
		FOREIGN KEY ("voided_by") REFERENCES "user"("id"),
	CONSTRAINT "employee_statutory_offset_kind_check"
		CHECK ("offset_kind" IN (
			'external_minijob_monthly_earnings',
			'prior_short_term_work_days',
			'prior_short_term_months',
			'prior_working_student_over_20h_weeks'
		)),
	CONSTRAINT "employee_statutory_offset_date_range_check"
		CHECK ("valid_until_date" IS NULL OR "valid_until_date" > "valid_from_date"),
	CONSTRAINT "employee_statutory_offset_note_check" CHECK (length(btrim("note")) > 0),
	CONSTRAINT "employee_statutory_offset_void_check"
		CHECK (
			("voided_at" IS NULL) = ("voided_by" IS NULL)
			AND ("voided_at" IS NULL OR length(btrim(coalesce("void_reason", ''))) > 0)
		),
	-- coalesce: a CHECK that evaluates to NULL passes, so a missing count or end date must fail.
	CONSTRAINT "employee_statutory_offset_value_check"
		CHECK (coalesce(
			CASE "offset_kind"
				WHEN 'external_minijob_monthly_earnings' THEN
					"amount_cents" IS NOT NULL AND "amount_cents" >= 0
					AND "currency" IS NOT NULL AND "count_value" IS NULL
				WHEN 'prior_short_term_work_days' THEN
					"count_value" BETWEEN 0 AND 366 AND "amount_cents" IS NULL
					AND date_trunc('year', "valid_from_date")::date = "valid_from_date"
					AND "valid_until_date" = ("valid_from_date" + interval '1 year')::date
				WHEN 'prior_short_term_months' THEN
					"count_value" BETWEEN 0 AND 12 AND "amount_cents" IS NULL
					AND date_trunc('year', "valid_from_date")::date = "valid_from_date"
					AND "valid_until_date" = ("valid_from_date" + interval '1 year')::date
				WHEN 'prior_working_student_over_20h_weeks' THEN
					-- `count_value` consecutive Monday-Sunday weeks, every one above 20 h, so a rolling
					-- window can age each week out exactly.
					"count_value" BETWEEN 1 AND 53 AND "amount_cents" IS NULL
					AND "valid_until_date" IS NOT NULL
					AND extract(isodow FROM "valid_from_date") = 1
					AND "valid_until_date" - "valid_from_date" = 7 * "count_value"
				ELSE false
			END,
			false
		))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employeeStatutoryOffset_lookup_idx"
	ON "employee_statutory_offset" ("organization_id", "employee_id", "offset_kind", "valid_from_date");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "employee_study_period" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"period_kind" text DEFAULT 'lecture_free' NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"note" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" text,
	"void_reason" text,
	CONSTRAINT "employee_study_period_organization_fk"
		FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE,
	CONSTRAINT "employee_study_period_employee_fk"
		FOREIGN KEY ("employee_id", "organization_id")
		REFERENCES "employee"("id", "organization_id") ON DELETE CASCADE,
	CONSTRAINT "employee_study_period_created_by_fk"
		FOREIGN KEY ("created_by") REFERENCES "user"("id"),
	CONSTRAINT "employee_study_period_voided_by_fk"
		FOREIGN KEY ("voided_by") REFERENCES "user"("id"),
	CONSTRAINT "employee_study_period_kind_check" CHECK ("period_kind" IN ('lecture_free')),
	CONSTRAINT "employee_study_period_date_range_check" CHECK ("ends_on" >= "starts_on"),
	CONSTRAINT "employee_study_period_void_check"
		CHECK (
			("voided_at" IS NULL) = ("voided_by" IS NULL)
			AND ("voided_at" IS NULL OR length(btrim(coalesce("void_reason", ''))) > 0)
		),
	CONSTRAINT "employee_study_period_no_overlap"
		EXCLUDE USING gist (
			"organization_id" WITH =,
			"employee_id" WITH =,
			daterange("starts_on", "ends_on", '[]') WITH &&
		) WHERE ("voided_at" IS NULL)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "employee_apprentice_release" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"release_kind" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"lesson_count" integer,
	"school_minutes" integer,
	"note" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" text,
	"void_reason" text,
	CONSTRAINT "employee_apprentice_release_organization_fk"
		FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE,
	CONSTRAINT "employee_apprentice_release_employee_fk"
		FOREIGN KEY ("employee_id", "organization_id")
		REFERENCES "employee"("id", "organization_id") ON DELETE CASCADE,
	CONSTRAINT "employee_apprentice_release_created_by_fk"
		FOREIGN KEY ("created_by") REFERENCES "user"("id"),
	CONSTRAINT "employee_apprentice_release_voided_by_fk"
		FOREIGN KEY ("voided_by") REFERENCES "user"("id"),
	CONSTRAINT "employee_apprentice_release_kind_check"
		CHECK ("release_kind" IN (
			'vocational_school_day',
			'vocational_school_block_week',
			'exam_day',
			'pre_exam_day'
		)),
	CONSTRAINT "employee_apprentice_release_date_range_check" CHECK ("ends_on" >= "starts_on"),
	CONSTRAINT "employee_apprentice_release_single_day_check"
		CHECK ("release_kind" = 'vocational_school_block_week' OR "ends_on" = "starts_on"),
	CONSTRAINT "employee_apprentice_release_amounts_check"
		CHECK (
			("lesson_count" IS NULL OR "lesson_count" BETWEEN 0 AND 20)
			AND ("school_minutes" IS NULL OR "school_minutes" BETWEEN 0 AND 10080)
		),
	CONSTRAINT "employee_apprentice_release_void_check"
		CHECK (
			("voided_at" IS NULL) = ("voided_by" IS NULL)
			AND ("voided_at" IS NULL OR length(btrim(coalesce("void_reason", ''))) > 0)
		),
	CONSTRAINT "employee_apprentice_release_no_overlap"
		EXCLUDE USING gist (
			"organization_id" WITH =,
			"employee_id" WITH =,
			daterange("starts_on", "ends_on", '[]') WITH &&
		) WHERE ("voided_at" IS NULL)
);
