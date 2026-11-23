-- #2003: an intended driver's own statement of their licence classes ("declared classes").
-- Grants no authorization; a verifier's check replaces the classes it inspects.
CREATE TABLE IF NOT EXISTS "driving_licence_declared_classes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"classes" jsonb NOT NULL,
	"document_expires_on" date,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by" text,
	CONSTRAINT "driving_declared_classes_employee" UNIQUE("organization_id","employee_id"),
	CONSTRAINT "driving_declared_classes_list" CHECK (jsonb_typeof("driving_licence_declared_classes"."classes")='array' AND jsonb_array_length("driving_licence_declared_classes"."classes") > 0)
);--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "driving_licence_declared_classes" ADD CONSTRAINT "driving_licence_declared_classes_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "driving_licence_declared_classes" ADD CONSTRAINT "driving_licence_declared_classes_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "driving_licence_declared_classes" ADD CONSTRAINT "driving_declared_classes_employee_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
