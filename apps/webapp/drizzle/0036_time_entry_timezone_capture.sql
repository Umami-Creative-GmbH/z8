ALTER TABLE "time_entry" ADD COLUMN IF NOT EXISTS "utc_offset_minutes" integer;
ALTER TABLE "time_entry" ADD COLUMN IF NOT EXISTS "timezone" text;
ALTER TABLE "time_entry" ADD COLUMN IF NOT EXISTS "timezone_source" text;

UPDATE "time_entry"
SET
	"utc_offset_minutes" = 120,
	"timezone" = COALESCE("timezone", 'Europe/Berlin'),
	"timezone_source" = COALESCE("timezone_source", 'backfill')
WHERE "utc_offset_minutes" IS NULL OR "timezone_source" IS NULL;

ALTER TABLE "time_entry" ALTER COLUMN "utc_offset_minutes" SET NOT NULL;
ALTER TABLE "time_entry" ALTER COLUMN "timezone_source" SET NOT NULL;
