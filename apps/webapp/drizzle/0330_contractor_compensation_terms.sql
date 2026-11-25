-- #1998 (spec #1935): effective-dated compensation terms of External Contractors.
--
-- Hourly or daily, per contractor employment period, strictly apart from employee
-- employment terms (`contract_type` fixed | hourly), payroll and Billable Time
-- cost rates. Periods are half-open date ranges [effective_from, effective_to) of
-- the contractor's local calendar days; the database refuses overlapping periods
-- of one employment period. A daily basis needs a day-unit rule and exactly its
-- settings; an hourly basis has none. Additive and idempotent.
CREATE EXTENSION IF NOT EXISTS "btree_gist";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contractor_compensation_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"employment_period_id" uuid NOT NULL,
	"compensation_basis" text NOT NULL,
	"rate_amount" numeric(12, 3) NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"day_unit_rule" text,
	"half_day_threshold_minutes" integer,
	"standard_day_minutes" integer,
	"cap_at_one_day" boolean,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "contractorCompensationTerms_basis_check"
		CHECK ("compensation_basis" IN ('hourly', 'daily')),
	CONSTRAINT "contractorCompensationTerms_rate_positive_check" CHECK ("rate_amount" > 0),
	CONSTRAINT "contractorCompensationTerms_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "contractorCompensationTerms_period_check"
		CHECK ("effective_to" IS NULL OR "effective_to" > "effective_from"),
	-- IS TRUE: a comparison with NULL must refuse the row, not pass the check.
	CONSTRAINT "contractorCompensationTerms_day_unit_rule_check" CHECK ((
		(
			"compensation_basis" = 'hourly'
			AND "day_unit_rule" IS NULL
			AND "half_day_threshold_minutes" IS NULL
			AND "standard_day_minutes" IS NULL
			AND "cap_at_one_day" IS NULL
		) OR (
			"compensation_basis" = 'daily'
			AND "day_unit_rule" = 'any_work_full_day'
			AND "half_day_threshold_minutes" IS NULL
			AND "standard_day_minutes" IS NULL
			AND "cap_at_one_day" IS NULL
		) OR (
			"compensation_basis" = 'daily'
			AND "day_unit_rule" = 'half_and_full_day'
			AND "half_day_threshold_minutes" BETWEEN 1 AND 1440
			AND "standard_day_minutes" IS NULL
			AND "cap_at_one_day" IS NULL
		) OR (
			"compensation_basis" = 'daily'
			AND "day_unit_rule" = 'prorated_by_standard_day'
			AND "half_day_threshold_minutes" IS NULL
			AND "standard_day_minutes" BETWEEN 1 AND 1440
			AND "cap_at_one_day" IS NOT NULL
		)
	) IS TRUE)
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "contractor_compensation_terms"
		ADD CONSTRAINT "contractor_compensation_terms_organization_id_organization_id_fk"
		FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "contractor_compensation_terms"
		ADD CONSTRAINT "contractorCompensationTerms_period_fk"
		FOREIGN KEY ("employment_period_id", "organization_id", "employee_id")
		REFERENCES "public"."employee_employment_period"("id", "organization_id", "employee_id")
		ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "contractor_compensation_terms"
		ADD CONSTRAINT "contractor_compensation_terms_created_by_user_id_fk"
		FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "contractor_compensation_terms"
		ADD CONSTRAINT "contractor_compensation_terms_updated_by_user_id_fk"
		FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contractorCompensationTerms_employee_idx"
	ON "contractor_compensation_terms" USING btree ("organization_id", "employee_id", "effective_from");
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "contractor_compensation_terms"
		ADD CONSTRAINT "contractorCompensationTerms_no_overlap"
		EXCLUDE USING gist (
			"organization_id" WITH =,
			"employee_id" WITH =,
			"employment_period_id" WITH =,
			daterange("effective_from", "effective_to", '[)') WITH &&
		);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
-- Terms belong to contractor periods only. A period's engagement kind never
-- changes (0329), so checking on write is enough.
CREATE OR REPLACE FUNCTION "contractor_compensation_terms_contractor_period"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM public."employee_employment_period" AS p
		WHERE p."id" = NEW.employment_period_id
			AND p."organization_id" = NEW.organization_id
			AND p."employee_id" = NEW.employee_id
			AND p."engagement_kind" = 'contractor'
	) THEN
		RAISE EXCEPTION USING
			ERRCODE = '23514',
			CONSTRAINT = 'contractorCompensationTerms_contractor_period',
			MESSAGE = 'Contractor compensation terms belong to a contractor employment period';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "contractor_compensation_terms_contractor_period_trigger"
	ON "contractor_compensation_terms";
--> statement-breakpoint
CREATE TRIGGER "contractor_compensation_terms_contractor_period_trigger"
	BEFORE INSERT OR UPDATE OF "employment_period_id", "organization_id", "employee_id"
	ON "contractor_compensation_terms"
	FOR EACH ROW EXECUTE FUNCTION "contractor_compensation_terms_contractor_period"();
