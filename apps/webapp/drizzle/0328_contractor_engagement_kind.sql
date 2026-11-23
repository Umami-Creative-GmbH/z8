-- #1995 (spec #1935): External Contractors as an engagement kind.
--
-- `employee.engagement_kind` is the kind in force today; every
-- `employee_employment_period` records the kind of its stint. Existing rows
-- become 'employee' through the column default; employee `contract_type`
-- (fixed | hourly) is untouched. Text checks instead of an enum, as elsewhere
-- in the lifecycle schema.
ALTER TABLE "employee"
	ADD COLUMN IF NOT EXISTS "engagement_kind" text DEFAULT 'employee' NOT NULL;
--> statement-breakpoint
ALTER TABLE "employee" DROP CONSTRAINT IF EXISTS "employee_engagement_kind_check";
--> statement-breakpoint
ALTER TABLE "employee"
	ADD CONSTRAINT "employee_engagement_kind_check"
	CHECK ("engagement_kind" IN ('employee', 'contractor'));
--> statement-breakpoint
ALTER TABLE "employee_employment_period"
	ADD COLUMN IF NOT EXISTS "engagement_kind" text DEFAULT 'employee' NOT NULL;
--> statement-breakpoint
ALTER TABLE "employee_employment_period"
	DROP CONSTRAINT IF EXISTS "employeeEmploymentPeriod_engagement_kind_check";
--> statement-breakpoint
ALTER TABLE "employee_employment_period"
	ADD CONSTRAINT "employeeEmploymentPeriod_engagement_kind_check"
	CHECK ("engagement_kind" IN ('employee', 'contractor'));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employee_organization_engagement_kind_idx"
	ON "employee" USING btree ("organization_id", "engagement_kind");
--> statement-breakpoint
-- A period's engagement kind is its legal status for that stint and never
-- changes, open or closed: converting contractor <-> employee ends the period
-- and starts a new one.
CREATE OR REPLACE FUNCTION "employee_employment_period_engagement_kind_immutable"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW.engagement_kind IS DISTINCT FROM OLD.engagement_kind THEN
		RAISE EXCEPTION USING
			ERRCODE = '23514',
			CONSTRAINT = 'employee_engagement_kind_immutable',
			MESSAGE = 'The engagement kind of an employment period never changes; end the period and start a new one';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "employee_employment_period_engagement_kind_immutable_trigger"
	ON "employee_employment_period";
--> statement-breakpoint
CREATE TRIGGER "employee_employment_period_engagement_kind_immutable_trigger"
	BEFORE UPDATE OF "engagement_kind" ON "employee_employment_period"
	FOR EACH ROW EXECUTE FUNCTION "employee_employment_period_engagement_kind_immutable"();
--> statement-breakpoint
-- The employee's engagement kind follows its periods: it may change only once
-- no open period (nor a legacy period that a reactivation would reopen) has a
-- different kind, and only for an employee with a period at all (one without is
-- still on its first, not yet backfilled stint). A rehire inserts the new open
-- period first, then updates the employee to match.
CREATE OR REPLACE FUNCTION "employee_engagement_kind_follows_period"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW.engagement_kind IS NOT DISTINCT FROM OLD.engagement_kind THEN
		RETURN NEW;
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM public."employee_employment_period" AS p
		WHERE p."organization_id" = NEW.organization_id AND p."employee_id" = NEW.id
	) OR EXISTS (
		SELECT 1 FROM public."employee_employment_period" AS p
		WHERE p."organization_id" = NEW.organization_id
			AND p."employee_id" = NEW.id
			AND (p."status" = 'open' OR (p."status" = 'legacy_unknown' AND p."ended_at" IS NULL))
			AND p."engagement_kind" <> NEW.engagement_kind
	) THEN
		RAISE EXCEPTION USING
			ERRCODE = '23514',
			CONSTRAINT = 'employee_engagement_kind_immutable',
			MESSAGE = 'The engagement kind of an active employment period cannot change in place; end the period and start a new one';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "employee_engagement_kind_follows_period_trigger" ON "employee";
--> statement-breakpoint
CREATE TRIGGER "employee_engagement_kind_follows_period_trigger"
	BEFORE UPDATE OF "engagement_kind" ON "employee"
	FOR EACH ROW EXECUTE FUNCTION "employee_engagement_kind_follows_period"();
