-- #1162: a rehire wrote its terms at the rehire instant, while every other
-- terms row stores a calendar date as UTC midnight of that date (D1). Move each
-- rehire's terms (valid_from equal to its recorded period's started_at and not
-- already UTC midnight) to UTC midnight of the org-local rehire date, and the
-- employee work policy assignment they projected with them. The period start
-- stays the rehire instant. A row is skipped when another terms row of its
-- period already starts on that calendar date. valid_from and effective_from
-- are timestamps without time zone holding UTC wall time. The calendar rules
-- mirror utcMidnight and termsCalendarDate (lib/employment-history/
-- terms-in-force.ts); an unknown zone falls back to UTC like
-- resolveOrganizationTimezone.
WITH "rehire_terms" AS (
	SELECT
		h."id",
		h."organization_id",
		h."employee_id",
		h."employment_period_id",
		h."work_policy_id",
		h."valid_from" AS "old_valid_from",
		((p."started_at" AT TIME ZONE COALESCE(z."name", 'UTC'))::date)::timestamp AS "new_valid_from",
		COALESCE(z."name", 'UTC') AS "timezone"
	FROM "employee_employment_history" h
	JOIN "employee_employment_period" p
		ON p."id" = h."employment_period_id"
		AND p."organization_id" = h."organization_id"
		AND p."employee_id" = h."employee_id"
	JOIN "organization" o ON o."id" = p."organization_id"
	LEFT JOIN pg_catalog.pg_timezone_names z ON z."name" = o."timezone"
	WHERE p."start_provenance" = 'recorded'
		AND p."started_at" IS NOT NULL
		AND h."valid_from" = (p."started_at" AT TIME ZONE 'UTC')
		AND h."valid_from" <> date_trunc('day', h."valid_from")
),
"movable" AS (
	SELECT r.*
	FROM "rehire_terms" r
	WHERE NOT EXISTS (
		SELECT 1
		FROM "employee_employment_history" other
		WHERE other."organization_id" = r."organization_id"
			AND other."employee_id" = r."employee_id"
			AND other."employment_period_id" = r."employment_period_id"
			AND other."id" <> r."id"
			AND (
				CASE
					WHEN other."valid_from" = date_trunc('day', other."valid_from")
						THEN other."valid_from"::date
					ELSE ((other."valid_from" AT TIME ZONE 'UTC') AT TIME ZONE r."timezone")::date
				END
			) = r."new_valid_from"::date
	)
),
"moved" AS (
	UPDATE "employee_employment_history" h
	SET "valid_from" = m."new_valid_from"
	FROM "movable" m
	WHERE h."id" = m."id" AND h."organization_id" = m."organization_id"
	RETURNING m."organization_id", m."employee_id", m."work_policy_id", m."old_valid_from", m."new_valid_from"
)
UPDATE "work_policy_assignment" a
SET "effective_from" = moved."new_valid_from"
FROM "moved"
WHERE a."organization_id" = moved."organization_id"
	AND a."employee_id" = moved."employee_id"
	AND a."assignment_type" = 'employee'
	AND a."policy_id" = moved."work_policy_id"
	AND a."effective_from" = moved."old_valid_from";
