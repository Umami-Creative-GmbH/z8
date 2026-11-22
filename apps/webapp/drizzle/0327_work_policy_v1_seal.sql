-- Phase 3 (0327): Zero-DDL, zero-table-scan, zero-ACCESS-EXCLUSIVE policy v1 sealing.
-- Acquires EXCLUSIVE lock on work_policy (allowing concurrent reads), verifies NOT NULL via
-- O(1) pg_attribute.attnotnull catalog assertion, seals all unsealed versions, and sets sealed_cutover_at.

SET LOCAL lock_timeout = '500ms';
--> statement-breakpoint
SET LOCAL statement_timeout = '1000ms';
--> statement-breakpoint
LOCK TABLE "work_policy" IN EXCLUSIVE MODE;
--> statement-breakpoint
DO $$
DECLARE
	v_missing text;
BEGIN
	SELECT string_agg(t.tbl, ', ' ORDER BY t.tbl)
		INTO v_missing
	FROM unnest(ARRAY[
		'work_policy_schedule',
		'work_policy_schedule_day',
		'work_policy_presence',
		'work_policy_regulation',
		'work_policy_break_rule',
		'work_policy_break_option'
	]) AS t(tbl)
	LEFT JOIN pg_class c
		ON c.relname = t.tbl
		AND c.relnamespace = 'public'::regnamespace
	LEFT JOIN pg_attribute a
		ON a.attrelid = c.oid
		AND a.attname = 'policy_version_id'
		AND NOT a.attisdropped
	WHERE COALESCE(a.attnotnull, false) = false;

	IF v_missing IS NOT NULL THEN
		RAISE EXCEPTION 'Cannot seal work_policy_version v1: policy_version_id is not NOT NULL on: %', v_missing
			USING ERRCODE = '55000';
	END IF;
END $$;
--> statement-breakpoint
UPDATE "work_policy_version"
SET "sealed_at" = now()
WHERE "sealed_at" IS NULL;
--> statement-breakpoint
INSERT INTO "work_policy_versioning_state" ("singleton", "sealed_cutover_at", "updated_at")
VALUES (true, now(), now())
ON CONFLICT ("singleton") DO UPDATE
SET
	"sealed_cutover_at" = COALESCE("work_policy_versioning_state"."sealed_cutover_at", EXCLUDED."sealed_cutover_at"),
	"updated_at" = now();