--> statement-breakpoint
-- Same as 0071, except that a backfilled legacy period takes the employee's
-- engagement kind.
CREATE OR REPLACE FUNCTION "employee_employment_period_backfill_legacy"(
	p_organization_id text DEFAULT NULL,
	p_employee_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
	inserted_count integer;
BEGIN
	WITH "candidate" AS (
		SELECT
			e."id" AS employee_id,
			e."organization_id",
			e."is_active",
			e."engagement_kind",
			COALESCE(
				e."start_date" AT TIME ZONE 'UTC',
				(
					SELECT min(h."valid_from") AT TIME ZONE 'UTC'
					FROM public."employee_employment_history" AS h
					WHERE h."organization_id" = e."organization_id"
						AND h."employee_id" = e."id"
						AND h."review_state" = 'confirmed'
				)
			) AS known_start,
			e."end_date" AT TIME ZONE 'UTC' AS known_end
		FROM public."employee" AS e
		WHERE (p_organization_id IS NULL OR e."organization_id" = p_organization_id)
			AND (p_employee_id IS NULL OR e."id" = p_employee_id)
			AND NOT EXISTS (
				SELECT 1 FROM public."employee_employment_period" AS p
				WHERE p."organization_id" = e."organization_id" AND p."employee_id" = e."id"
			)
	), "classified" AS (
		SELECT
			c.*,
			(
				NOT c."is_active"
				AND c.known_end IS NOT NULL
				AND (c.known_start IS NULL OR c.known_end >= c.known_start)
			) AS has_trusted_end,
			(
				c.known_start IS NOT NULL
				AND c.known_end IS NOT NULL
				AND c.known_end < c.known_start
			) AS is_inverted
		FROM "candidate" AS c
	), "inserted" AS (
		INSERT INTO public."employee_employment_period"
			("organization_id", "employee_id", "status", "started_at", "ended_at",
			 "start_provenance", "legacy_diagnostic", "engagement_kind")
		SELECT
			k."organization_id",
			k.employee_id,
			CASE
				WHEN k."is_active" THEN 'open'
				WHEN k.has_trusted_end THEN 'closed'
				ELSE 'legacy_unknown'
			END,
			k.known_start,
			CASE WHEN k.has_trusted_end THEN k.known_end END,
			CASE WHEN k.known_start IS NULL THEN 'unknown' ELSE 'legacy' END,
			CASE WHEN NOT k."is_active" AND k.is_inverted THEN 'end_before_start' END,
			k."engagement_kind"
		FROM "classified" AS k
		RETURNING 1
	)
	SELECT count(*)::integer INTO inserted_count FROM "inserted";

	-- Attach unlinked terms only where the employee's sole period is legacy, so
	-- terms are never assigned to a later stint by guesswork.
	UPDATE public."employee_employment_history" AS h
	SET "employment_period_id" = p."id"
	FROM public."employee_employment_period" AS p
	WHERE h."employment_period_id" IS NULL
		AND p."organization_id" = h."organization_id"
		AND p."employee_id" = h."employee_id"
		AND p."start_provenance" IN ('legacy', 'unknown')
		AND (p_organization_id IS NULL OR h."organization_id" = p_organization_id)
		AND (p_employee_id IS NULL OR h."employee_id" = p_employee_id)
		AND NOT EXISTS (
			SELECT 1 FROM public."employee_employment_period" AS other
			WHERE other."organization_id" = p."organization_id"
				AND other."employee_id" = p."employee_id"
				AND other."id" <> p."id"
		);

	RETURN inserted_count;
END;
$$;
--> statement-breakpoint
-- Optional, organization-scoped contracting details of an External Contractor:
-- the contracting company, its VAT ID and a PO or cost-center reference. Kept
-- apart from the employee profile and custom fields.
CREATE TABLE IF NOT EXISTS "employee_contractor_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"company_name" text,
	"vat_id" text,
	"reference_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "employeeContractorProfile_org_employee_unique" UNIQUE ("organization_id", "employee_id"),
	CONSTRAINT "employeeContractorProfile_company_name_check"
		CHECK ("company_name" IS NULL OR char_length("company_name") <= 200),
	CONSTRAINT "employeeContractorProfile_vat_id_check"
		CHECK ("vat_id" IS NULL OR char_length("vat_id") <= 50),
	CONSTRAINT "employeeContractorProfile_reference_code_check"
		CHECK ("reference_code" IS NULL OR char_length("reference_code") <= 100)
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "employee_contractor_profile"
		ADD CONSTRAINT "employeeContractorProfile_organization_fk"
		FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "employee_contractor_profile"
		ADD CONSTRAINT "employeeContractorProfile_employee_fk"
		FOREIGN KEY ("employee_id", "organization_id")
		REFERENCES "public"."employee"("id", "organization_id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "employee_contractor_profile"
		ADD CONSTRAINT "employeeContractorProfile_updated_by_fk"
		FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
-- An invitation can prepare an External Contractor: the engagement kind, the
-- optional contracting details, projects to assign and a planned engagement
-- end, which joining turns into a scheduled departure.
ALTER TABLE "employee_invitation_draft"
	ADD COLUMN IF NOT EXISTS "engagement_kind" text DEFAULT 'employee' NOT NULL;
--> statement-breakpoint
ALTER TABLE "employee_invitation_draft"
	DROP CONSTRAINT IF EXISTS "employeeInvitationDraft_engagement_kind_check";
--> statement-breakpoint
ALTER TABLE "employee_invitation_draft"
	ADD CONSTRAINT "employeeInvitationDraft_engagement_kind_check"
	CHECK ("engagement_kind" IN ('employee', 'contractor'));
--> statement-breakpoint
ALTER TABLE "employee_invitation_draft" ADD COLUMN IF NOT EXISTS "contractor_company_name" text;
--> statement-breakpoint
ALTER TABLE "employee_invitation_draft" ADD COLUMN IF NOT EXISTS "contractor_vat_id" text;
--> statement-breakpoint
ALTER TABLE "employee_invitation_draft" ADD COLUMN IF NOT EXISTS "contractor_reference_code" text;
--> statement-breakpoint
ALTER TABLE "employee_invitation_draft" ADD COLUMN IF NOT EXISTS "planned_end_date" date;
--> statement-breakpoint
ALTER TABLE "employee_invitation_draft"
	ADD COLUMN IF NOT EXISTS "project_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;
