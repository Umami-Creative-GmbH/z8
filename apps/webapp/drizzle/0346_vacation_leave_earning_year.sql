-- #2080: leave keeps its earning year and earning policy across year-end and policy changes.
--
-- 1. HR designates per vacation policy whether German leave-expiry rules apply. The designation is
--    kept outside `vacation_allowance` so the policy revision trigger (0264) cannot time-slice it:
--    it describes all leave ever earned under the policy. No row = unclassified.
CREATE TABLE IF NOT EXISTS "vacation_policy_expiry_classification" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
 "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
 "policy_id" uuid NOT NULL REFERENCES "vacation_allowance"("id") ON DELETE CASCADE,
 "expiry_rules" text NOT NULL CHECK (expiry_rules IN ('german','policy_terms')),
 "extra_days_separate_terms" boolean DEFAULT false NOT NULL,
 "extra_days_terms_basis" text,
 "classified_by" text REFERENCES "user"("id") ON DELETE SET NULL,
 "classified_at" timestamp with time zone DEFAULT now() NOT NULL,
 CONSTRAINT "vacation_policy_expiry_classification_separate_terms_check" CHECK (expiry_rules = 'german' OR NOT extra_days_separate_terms),
 CONSTRAINT "vacation_policy_expiry_classification_basis_check" CHECK (NOT extra_days_separate_terms OR length(btrim(coalesce(extra_days_terms_basis, ''))) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vacation_policy_expiry_classification_policy_idx" ON "vacation_policy_expiry_classification" (policy_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vacation_policy_expiry_classification_org_idx" ON "vacation_policy_expiry_classification" (organization_id);
--> statement-breakpoint
-- A designation is final: leave already earned under it must never change meaning. Only the
-- foreign key clearing a deleted user may touch a row.
CREATE OR REPLACE FUNCTION "vacation_policy_expiry_classification_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW.id IS DISTINCT FROM OLD.id
		OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
		OR NEW.policy_id IS DISTINCT FROM OLD.policy_id
		OR NEW.expiry_rules IS DISTINCT FROM OLD.expiry_rules
		OR NEW.extra_days_separate_terms IS DISTINCT FROM OLD.extra_days_separate_terms
		OR NEW.extra_days_terms_basis IS DISTINCT FROM OLD.extra_days_terms_basis
		OR NEW.classified_at IS DISTINCT FROM OLD.classified_at
		OR (NEW.classified_by IS DISTINCT FROM OLD.classified_by AND NEW.classified_by IS NOT NULL)
	THEN
		RAISE EXCEPTION USING
			ERRCODE = '55000',
			MESSAGE = 'A vacation policy expiry classification is final';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "vacation_policy_expiry_classification_guard" ON "vacation_policy_expiry_classification";
--> statement-breakpoint
CREATE TRIGGER "vacation_policy_expiry_classification_guard"
BEFORE UPDATE ON "vacation_policy_expiry_classification"
FOR EACH ROW EXECUTE FUNCTION "vacation_policy_expiry_classification_guard"();
--> statement-breakpoint
-- 2. Earning-year leave: the days of one earning year (and portion) that a committed year-end
--    transfer carried into its receiving year. Carrying the same leave again at the next year-end
--    creates a successor row (`carried_from_id`), so the earning year and earning policy survive
--    every hop instead of being pooled into the next transfer.
CREATE TABLE IF NOT EXISTS "vacation_earning_year_leave" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
 "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
 "employee_id" uuid NOT NULL,
 "transfer_id" uuid NOT NULL REFERENCES "vacation_carryover_transfer"("id") ON DELETE CASCADE,
 "receiving_year" integer NOT NULL,
 "earning_year" integer NOT NULL,
 "earning_policy_id" uuid REFERENCES "vacation_allowance"("id") ON DELETE SET NULL,
 "portion" text NOT NULL CHECK (portion IN ('all','statutory','extra')),
 "days" numeric NOT NULL CHECK (days >= 0),
 "forfeited_days" numeric DEFAULT 0 NOT NULL CHECK (forfeited_days >= 0),
 "configured_expiry_date" timestamp with time zone,
 "timezone" text NOT NULL,
 "carried_from_id" uuid REFERENCES "vacation_earning_year_leave"("id") ON DELETE SET NULL,
 "expired_days" numeric DEFAULT 0 NOT NULL,
 "expired_at" timestamp with time zone,
 "expired_by" text,
 "created_at" timestamp with time zone DEFAULT now() NOT NULL,
 CONSTRAINT "vacation_earning_year_leave_years_check" CHECK (earning_year < receiving_year),
 CONSTRAINT "vacation_earning_year_leave_expired_check" CHECK (expired_days >= 0 AND expired_days <= days AND (expired_at IS NULL) = (expired_by IS NULL)),
 FOREIGN KEY (employee_id,organization_id) REFERENCES employee(id,organization_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vacation_earning_year_leave_transfer_idx" ON "vacation_earning_year_leave" (transfer_id,earning_year,portion);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vacation_earning_year_leave_successor_idx" ON "vacation_earning_year_leave" (carried_from_id) WHERE carried_from_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vacation_earning_year_leave_employee_idx" ON "vacation_earning_year_leave" (organization_id,employee_id,receiving_year);
--> statement-breakpoint
-- 3. Existing committed transfers become one earning-year row of their source year. Earlier pooled
--    years are not identifiable, so they stay attributed to the source year; an expired transfer
--    keeps its debit.
INSERT INTO "vacation_earning_year_leave" (organization_id, employee_id, transfer_id, receiving_year, earning_year, earning_policy_id, portion, days, configured_expiry_date, timezone, expired_days, expired_at, expired_by, created_at)
SELECT t.organization_id, t.employee_id, t.id, t.source_year + 1, t.source_year,
	(SELECT p.id FROM vacation_allowance p WHERE p.id = t.source_policy_id),
	'all', t.days, t.expiry_date, t.timezone,
	CASE WHEN t.expired_at IS NOT NULL THEN t.days ELSE 0 END,
	t.expired_at,
	CASE WHEN t.expired_at IS NOT NULL THEN coalesce(t.expired_by, 'system-automation') END,
	t.created_at
FROM vacation_carryover_transfer t
WHERE t.outcome = 'generated' AND t.days > 0
ON CONFLICT DO NOTHING;
