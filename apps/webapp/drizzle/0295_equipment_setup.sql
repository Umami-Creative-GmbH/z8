CREATE TABLE "equipment_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"type_id" uuid NOT NULL,
	"identifier" text NOT NULL,
	"identifier_key" text GENERATED ALWAYS AS (lower(regexp_replace("equipment_item"."identifier", '^[[:space:]]+|[[:space:]]+$', '', 'g'))) STORED NOT NULL,
	"serial_number" text,
	"status" text DEFAULT 'available' NOT NULL,
	"archived_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "equipment_item_id_org_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "equipment_item_identifier_check" CHECK (length("equipment_item"."identifier_key") between 1 and 100),
	CONSTRAINT "equipment_item_serial_check" CHECK ("equipment_item"."serial_number" is null or length("equipment_item"."serial_number") between 1 and 200),
	CONSTRAINT "equipment_item_status_check" CHECK ("equipment_item"."status" in ('available', 'unavailable', 'retired')),
	CONSTRAINT "equipment_item_revision_positive" CHECK ("equipment_item"."revision" > 0)
);

--> statement-breakpoint
CREATE TABLE "equipment_policy" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"retention_months" integer NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "equipment_policy_retention_positive" CHECK ("equipment_policy"."retention_months" > 0),
	CONSTRAINT "equipment_policy_revision_positive" CHECK ("equipment_policy"."revision" > 0)
);

--> statement-breakpoint
CREATE TABLE "equipment_setup_command" (
	"organization_id" text NOT NULL,
	"request_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "equipment_setup_command_organization_id_request_id_pk" PRIMARY KEY("organization_id","request_id")
);

--> statement-breakpoint
CREATE TABLE "equipment_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"tracking_mode" text NOT NULL,
	"default_return_required" boolean NOT NULL,
	"used_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "equipment_type_id_org_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "equipment_type_name_check" CHECK (length(btrim("equipment_type"."name")) between 1 and 100),
	CONSTRAINT "equipment_type_tracking_check" CHECK ("equipment_type"."tracking_mode" in ('individual', 'quantity')),
	CONSTRAINT "equipment_type_revision_positive" CHECK ("equipment_type"."revision" > 0)
);

--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_item_identifier_org_unique" ON "equipment_item" USING btree ("organization_id","identifier_key");
--> statement-breakpoint
ALTER TABLE "equipment_item" ADD CONSTRAINT "equipment_item_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "equipment_item" ADD CONSTRAINT "equipment_item_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "equipment_item" ADD CONSTRAINT "equipment_item_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "equipment_item" ADD CONSTRAINT "equipment_item_type_org_fk" FOREIGN KEY ("type_id","organization_id") REFERENCES "public"."equipment_type"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "equipment_policy" ADD CONSTRAINT "equipment_policy_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "equipment_policy" ADD CONSTRAINT "equipment_policy_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "equipment_setup_command" ADD CONSTRAINT "equipment_setup_command_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "equipment_type" ADD CONSTRAINT "equipment_type_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "equipment_type" ADD CONSTRAINT "equipment_type_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "equipment_type" ADD CONSTRAINT "equipment_type_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;