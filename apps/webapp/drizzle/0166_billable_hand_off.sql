-- Billable Time hand-off core, pass B (#903, spec #768): invoice drafts, their
-- frozen lines, invoiced work and the changed-after-invoicing mark.
-- - invoice_draft: one hand-off of one customer's un-invoiced billable work,
--   recorded (status 'pending') BEFORE the accounting tool is called, with its
--   idempotency key (unique per organization). Organization-scoped FKs to the
--   accounting connection and the customer.
-- - invoice_draft_line: the draft's lines with project, rate, hours and amount
--   frozen at hand-off (Billable Time ADR 0001).
-- - invoiced_work: a work period in an unreleased draft. At most one unreleased
--   row per work period (partial unique index), so work is never invoiced twice.
-- - invoiced_work_mark_changed: a row trigger on work_period that marks
--   invoiced work as changed after invoicing whenever any writer changes its
--   times, project or billability or deletes it. It never refuses the write
--   (Billable Time ADR 0002).
-- Additive only. Idempotent: the migration runner test replays every migration
-- after 0141.
CREATE TABLE IF NOT EXISTS "invoice_draft" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"provider_kind" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"idempotency_key" text NOT NULL,
	"contact_id" text NOT NULL,
	"contact_name" text NOT NULL,
	"contact_number" text,
	"currency" text NOT NULL,
	"tax_treatment" text NOT NULL,
	"tax_rate" numeric(5, 2) NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"project_ids" uuid[],
	"title" text NOT NULL,
	"introduction" text,
	"remark" text,
	"include_timesheet" boolean DEFAULT false NOT NULL,
	"net_total" numeric(14, 2) NOT NULL,
	"external_id" text,
	"external_url" text,
	"first_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"outcome_unknown" boolean DEFAULT false NOT NULL,
	"last_failure" text,
	"last_failure_message" text,
	"tool_status" text,
	"tool_status_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"confirmed_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"ended_by" text,
	"release_reason" text,
	CONSTRAINT "invoice_draft_id_organization_idx" UNIQUE("id","organization_id"),
	CONSTRAINT "invoice_draft_status_check" CHECK ("invoice_draft"."status" IN ('pending', 'created', 'failed', 'released')),
	CONSTRAINT "invoice_draft_provider_kind_check" CHECK ("invoice_draft"."provider_kind" IN ('lexware_office', 'sevdesk')),
	CONSTRAINT "invoice_draft_currency_check" CHECK ("invoice_draft"."currency" IN ('EUR', 'CHF', 'USD', 'GBP')),
	CONSTRAINT "invoice_draft_tax_treatment_check" CHECK ("invoice_draft"."tax_treatment" IN ('domestic_standard', 'domestic_reduced', 'eu_reverse_charge', 'third_country_service', 'vat_free')),
	CONSTRAINT "invoice_draft_period_check" CHECK ("invoice_draft"."period_to" >= "invoice_draft"."period_from"),
	CONSTRAINT "invoice_draft_created_check" CHECK ("invoice_draft"."status" <> 'created' OR "invoice_draft"."external_id" IS NOT NULL),
	CONSTRAINT "invoice_draft_ended_check" CHECK (("invoice_draft"."status" IN ('failed', 'released')) = ("invoice_draft"."ended_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoice_draft_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"invoice_draft_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"kind" text NOT NULL,
	"project_id" uuid,
	"project_name" text,
	"text" text NOT NULL,
	"duration_ms" bigint,
	"quantity_hundredths" integer,
	"unit_price" numeric(12, 2),
	"amount" numeric(14, 2),
	CONSTRAINT "invoice_draft_line_kind_check" CHECK (("invoice_draft_line"."kind" = 'work' AND "invoice_draft_line"."project_id" IS NOT NULL AND "invoice_draft_line"."project_name" IS NOT NULL AND "invoice_draft_line"."duration_ms" > 0 AND "invoice_draft_line"."quantity_hundredths" > 0 AND "invoice_draft_line"."unit_price" > 0 AND "invoice_draft_line"."amount" IS NOT NULL)
		OR ("invoice_draft_line"."kind" = 'text' AND "invoice_draft_line"."project_id" IS NULL AND "invoice_draft_line"."duration_ms" IS NULL AND "invoice_draft_line"."quantity_hundredths" IS NULL AND "invoice_draft_line"."unit_price" IS NULL AND "invoice_draft_line"."amount" IS NULL))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoiced_work" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"invoice_draft_id" uuid NOT NULL,
	"work_period_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"start_offset_minutes" integer NOT NULL,
	"duration_minutes" integer NOT NULL,
	"shares" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"carried_from_work_period_id" uuid,
	"released_at" timestamp with time zone,
	"changed_after_invoicing_at" timestamp with time zone,
	"changed_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"mark_cleared_at" timestamp with time zone,
	"mark_cleared_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "invoice_draft" ADD CONSTRAINT "invoice_draft_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "invoice_draft" ADD CONSTRAINT "invoice_draft_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "invoice_draft" ADD CONSTRAINT "invoice_draft_ended_by_user_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "invoice_draft" ADD CONSTRAINT "invoice_draft_connection_fk" FOREIGN KEY ("connection_id","organization_id") REFERENCES "public"."accounting_connection"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "invoice_draft" ADD CONSTRAINT "invoice_draft_customer_fk" FOREIGN KEY ("customer_id","organization_id") REFERENCES "public"."customer"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "invoice_draft_line" ADD CONSTRAINT "invoice_draft_line_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "invoice_draft_line" ADD CONSTRAINT "invoice_draft_line_draft_fk" FOREIGN KEY ("invoice_draft_id","organization_id") REFERENCES "public"."invoice_draft"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "invoiced_work" ADD CONSTRAINT "invoiced_work_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "invoiced_work" ADD CONSTRAINT "invoiced_work_draft_fk" FOREIGN KEY ("invoice_draft_id","organization_id") REFERENCES "public"."invoice_draft"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "invoiced_work" ADD CONSTRAINT "invoiced_work_work_period_id_work_period_id_fk" FOREIGN KEY ("work_period_id") REFERENCES "public"."work_period"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "invoiced_work" ADD CONSTRAINT "invoiced_work_employee_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "invoiced_work" ADD CONSTRAINT "invoiced_work_mark_cleared_by_user_id_fk" FOREIGN KEY ("mark_cleared_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invoice_draft_idempotency_key_idx" ON "invoice_draft" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_draft_organization_created_idx" ON "invoice_draft" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_draft_customer_idx" ON "invoice_draft" USING btree ("organization_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invoice_draft_line_position_idx" ON "invoice_draft_line" USING btree ("invoice_draft_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invoiced_work_active_period_idx" ON "invoiced_work" USING btree ("organization_id","work_period_id") WHERE "invoiced_work"."released_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoiced_work_draft_idx" ON "invoiced_work" USING btree ("organization_id","invoice_draft_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoiced_work_changed_idx" ON "invoiced_work" USING btree ("organization_id") WHERE "invoiced_work"."changed_after_invoicing_at" IS NOT NULL AND "invoiced_work"."released_at" IS NULL;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "invoiced_work_mark_changed"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	changed text[] := ARRAY[]::text[];
BEGIN
	IF NEW.start_time IS DISTINCT FROM OLD.start_time
		OR NEW.end_time IS DISTINCT FROM OLD.end_time
		OR NEW.duration_minutes IS DISTINCT FROM OLD.duration_minutes THEN
		changed := changed || 'times'::text;
	END IF;
	IF NEW.project_id IS DISTINCT FROM OLD.project_id THEN
		changed := changed || 'project'::text;
	END IF;
	IF NEW.is_billable IS DISTINCT FROM OLD.is_billable THEN
		changed := changed || 'billability'::text;
	END IF;
	IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
		changed := changed || 'removed'::text;
	END IF;
	IF cardinality(changed) = 0 THEN
		RETURN NULL;
	END IF;
	UPDATE "invoiced_work"
	SET "changed_after_invoicing_at" = now(),
		"changed_fields" = ARRAY(
			SELECT DISTINCT field FROM unnest("invoiced_work"."changed_fields" || changed) AS field ORDER BY field
		)
	WHERE "organization_id" = NEW.organization_id
		AND "work_period_id" = NEW.id
		AND "released_at" IS NULL;
	RETURN NULL;
END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "invoiced_work_mark_changed" ON "work_period";--> statement-breakpoint
CREATE TRIGGER "invoiced_work_mark_changed" AFTER UPDATE OF "start_time", "end_time", "duration_minutes", "project_id", "is_billable", "deleted_at" ON "work_period" FOR EACH ROW EXECUTE FUNCTION "invoiced_work_mark_changed"();
