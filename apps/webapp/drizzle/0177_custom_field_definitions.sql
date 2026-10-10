-- Custom field definitions and select options (#817, spec #769).
-- An organization defines its own fields on employees, projects and customers.
-- Fields and options are archived, never deleted. Both tables are organization
-- scoped; definitions expose UNIQUE(id, organization_id) and options
-- UNIQUE(id, definition_id) as targets for the value table's composite
-- same-organization foreign keys (ADR 0001, #818).
-- Additive only. Idempotent: the migration runner test replays every migration
-- after 0141.
CREATE TABLE IF NOT EXISTS "custom_field_definition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"entity" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"tracked" boolean DEFAULT false NOT NULL,
	"visibility" text NOT NULL,
	"edit_level" text NOT NULL,
	"number_integer_only" boolean DEFAULT false NOT NULL,
	"number_min" numeric,
	"number_max" numeric,
	"position" integer NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "custom_field_definition_id_organization_id_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "custom_field_definition_entity_check" CHECK ("custom_field_definition"."entity" IN ('employee', 'project', 'customer')),
	CONSTRAINT "custom_field_definition_type_check" CHECK ("custom_field_definition"."type" IN ('text', 'number', 'date', 'select', 'boolean')),
	CONSTRAINT "custom_field_definition_visibility_check" CHECK ("custom_field_definition"."visibility" IN ('admin', 'manager', 'employee')),
	CONSTRAINT "custom_field_definition_edit_level_check" CHECK ("custom_field_definition"."edit_level" IN ('admin', 'manager') AND NOT ("custom_field_definition"."visibility" = 'admin' AND "custom_field_definition"."edit_level" = 'manager')),
	CONSTRAINT "custom_field_definition_boolean_not_required_check" CHECK (NOT ("custom_field_definition"."type" = 'boolean' AND "custom_field_definition"."required")),
	CONSTRAINT "custom_field_definition_number_settings_check" CHECK ("custom_field_definition"."type" = 'number' OR ("custom_field_definition"."number_integer_only" = false AND "custom_field_definition"."number_min" IS NULL AND "custom_field_definition"."number_max" IS NULL)),
	CONSTRAINT "custom_field_definition_number_bounds_check" CHECK ("custom_field_definition"."number_min" IS NULL OR "custom_field_definition"."number_max" IS NULL OR "custom_field_definition"."number_min" <= "custom_field_definition"."number_max"),
	CONSTRAINT "custom_field_definition_name_check" CHECK (length(btrim("custom_field_definition"."name")) BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "custom_field_option" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"definition_id" uuid NOT NULL,
	"label" text NOT NULL,
	"position" integer NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "custom_field_option_id_definition_id_unique" UNIQUE("id","definition_id"),
	CONSTRAINT "custom_field_option_label_check" CHECK (length(btrim("custom_field_option"."label")) BETWEEN 1 AND 100)
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "custom_field_definition" ADD CONSTRAINT "custom_field_definition_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "custom_field_definition" ADD CONSTRAINT "custom_field_definition_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "custom_field_definition" ADD CONSTRAINT "custom_field_definition_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "custom_field_option" ADD CONSTRAINT "custom_field_option_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "custom_field_option" ADD CONSTRAINT "custom_field_option_definition_fk" FOREIGN KEY ("definition_id","organization_id") REFERENCES "public"."custom_field_definition"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "custom_field_option" ADD CONSTRAINT "custom_field_option_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "custom_field_option" ADD CONSTRAINT "custom_field_option_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "custom_field_definition_organization_entity_idx" ON "custom_field_definition" USING btree ("organization_id","entity","position");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "custom_field_option_definition_idx" ON "custom_field_option" USING btree ("organization_id","definition_id","position");
