-- Custom field values on employees, projects and customers (#818, spec #769, ADR 0001).
-- Typed rows: one nullable foreign key per record kind (exactly one set) and one
-- column per value type (exactly one set). Every foreign key is composite with
-- organization_id, so the record, the field and the organization always match,
-- and a select option must belong to the value's field. Values are deleted with
-- their record or field. valid_from stays empty until tracked fields (#819); a
-- record holds at most one undated value per field.
-- Additive only. Idempotent: the migration runner test replays every migration
-- after 0141.
CREATE TABLE IF NOT EXISTS "custom_field_value" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"definition_id" uuid NOT NULL,
	"employee_id" uuid,
	"project_id" uuid,
	"customer_id" uuid,
	"text_value" text,
	"number_value" numeric,
	"date_value" date,
	"boolean_value" boolean,
	"select_option_id" uuid,
	"valid_from" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "custom_field_value_one_record_check" CHECK (num_nonnulls("custom_field_value"."employee_id", "custom_field_value"."project_id", "custom_field_value"."customer_id") = 1),
	CONSTRAINT "custom_field_value_one_value_check" CHECK (num_nonnulls("custom_field_value"."text_value", "custom_field_value"."number_value", "custom_field_value"."date_value", "custom_field_value"."boolean_value", "custom_field_value"."select_option_id") = 1),
	CONSTRAINT "custom_field_value_text_length_check" CHECK ("custom_field_value"."text_value" IS NULL OR length("custom_field_value"."text_value") <= 255)
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "custom_field_value" ADD CONSTRAINT "custom_field_value_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "custom_field_value" ADD CONSTRAINT "custom_field_value_definition_fk" FOREIGN KEY ("definition_id","organization_id") REFERENCES "public"."custom_field_definition"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "custom_field_value" ADD CONSTRAINT "custom_field_value_employee_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "custom_field_value" ADD CONSTRAINT "custom_field_value_project_fk" FOREIGN KEY ("project_id","organization_id") REFERENCES "public"."project"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "custom_field_value" ADD CONSTRAINT "custom_field_value_customer_fk" FOREIGN KEY ("customer_id","organization_id") REFERENCES "public"."customer"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "custom_field_value" ADD CONSTRAINT "custom_field_value_select_option_fk" FOREIGN KEY ("select_option_id","definition_id") REFERENCES "public"."custom_field_option"("id","definition_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "custom_field_value" ADD CONSTRAINT "custom_field_value_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "custom_field_value" ADD CONSTRAINT "custom_field_value_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "custom_field_value_employee_undated_unique" ON "custom_field_value" USING btree ("definition_id","employee_id") WHERE "custom_field_value"."employee_id" IS NOT NULL AND "custom_field_value"."valid_from" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "custom_field_value_project_undated_unique" ON "custom_field_value" USING btree ("definition_id","project_id") WHERE "custom_field_value"."project_id" IS NOT NULL AND "custom_field_value"."valid_from" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "custom_field_value_customer_undated_unique" ON "custom_field_value" USING btree ("definition_id","customer_id") WHERE "custom_field_value"."customer_id" IS NOT NULL AND "custom_field_value"."valid_from" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "custom_field_value_employee_idx" ON "custom_field_value" USING btree ("organization_id","employee_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "custom_field_value_project_idx" ON "custom_field_value" USING btree ("organization_id","project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "custom_field_value_customer_idx" ON "custom_field_value" USING btree ("organization_id","customer_id");
