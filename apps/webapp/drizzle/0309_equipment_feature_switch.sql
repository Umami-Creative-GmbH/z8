-- Equipment tracking feature switch (#1572, spec #1535).
-- The switch is an organization feature flag like personnel files. It is off by
-- default. Organizations that already set up or recorded equipment keep it on, so
-- nobody loses records in use when the switch ships.
-- Idempotent: the column and its backfill are added only once, so a replay never
-- switches equipment back on for an organization that has since switched it off.
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'organization' AND column_name = 'equipment_enabled'
	) THEN
		ALTER TABLE "organization" ADD COLUMN "equipment_enabled" boolean DEFAULT false;
		UPDATE "organization" SET "equipment_enabled" = true
		WHERE EXISTS (SELECT 1 FROM "equipment_policy" WHERE "equipment_policy"."organization_id" = "organization"."id")
			OR EXISTS (SELECT 1 FROM "equipment_type" WHERE "equipment_type"."organization_id" = "organization"."id")
			OR EXISTS (SELECT 1 FROM "equipment_assignment" WHERE "equipment_assignment"."organization_id" = "organization"."id")
			OR EXISTS (SELECT 1 FROM "equipment_officer_grant" WHERE "equipment_officer_grant"."organization_id" = "organization"."id");
	END IF;
END $$;
