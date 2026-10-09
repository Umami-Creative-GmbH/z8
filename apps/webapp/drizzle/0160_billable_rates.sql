-- Billable rates at four rate levels (#898, spec #768).
-- What an organization charges per hour of work, in its billable currency,
-- effective-dated at one of four rate levels: employee on a project, project,
-- customer, employee. Periods are half-open date ranges [effective_from,
-- effective_to); the database refuses overlapping periods of one level and
-- target with one EXCLUDE constraint per level. Targets use organization-scoped
-- foreign keys, so customer gains UNIQUE(id, organization_id).
-- Additive only. Idempotent: the migration runner test replays every migration
-- after 0141.
DO $$ BEGIN
	ALTER TABLE "customer" ADD CONSTRAINT "customer_id_organizationId_idx" UNIQUE("id","organization_id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "btree_gist";--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billable_rate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"level" text NOT NULL,
	"employee_id" uuid,
	"project_id" uuid,
	"customer_id" uuid,
	"hourly_rate" numeric(12, 2) NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "billable_rate_level_check" CHECK ("billable_rate"."level" IN ('employee_project', 'project', 'customer', 'employee')),
	CONSTRAINT "billable_rate_target_check" CHECK (("billable_rate"."level" = 'employee_project' AND "billable_rate"."employee_id" IS NOT NULL AND "billable_rate"."project_id" IS NOT NULL AND "billable_rate"."customer_id" IS NULL)
			OR ("billable_rate"."level" = 'project' AND "billable_rate"."employee_id" IS NULL AND "billable_rate"."project_id" IS NOT NULL AND "billable_rate"."customer_id" IS NULL)
			OR ("billable_rate"."level" = 'customer' AND "billable_rate"."employee_id" IS NULL AND "billable_rate"."project_id" IS NULL AND "billable_rate"."customer_id" IS NOT NULL)
			OR ("billable_rate"."level" = 'employee' AND "billable_rate"."employee_id" IS NOT NULL AND "billable_rate"."project_id" IS NULL AND "billable_rate"."customer_id" IS NULL)),
	CONSTRAINT "billable_rate_positive_check" CHECK ("billable_rate"."hourly_rate" > 0),
	CONSTRAINT "billable_rate_period_check" CHECK ("billable_rate"."effective_to" IS NULL OR "billable_rate"."effective_to" > "billable_rate"."effective_from")
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "billable_rate" ADD CONSTRAINT "billable_rate_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "billable_rate" ADD CONSTRAINT "billable_rate_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "billable_rate" ADD CONSTRAINT "billable_rate_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "billable_rate" ADD CONSTRAINT "billable_rate_employee_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "billable_rate" ADD CONSTRAINT "billable_rate_project_fk" FOREIGN KEY ("project_id","organization_id") REFERENCES "public"."project"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "billable_rate" ADD CONSTRAINT "billable_rate_customer_fk" FOREIGN KEY ("customer_id","organization_id") REFERENCES "public"."customer"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billable_rate_organization_level_idx" ON "billable_rate" USING btree ("organization_id","level");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billable_rate_employee_idx" ON "billable_rate" USING btree ("organization_id","employee_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billable_rate_project_idx" ON "billable_rate" USING btree ("organization_id","project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billable_rate_customer_idx" ON "billable_rate" USING btree ("organization_id","customer_id");--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "billable_rate" ADD CONSTRAINT "billable_rate_employee_project_no_overlap" EXCLUDE USING gist ("organization_id" WITH =, "employee_id" WITH =, "project_id" WITH =, daterange("effective_from", "effective_to", '[)') WITH &&) WHERE ("level" = 'employee_project');
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "billable_rate" ADD CONSTRAINT "billable_rate_project_no_overlap" EXCLUDE USING gist ("organization_id" WITH =, "project_id" WITH =, daterange("effective_from", "effective_to", '[)') WITH &&) WHERE ("level" = 'project');
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "billable_rate" ADD CONSTRAINT "billable_rate_customer_no_overlap" EXCLUDE USING gist ("organization_id" WITH =, "customer_id" WITH =, daterange("effective_from", "effective_to", '[)') WITH &&) WHERE ("level" = 'customer');
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "billable_rate" ADD CONSTRAINT "billable_rate_employee_no_overlap" EXCLUDE USING gist ("organization_id" WITH =, "employee_id" WITH =, daterange("effective_from", "effective_to", '[)') WITH &&) WHERE ("level" = 'employee');
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
