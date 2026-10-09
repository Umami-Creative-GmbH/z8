-- Billable Time hand-off core, pass A (#903, spec #768): the accounting
-- connection, contact links and customer tax treatment overrides.
-- - accounting_connection: at most one active per organization (partial unique
--   index); replaced/removed connections are kept for the drafts created
--   through them. The API key is NOT stored in any table: it lives in the
--   organization secret store (accounting/<connection id>/api_key).
-- - accounting_contact_link: a customer linked to an existing contact of one
--   tool account; organization-scoped FK to customer.
-- - customer_tax_treatment: a customer's override of the connection's default
--   tax treatment; organization-scoped FK to customer.
-- Additive only. Idempotent: the migration runner test replays every migration
-- after 0141.
CREATE TABLE IF NOT EXISTS "accounting_connection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"provider_kind" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"account_ref" text NOT NULL,
	"account_label" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"default_tax_treatment" text NOT NULL,
	"default_tax_rate" numeric(5, 2) NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"connected_by" text,
	"ended_at" timestamp with time zone,
	"ended_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "accounting_connection_id_organization_idx" UNIQUE("id","organization_id"),
	CONSTRAINT "accounting_connection_provider_kind_check" CHECK ("accounting_connection"."provider_kind" IN ('lexware_office', 'sevdesk')),
	CONSTRAINT "accounting_connection_status_check" CHECK ("accounting_connection"."status" IN ('active', 'replaced', 'removed')),
	CONSTRAINT "accounting_connection_ended_check" CHECK (("accounting_connection"."status" = 'active') = ("accounting_connection"."ended_at" IS NULL)),
	CONSTRAINT "accounting_connection_tax_treatment_check" CHECK ("accounting_connection"."default_tax_treatment" IN ('domestic_standard', 'domestic_reduced', 'eu_reverse_charge', 'third_country_service', 'vat_free')),
	CONSTRAINT "accounting_connection_tax_rate_check" CHECK (("accounting_connection"."default_tax_treatment" IN ('domestic_standard', 'domestic_reduced') AND "accounting_connection"."default_tax_rate" > 0 AND "accounting_connection"."default_tax_rate" <= 100)
		OR ("accounting_connection"."default_tax_treatment" NOT IN ('domestic_standard', 'domestic_reduced') AND "accounting_connection"."default_tax_rate" = 0))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "accounting_contact_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"provider_kind" text NOT NULL,
	"account_ref" text NOT NULL,
	"contact_id" text NOT NULL,
	"contact_name" text NOT NULL,
	"contact_number" text,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"linked_by" text,
	CONSTRAINT "accounting_contact_link_provider_kind_check" CHECK ("accounting_contact_link"."provider_kind" IN ('lexware_office', 'sevdesk'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customer_tax_treatment" (
	"customer_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"tax_treatment" text NOT NULL,
	"tax_rate" numeric(5, 2) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "customer_tax_treatment_kind_check" CHECK ("customer_tax_treatment"."tax_treatment" IN ('domestic_standard', 'domestic_reduced', 'eu_reverse_charge', 'third_country_service', 'vat_free')),
	CONSTRAINT "customer_tax_treatment_rate_check" CHECK (("customer_tax_treatment"."tax_treatment" IN ('domestic_standard', 'domestic_reduced') AND "customer_tax_treatment"."tax_rate" > 0 AND "customer_tax_treatment"."tax_rate" <= 100)
		OR ("customer_tax_treatment"."tax_treatment" NOT IN ('domestic_standard', 'domestic_reduced') AND "customer_tax_treatment"."tax_rate" = 0))
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "accounting_connection" ADD CONSTRAINT "accounting_connection_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "accounting_connection" ADD CONSTRAINT "accounting_connection_connected_by_user_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "accounting_connection" ADD CONSTRAINT "accounting_connection_ended_by_user_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "accounting_connection" ADD CONSTRAINT "accounting_connection_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "accounting_contact_link" ADD CONSTRAINT "accounting_contact_link_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "accounting_contact_link" ADD CONSTRAINT "accounting_contact_link_linked_by_user_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "accounting_contact_link" ADD CONSTRAINT "accounting_contact_link_customer_fk" FOREIGN KEY ("customer_id","organization_id") REFERENCES "public"."customer"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "customer_tax_treatment" ADD CONSTRAINT "customer_tax_treatment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "customer_tax_treatment" ADD CONSTRAINT "customer_tax_treatment_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "customer_tax_treatment" ADD CONSTRAINT "customer_tax_treatment_customer_fk" FOREIGN KEY ("customer_id","organization_id") REFERENCES "public"."customer"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "accounting_connection_one_active_idx" ON "accounting_connection" USING btree ("organization_id") WHERE "accounting_connection"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "accounting_contact_link_customer_account_idx" ON "accounting_contact_link" USING btree ("organization_id","customer_id","provider_kind","account_ref");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accounting_contact_link_contact_idx" ON "accounting_contact_link" USING btree ("organization_id","provider_kind","account_ref","contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_tax_treatment_organization_idx" ON "customer_tax_treatment" USING btree ("organization_id");
