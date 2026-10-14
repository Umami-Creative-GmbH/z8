-- #1196 (spec #881): a personnel number is unique per organization among current and
-- former employees. Stored numbers are trimmed with their case kept, and a blank one is
-- no number (NULL); two numbers are the same when they match ignoring case
-- (`normalizePersonnelNumber` / `personnelNumberKey` in lib/organization/personnel-number.ts).
-- The trim set below is JavaScript's `String.prototype.trim` set
-- (`PERSONNEL_NUMBER_WHITESPACE`); one-argument `btrim` would strip only spaces.
--
-- Preflight first: if numbers are already shared, the migration fails, lists every clash
-- and changes nothing. The operator fixes the clashes by hand and retries. The read-only
-- check is in docs/personnel-number-uniqueness-881.md.
DO $$
DECLARE
	whitespace constant text := E'\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
	clash_count bigint;
	clash_list text;
BEGIN
	WITH "numbered" AS (
		SELECT
			"id",
			"organization_id",
			btrim("employee_number", whitespace) AS "number"
		FROM "employee"
		WHERE btrim("employee_number", whitespace) <> ''
	),
	"clashes" AS (
		SELECT
			"organization_id",
			lower("number") AS "number_key",
			string_agg(format('%s ("%s")', "id", "number"), ', ' ORDER BY "id") AS "employees"
		FROM "numbered"
		GROUP BY "organization_id", lower("number")
		HAVING count(*) > 1
	)
	SELECT
		count(*),
		string_agg(
			format(
				'organization %s: personnel number "%s" is shared by employees %s',
				"organization_id",
				"number_key",
				"employees"
			),
			'; '
			ORDER BY "organization_id", "number_key"
		)
	INTO clash_count, clash_list
	FROM "clashes";

	IF clash_count > 0 THEN
		RAISE EXCEPTION USING
			ERRCODE = '23505',
			MESSAGE = 'Personnel number uniqueness preflight failed',
			DETAIL = format(
				'Found %s personnel numbers shared by several employees of one organization (compared trimmed and ignoring case): %s. Give each of these employees their own personnel number by hand, then retry migration 0232. No employee rows were changed.',
				clash_count,
				clash_list
			);
	END IF;
END;
$$;
--> statement-breakpoint
UPDATE "employee"
SET "employee_number" = NULLIF(
	btrim(
		"employee_number",
		E'\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'
	),
	''
)
WHERE "employee_number" IS DISTINCT FROM NULLIF(
	btrim(
		"employee_number",
		E'\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'
	),
	''
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "employee_organization_personnel_number_unique_idx"
	ON "employee" USING btree (
		"organization_id",
		lower(btrim(
			"employee_number",
			E'\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'
		))
	)
	WHERE btrim(
		"employee_number",
		E'\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'
	) <> '';
