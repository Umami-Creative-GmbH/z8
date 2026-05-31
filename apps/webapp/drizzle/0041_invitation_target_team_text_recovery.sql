ALTER TABLE "invitation"
	ALTER COLUMN "target_team_id" TYPE text
	USING "target_team_id"::text;
