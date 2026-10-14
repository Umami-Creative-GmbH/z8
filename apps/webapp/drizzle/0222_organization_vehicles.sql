-- Organization vehicles and their assigned drivers (#1118, spec #807).
-- Plates are unique per organization by licence_plate_key (no spaces, hyphens or
-- dots), archived vehicles included. organization_vehicle exposes
-- UNIQUE(id, organization_id) as the target of same-organization foreign keys:
-- assigned drivers cascade, while a table recording vehicle use must reference it
-- without a cascade, so a vehicle recorded on work cannot be deleted.
-- Additive only. Idempotent.
CREATE TABLE IF NOT EXISTS "organization_vehicle" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"licence_plate" text NOT NULL,
	"licence_plate_key" text GENERATED ALWAYS AS (regexp_replace(upper("licence_plate"), '[[:space:].-]', '', 'g')) STORED NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "organization_vehicle_id_organization_id_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "organization_vehicle_name_check" CHECK (length(btrim("organization_vehicle"."name")) BETWEEN 1 AND 100),
	CONSTRAINT "organization_vehicle_licence_plate_check" CHECK (length("organization_vehicle"."licence_plate") BETWEEN 1 AND 20 AND length("organization_vehicle"."licence_plate_key") >= 1)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_vehicle_driver" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"employee_id" uuid,
	"team_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "organization_vehicle_driver_target_check" CHECK (("organization_vehicle_driver"."employee_id" IS NULL) <> ("organization_vehicle_driver"."team_id" IS NULL))
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "organization_vehicle" ADD CONSTRAINT "organization_vehicle_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "organization_vehicle" ADD CONSTRAINT "organization_vehicle_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "organization_vehicle" ADD CONSTRAINT "organization_vehicle_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "organization_vehicle_driver" ADD CONSTRAINT "organization_vehicle_driver_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "organization_vehicle_driver" ADD CONSTRAINT "organization_vehicle_driver_vehicle_fk" FOREIGN KEY ("vehicle_id","organization_id") REFERENCES "public"."organization_vehicle"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "organization_vehicle_driver" ADD CONSTRAINT "organization_vehicle_driver_employee_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "organization_vehicle_driver" ADD CONSTRAINT "organization_vehicle_driver_team_fk" FOREIGN KEY ("team_id","organization_id") REFERENCES "public"."team"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "organization_vehicle_driver" ADD CONSTRAINT "organization_vehicle_driver_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organization_vehicle_licence_plate_key_idx" ON "organization_vehicle" USING btree ("organization_id","licence_plate_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organization_vehicle_driver_employee_idx" ON "organization_vehicle_driver" USING btree ("vehicle_id","employee_id") WHERE employee_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organization_vehicle_driver_team_idx" ON "organization_vehicle_driver" USING btree ("vehicle_id","team_id") WHERE team_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_vehicle_driver_organization_employee_idx" ON "organization_vehicle_driver" USING btree ("organization_id","employee_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_vehicle_driver_organization_team_idx" ON "organization_vehicle_driver" USING btree ("organization_id","team_id");
