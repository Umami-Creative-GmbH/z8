-- #1499 (spec #1308): resolutions replace clearing changed-after-invoicing marks.
--
-- mark_version: bumped by a BEFORE UPDATE trigger whenever any writer sets
-- changed_after_invoicing_at or changed_fields (the work_period trigger from
-- 0166, the project customer marking, resolving), even to the same values. A
-- resolution compares the versions the admin loaded with the locked rows and
-- refuses the batch when one moved, so no correction is resolved unseen.
ALTER TABLE "invoiced_work" ADD COLUMN IF NOT EXISTS "mark_version" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "invoiced_work" ADD CONSTRAINT "invoiced_work_id_organization_idx" UNIQUE("id","organization_id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "invoiced_work_bump_mark_version"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	NEW.mark_version := OLD.mark_version + 1;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "invoiced_work_bump_mark_version" ON "invoiced_work";
--> statement-breakpoint
CREATE TRIGGER "invoiced_work_bump_mark_version" BEFORE UPDATE OF "changed_after_invoicing_at", "changed_fields" ON "invoiced_work"
	FOR EACH ROW EXECUTE FUNCTION "invoiced_work_bump_mark_version"();
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoiced_work_resolution" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"invoice_draft_id" uuid NOT NULL,
	"invoiced_work_id" uuid NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"explanation" text NOT NULL,
	"accounting_reference" text,
	"resolved_fields" text[] NOT NULL,
	"snapshot" jsonb NOT NULL,
	CONSTRAINT "invoiced_work_resolution_explanation_check" CHECK (char_length(btrim("invoiced_work_resolution"."explanation")) BETWEEN 1 AND 2000),
	CONSTRAINT "invoiced_work_resolution_reference_check" CHECK ("invoiced_work_resolution"."accounting_reference" IS NULL OR char_length("invoiced_work_resolution"."accounting_reference") <= 200)
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "invoiced_work_resolution" ADD CONSTRAINT "invoiced_work_resolution_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "invoiced_work_resolution" ADD CONSTRAINT "invoiced_work_resolution_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "invoiced_work_resolution" ADD CONSTRAINT "invoiced_work_resolution_work_fk" FOREIGN KEY ("invoiced_work_id","organization_id") REFERENCES "public"."invoiced_work"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "invoiced_work_resolution" ADD CONSTRAINT "invoiced_work_resolution_draft_fk" FOREIGN KEY ("invoice_draft_id","organization_id") REFERENCES "public"."invoice_draft"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoiced_work_resolution_work_idx" ON "invoiced_work_resolution" USING btree ("organization_id","invoiced_work_id","resolved_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoiced_work_resolution_draft_idx" ON "invoiced_work_resolution" USING btree ("organization_id","invoice_draft_id");
--> statement-breakpoint
-- Resolutions are append-only (spec Q15). Two writes come from foreign keys and
-- stay possible: the actor going null once the user is deleted, and deletes
-- cascading from an already-deleted organization, draft or invoiced work.
CREATE OR REPLACE FUNCTION "invoiced_work_resolution_guard_append_only"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'UPDATE'
		AND OLD.resolved_by IS NOT NULL
		AND NEW.resolved_by IS NULL
		AND NOT EXISTS (SELECT 1 FROM public."user" WHERE "id" = OLD.resolved_by)
		AND (NEW.id, NEW.organization_id, NEW.invoice_draft_id, NEW.invoiced_work_id, NEW.resolved_at,
			NEW.explanation, NEW.accounting_reference, NEW.resolved_fields, NEW.snapshot)
			IS NOT DISTINCT FROM
			(OLD.id, OLD.organization_id, OLD.invoice_draft_id, OLD.invoiced_work_id, OLD.resolved_at,
			OLD.explanation, OLD.accounting_reference, OLD.resolved_fields, OLD.snapshot)
	THEN
		RETURN NEW;
	END IF;

	IF TG_OP = 'DELETE' AND (
		NOT EXISTS (SELECT 1 FROM public."organization" WHERE "id" = OLD.organization_id)
		OR NOT EXISTS (
			SELECT 1 FROM public."invoice_draft"
			WHERE "id" = OLD.invoice_draft_id AND "organization_id" = OLD.organization_id
		)
		OR NOT EXISTS (
			SELECT 1 FROM public."invoiced_work"
			WHERE "id" = OLD.invoiced_work_id AND "organization_id" = OLD.organization_id
		)
	) THEN
		RETURN OLD;
	END IF;

	RAISE EXCEPTION USING
		ERRCODE = '55000',
		MESSAGE = 'Invoiced work resolutions are append-only';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "invoiced_work_resolution_append_only" ON "invoiced_work_resolution";
--> statement-breakpoint
CREATE TRIGGER "invoiced_work_resolution_append_only" BEFORE UPDATE OR DELETE ON "invoiced_work_resolution"
	FOR EACH ROW EXECUTE FUNCTION "invoiced_work_resolution_guard_append_only"();
