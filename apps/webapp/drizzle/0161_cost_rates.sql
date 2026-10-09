-- Cost rates per employee (#899, spec #768).
-- An employee's fully loaded internal cost per hour, in the organization's
-- billable currency, for margin. Any contract type may have one; it is separate
-- from the wage (employee_rate_history, employment terms) and never changes it.
-- Periods are half-open date ranges [effective_from, effective_to); the database
-- refuses overlapping periods of one employee with an EXCLUDE constraint. The
-- employee foreign key is organization-scoped.
-- Additive only. Idempotent: the migration runner test replays every migration
-- after 0141.
CREATE EXTENSION IF NOT EXISTS "btree_gist";--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cost_rate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"hourly_rate" numeric(12, 2) NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "cost_rate_positive_check" CHECK ("cost_rate"."hourly_rate" > 0),
	CONSTRAINT "cost_rate_period_check" CHECK ("cost_rate"."effective_to" IS NULL OR "cost_rate"."effective_to" > "cost_rate"."effective_from")
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "cost_rate" ADD CONSTRAINT "cost_rate_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "cost_rate" ADD CONSTRAINT "cost_rate_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "cost_rate" ADD CONSTRAINT "cost_rate_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "cost_rate" ADD CONSTRAINT "cost_rate_employee_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cost_rate_employee_idx" ON "cost_rate" USING btree ("organization_id","employee_id");--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "cost_rate" ADD CONSTRAINT "cost_rate_employee_no_overlap" EXCLUDE USING gist ("organization_id" WITH =, "employee_id" WITH =, daterange("effective_from", "effective_to", '[)') WITH &&);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
