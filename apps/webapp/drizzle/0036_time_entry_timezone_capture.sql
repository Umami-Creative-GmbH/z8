ALTER TABLE "time_entry" ADD COLUMN IF NOT EXISTS "utc_offset_minutes" integer;
ALTER TABLE "time_entry" ADD COLUMN IF NOT EXISTS "timezone" text;
ALTER TABLE "time_entry" ADD COLUMN IF NOT EXISTS "timezone_source" text;

WITH "timezone_context" AS (
	SELECT
		"time_entry"."id",
		COALESCE("entry_zone"."name", "user_zone"."name", "organization_zone"."name", 'UTC') AS "inferred_timezone"
	FROM "time_entry"
	INNER JOIN "employee"
		ON "employee"."id" = "time_entry"."employee_id"
		AND "employee"."organization_id" = "time_entry"."organization_id"
	INNER JOIN "organization"
		ON "organization"."id" = "time_entry"."organization_id"
	LEFT JOIN "user_settings"
		ON "user_settings"."user_id" = "employee"."user_id"
	LEFT JOIN pg_timezone_names AS "entry_zone"
		ON "entry_zone"."name" = "time_entry"."timezone"
	LEFT JOIN pg_timezone_names AS "user_zone"
		ON "user_zone"."name" = NULLIF("user_settings"."timezone", 'UTC')
	LEFT JOIN pg_timezone_names AS "organization_zone"
		ON "organization_zone"."name" = NULLIF("organization"."timezone", 'UTC')
	WHERE
		"time_entry"."utc_offset_minutes" IS NULL
		OR "time_entry"."timezone" IS NULL
		OR "time_entry"."timezone_source" IS NULL
)
UPDATE "time_entry"
SET
	"utc_offset_minutes" = COALESCE(
		"time_entry"."utc_offset_minutes",
		ROUND(
			EXTRACT(
				EPOCH FROM (
					(("time_entry"."timestamp" AT TIME ZONE 'UTC') AT TIME ZONE "timezone_context"."inferred_timezone")
					- "time_entry"."timestamp"
				)
			) / 60
		)::integer
	),
	"timezone" = COALESCE("time_entry"."timezone", "timezone_context"."inferred_timezone"),
	"timezone_source" = COALESCE("time_entry"."timezone_source", 'historical_inference')
FROM "timezone_context"
WHERE "time_entry"."id" = "timezone_context"."id";

ALTER TABLE "time_entry" ALTER COLUMN "utc_offset_minutes" SET NOT NULL;
ALTER TABLE "time_entry" ALTER COLUMN "timezone_source" SET NOT NULL;
