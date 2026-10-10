-- #816: wage type mappings belong to the organization, not to one export config.
-- The settings tab only ever wrote them on the DATEV config, while each export
-- read its own config, so non-DATEV exports never saw them. Every row carries a
-- code per format, and every format's export now reads only its own column.
ALTER TABLE "payroll_wage_type_mapping" ADD COLUMN IF NOT EXISTS "organization_id" text;
--> statement-breakpoint
DO $$ BEGIN
	IF EXISTS (
		SELECT 1 FROM information_schema.columns
		WHERE table_schema = current_schema()
			AND table_name = 'payroll_wage_type_mapping'
			AND column_name = 'config_id'
	) THEN
		UPDATE "payroll_wage_type_mapping" AS m
		SET "organization_id" = c."organization_id"
		FROM "payroll_export_config" AS c
		WHERE c."id" = m."config_id" AND m."organization_id" IS NULL;

		-- A row with only the legacy generic code meant its owning config's format.
		-- Move that code into the format's own column; exports no longer read it.
		UPDATE "payroll_wage_type_mapping" AS m
		SET
			"datev_wage_type_code" = CASE WHEN c."format_id" = 'datev_lohn' THEN m."wage_type_code" END,
			"datev_wage_type_name" = CASE WHEN c."format_id" = 'datev_lohn' THEN m."wage_type_name" END,
			"lexware_wage_type_code" = CASE WHEN c."format_id" = 'lexware_lohn' THEN m."wage_type_code" END,
			"lexware_wage_type_name" = CASE WHEN c."format_id" = 'lexware_lohn' THEN m."wage_type_name" END,
			"sage_wage_type_code" = CASE WHEN c."format_id" = 'sage_lohn' THEN m."wage_type_code" END,
			"sage_wage_type_name" = CASE WHEN c."format_id" = 'sage_lohn' THEN m."wage_type_name" END,
			"successfactors_time_type_code" = CASE WHEN c."format_id" LIKE 'successfactors%' THEN m."wage_type_code" END,
			"successfactors_time_type_name" = CASE WHEN c."format_id" LIKE 'successfactors%' THEN m."wage_type_name" END
		FROM "payroll_export_config" AS c
		WHERE c."id" = m."config_id"
			AND c."format_id" IN ('datev_lohn', 'lexware_lohn', 'sage_lohn', 'successfactors_api', 'successfactors_csv')
			AND m."wage_type_code" <> ''
			AND m."datev_wage_type_code" IS NULL
			AND m."lexware_wage_type_code" IS NULL
			AND m."sage_wage_type_code" IS NULL
			AND m."successfactors_time_type_code" IS NULL;

		-- One active mapping per source and organization. Keep the row of the active
		-- DATEV config (the only one the settings tab wrote), then any active config,
		-- then the most recently updated.
		DELETE FROM "payroll_wage_type_mapping" AS m
		USING (
			SELECT
				ranked_mapping."id",
				row_number() OVER (
					PARTITION BY
						ranked_mapping."organization_id",
						ranked_mapping."work_category_id",
						ranked_mapping."absence_category_id",
						ranked_mapping."special_category"
					ORDER BY
						(c."format_id" = 'datev_lohn' AND c."is_active") DESC,
						c."is_active" DESC,
						ranked_mapping."updated_at" DESC,
						ranked_mapping."id"
				) AS "rank"
			FROM "payroll_wage_type_mapping" AS ranked_mapping
			JOIN "payroll_export_config" AS c ON c."id" = ranked_mapping."config_id"
			WHERE ranked_mapping."is_active"
		) AS ranked
		WHERE m."id" = ranked."id" AND ranked."rank" > 1;
	END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "payroll_wage_type_mapping" ALTER COLUMN "organization_id" SET NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "payroll_wage_type_mapping" ADD CONSTRAINT "payroll_wage_type_mapping_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DROP INDEX IF EXISTS "payrollWageTypeMapping_config_workCategory_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "payrollWageTypeMapping_config_absenceCategory_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "payrollWageTypeMapping_config_specialCategory_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "payrollWageTypeMapping_configId_idx";
--> statement-breakpoint
ALTER TABLE "payroll_wage_type_mapping" DROP CONSTRAINT IF EXISTS "payroll_wage_type_mapping_config_id_payroll_export_config_id_fk";
--> statement-breakpoint
ALTER TABLE "payroll_wage_type_mapping" DROP COLUMN IF EXISTS "config_id";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payrollWageTypeMapping_organizationId_idx" ON "payroll_wage_type_mapping" USING btree ("organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payrollWageTypeMapping_org_workCategory_idx" ON "payroll_wage_type_mapping" USING btree ("organization_id","work_category_id") WHERE work_category_id IS NOT NULL AND is_active = true;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payrollWageTypeMapping_org_absenceCategory_idx" ON "payroll_wage_type_mapping" USING btree ("organization_id","absence_category_id") WHERE absence_category_id IS NOT NULL AND is_active = true;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payrollWageTypeMapping_org_specialCategory_idx" ON "payroll_wage_type_mapping" USING btree ("organization_id","special_category") WHERE special_category IS NOT NULL AND is_active = true;
