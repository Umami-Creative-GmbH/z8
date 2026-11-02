-- #1500 (spec #1308): invoiced work is changed after invoicing when its project
-- moves to another customer, or to none. Every writer of project.customer_id
-- goes through the trigger (the project settings edit, a customer created for a
-- project, the customer FK's ON DELETE SET NULL), so none has to remember it.
-- - It marks the unreleased invoiced work whose work period is on the project
--   now, in the project's organization, and adds 'customer' to its changed
--   fields the way invoiced_work_mark_changed (0166) adds its fields. Released
--   drafts and un-invoiced work are untouched; a customer set back to the
--   draft's keeps the mark (fields are only ever added).
-- - Deactivating a customer changes no project's customer_id: nothing is marked.
-- - It never refuses the write (Billable Time ADR 0002).
-- - It locks the rows in id order before updating them, so it can't deadlock
--   with another writer marking or resolving several of them.
-- The backfill marks existing invoiced work in unreleased drafts whose work's
-- project has a customer other than the draft's, or none, once: rows already
-- carrying 'customer' are skipped, so a replay changes nothing.
-- Idempotent: the migration runner test replays every migration after 0141.
CREATE OR REPLACE FUNCTION "invoiced_work_mark_customer_changed"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	PERFORM 1
	FROM "invoiced_work" AS iw
	JOIN "work_period" AS wp
		ON wp."id" = iw."work_period_id" AND wp."organization_id" = iw."organization_id"
	WHERE iw."organization_id" = NEW.organization_id
		AND iw."released_at" IS NULL
		AND wp."project_id" = NEW.id
	ORDER BY iw."id"
	FOR UPDATE OF iw;

	UPDATE "invoiced_work" AS iw
	SET "changed_after_invoicing_at" = now(),
		"changed_fields" = ARRAY(
			SELECT DISTINCT field FROM unnest(iw."changed_fields" || 'customer'::text) AS field ORDER BY field
		)
	FROM "work_period" AS wp
	WHERE wp."id" = iw."work_period_id"
		AND wp."organization_id" = iw."organization_id"
		AND iw."organization_id" = NEW.organization_id
		AND iw."released_at" IS NULL
		AND wp."project_id" = NEW.id;
	RETURN NULL;
END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "invoiced_work_mark_customer_changed" ON "project";--> statement-breakpoint
CREATE TRIGGER "invoiced_work_mark_customer_changed" AFTER UPDATE OF "customer_id" ON "project" FOR EACH ROW WHEN (OLD."customer_id" IS DISTINCT FROM NEW."customer_id") EXECUTE FUNCTION "invoiced_work_mark_customer_changed"();--> statement-breakpoint
UPDATE "invoiced_work" AS iw
SET "changed_after_invoicing_at" = now(),
	"changed_fields" = ARRAY(
		SELECT DISTINCT field FROM unnest(iw."changed_fields" || 'customer'::text) AS field ORDER BY field
	)
FROM "invoice_draft" AS d, "work_period" AS wp, "project" AS p
WHERE d."id" = iw."invoice_draft_id"
	AND d."organization_id" = iw."organization_id"
	AND wp."id" = iw."work_period_id"
	AND wp."organization_id" = iw."organization_id"
	AND p."id" = wp."project_id"
	AND p."organization_id" = iw."organization_id"
	AND iw."released_at" IS NULL
	AND p."customer_id" IS DISTINCT FROM d."customer_id"
	AND NOT ('customer' = ANY(iw."changed_fields"));
