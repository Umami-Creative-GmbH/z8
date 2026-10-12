-- Tracked custom fields keep a dated history of values (#819, spec #769, ADR 0001).
-- A value row copies its field's tracked flag ("tracked"), held in step by the
-- definition foreign key, which now also covers the flag (fields can't switch
-- between tracked and untracked). A CHECK then requires a valid-from date on
-- tracked values and forbids one on untracked values, and a record holds at
-- most one value per field and valid-from date.
-- Values of tracked fields written before this migration (undated, #818) become
-- valid from the day they were created (UTC); #818 never shipped outside the
-- spec branch, so this only touches test data.
-- Idempotent: the migration runner test replays every migration after 0141.
DO $$ BEGIN
	ALTER TABLE "custom_field_definition" ADD CONSTRAINT "custom_field_definition_id_organization_id_tracked_unique" UNIQUE("id","organization_id","tracked");
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
END $$;--> statement-breakpoint
ALTER TABLE "custom_field_value" ADD COLUMN IF NOT EXISTS "tracked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "custom_field_value" AS "value"
SET "tracked" = "definition"."tracked"
FROM "custom_field_definition" AS "definition"
WHERE "definition"."id" = "value"."definition_id"
	AND "value"."tracked" IS DISTINCT FROM "definition"."tracked";--> statement-breakpoint
UPDATE "custom_field_value"
SET "valid_from" = ("created_at" AT TIME ZONE 'UTC')::date
WHERE "tracked" AND "valid_from" IS NULL;--> statement-breakpoint
DO $$ BEGIN
	IF EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'custom_field_value_definition_fk'
			AND conrelid = '"custom_field_value"'::regclass
			AND cardinality(conkey) = 2
	) THEN
		ALTER TABLE "custom_field_value" DROP CONSTRAINT "custom_field_value_definition_fk";
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "custom_field_value" ADD CONSTRAINT "custom_field_value_definition_fk" FOREIGN KEY ("definition_id","organization_id","tracked") REFERENCES "public"."custom_field_definition"("id","organization_id","tracked") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "custom_field_value" ADD CONSTRAINT "custom_field_value_valid_from_check" CHECK ("custom_field_value"."tracked" = ("custom_field_value"."valid_from" IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "custom_field_value_employee_dated_unique" ON "custom_field_value" USING btree ("definition_id","employee_id","valid_from") WHERE "custom_field_value"."employee_id" IS NOT NULL AND "custom_field_value"."valid_from" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "custom_field_value_project_dated_unique" ON "custom_field_value" USING btree ("definition_id","project_id","valid_from") WHERE "custom_field_value"."project_id" IS NOT NULL AND "custom_field_value"."valid_from" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "custom_field_value_customer_dated_unique" ON "custom_field_value" USING btree ("definition_id","customer_id","valid_from") WHERE "custom_field_value"."customer_id" IS NOT NULL AND "custom_field_value"."valid_from" IS NOT NULL;
