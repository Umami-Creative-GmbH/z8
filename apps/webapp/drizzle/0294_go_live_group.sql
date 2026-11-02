-- #1513 (spec #1309, Organization ADR 0007): the go-live group's chosen teams and
-- go-live exclusions. An exclusion ends by itself when its employee becomes a
-- former employee: every writer that switches an employee off (Deactivate, a
-- departure taking effect, member removal, SCIM) goes through the trigger below.
-- Switching them on again revives nothing, so a rehired employee needs a new one.
CREATE TABLE IF NOT EXISTS "go_live_group_team" (
	"organization_id" text NOT NULL,
	"team_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	CONSTRAINT "go_live_group_team_pk" PRIMARY KEY("organization_id","team_id")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "go_live_exclusion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"lifted_at" timestamp with time zone,
	"lifted_by" text,
	"ended_at" timestamp with time zone,
	CONSTRAINT "go_live_exclusion_reason_check" CHECK (length(btrim("go_live_exclusion"."reason")) > 0),
	CONSTRAINT "go_live_exclusion_lifted_check" CHECK (("go_live_exclusion"."lifted_at" is null) = ("go_live_exclusion"."lifted_by" is null)),
	CONSTRAINT "go_live_exclusion_closed_once_check" CHECK ("go_live_exclusion"."lifted_at" is null or "go_live_exclusion"."ended_at" is null)
);--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "go_live_group_team" ADD CONSTRAINT "go_live_group_team_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "go_live_group_team" ADD CONSTRAINT "go_live_group_team_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "go_live_group_team" ADD CONSTRAINT "go_live_group_team_team_fk" FOREIGN KEY ("team_id","organization_id") REFERENCES "public"."team"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "go_live_exclusion" ADD CONSTRAINT "go_live_exclusion_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "go_live_exclusion" ADD CONSTRAINT "go_live_exclusion_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "go_live_exclusion" ADD CONSTRAINT "go_live_exclusion_lifted_by_user_id_fk" FOREIGN KEY ("lifted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "go_live_exclusion" ADD CONSTRAINT "go_live_exclusion_employee_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "go_live_exclusion_open_idx" ON "go_live_exclusion" USING btree ("organization_id","employee_id") WHERE lifted_at IS NULL AND ended_at IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "go_live_exclusion_employee_idx" ON "go_live_exclusion" USING btree ("employee_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION "go_live_exclusion_end_on_departure"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	UPDATE "go_live_exclusion"
	SET "ended_at" = now()
	WHERE "organization_id" = NEW."organization_id"
		AND "employee_id" = NEW."id"
		AND "lifted_at" IS NULL
		AND "ended_at" IS NULL;

	RETURN NULL;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "go_live_exclusion_end_on_departure_trigger" ON "employee";
--> statement-breakpoint
CREATE TRIGGER "go_live_exclusion_end_on_departure_trigger"
	AFTER UPDATE OF "is_active" ON "employee"
	FOR EACH ROW
	WHEN (OLD.is_active AND NOT NEW.is_active)
	EXECUTE FUNCTION "go_live_exclusion_end_on_departure"();
