CREATE TYPE "public"."work_location_type_new" AS ENUM('office', 'home', 'remote', 'other');
--> statement-breakpoint
ALTER TABLE "work_period"
	ALTER COLUMN "work_location_type" TYPE "public"."work_location_type_new"
	USING CASE
		WHEN "work_location_type"::text = 'field' THEN 'remote'::"public"."work_location_type_new"
		WHEN "work_location_type" IS NULL THEN NULL
		ELSE "work_location_type"::text::"public"."work_location_type_new"
	END;
--> statement-breakpoint
ALTER TABLE "time_record_work"
	ALTER COLUMN "work_location_type" TYPE "public"."work_location_type_new"
	USING CASE
		WHEN "work_location_type"::text = 'field' THEN 'remote'::"public"."work_location_type_new"
		WHEN "work_location_type" IS NULL THEN NULL
		ELSE "work_location_type"::text::"public"."work_location_type_new"
	END;
--> statement-breakpoint
DROP TYPE "public"."work_location_type";
--> statement-breakpoint
ALTER TYPE "public"."work_location_type_new" RENAME TO "work_location_type";
