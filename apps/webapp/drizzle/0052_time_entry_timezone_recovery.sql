WITH "fabricated_entries" AS (
	SELECT "id", "employee_id", "organization_id"
	FROM "time_entry"
	WHERE
		"timezone_source" = 'backfill'
		AND "timezone" = 'Europe/Berlin'
		AND "utc_offset_minutes" = 120
		AND "created_at" <= TIMESTAMP '2026-05-31 00:00:00'
),
"timezone_context" AS (
	SELECT
		"fabricated_entries"."id",
		COALESCE("user_zone"."name", "organization_zone"."name", 'UTC') AS "inferred_timezone"
	FROM "fabricated_entries"
	INNER JOIN "employee"
		ON "employee"."id" = "fabricated_entries"."employee_id"
		AND "employee"."organization_id" = "fabricated_entries"."organization_id"
	INNER JOIN "organization"
		ON "organization"."id" = "fabricated_entries"."organization_id"
	LEFT JOIN "user_settings"
		ON "user_settings"."user_id" = "employee"."user_id"
	LEFT JOIN pg_timezone_names AS "user_zone"
		ON "user_zone"."name" = NULLIF("user_settings"."timezone", 'UTC')
	LEFT JOIN pg_timezone_names AS "organization_zone"
		ON "organization_zone"."name" = NULLIF("organization"."timezone", 'UTC')
)
UPDATE "time_entry"
SET
	"utc_offset_minutes" = ROUND(
		EXTRACT(
			EPOCH FROM (
				(("time_entry"."timestamp" AT TIME ZONE 'UTC') AT TIME ZONE "timezone_context"."inferred_timezone")
				- "time_entry"."timestamp"
			)
		) / 60
	)::integer,
	"timezone" = "timezone_context"."inferred_timezone",
	"timezone_source" = 'historical_inference'
FROM "timezone_context"
WHERE "time_entry"."id" = "timezone_context"."id";
