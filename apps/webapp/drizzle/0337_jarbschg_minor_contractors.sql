-- #2022: whether External Contractor days of minors are judged under JArbSchG like employee days
-- (§ 1 Abs. 1 Nr. 3 JArbSchG), as an organization statutory preference. Default off: each minor
-- contractor engagement is flagged for review instead; existing rows keep that.
-- Re-runnable: `drizzle-kit push` may already have created the column.
ALTER TABLE "organization_statutory_preference" ADD COLUMN IF NOT EXISTS "apply_jarbschg_to_minor_contractors" boolean DEFAULT false NOT NULL;
