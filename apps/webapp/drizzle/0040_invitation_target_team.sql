ALTER TABLE "invitation" ADD COLUMN IF NOT EXISTS "target_team_id" text;

CREATE INDEX IF NOT EXISTS "invitation_targetTeamId_idx"
	ON "invitation" ("target_team_id");
