-- #859: kiosks, shared devices enrolled to one location of an organization.
-- Device tokens and pairing codes are stored only as SHA-256 hashes. The
-- composite foreign key keeps a kiosk on a location of its own organization.
CREATE TABLE IF NOT EXISTS "kiosk" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" uuid NOT NULL,
	"name" text NOT NULL,
	"timezone" text NOT NULL,
	"board_enabled" boolean DEFAULT false NOT NULL,
	"token_hash" text,
	"paired_at" timestamp with time zone,
	"pairing_code_hash" text,
	"pairing_code_expires_at" timestamp with time zone,
	"pairing_code_issued_by" text,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "kiosk_id_organizationId_idx" UNIQUE("id","organization_id"),
	CONSTRAINT "kiosk_pairing_code_check" CHECK (("kiosk"."pairing_code_hash" IS NULL) = ("kiosk"."pairing_code_expires_at" IS NULL)),
	CONSTRAINT "kiosk_name_check" CHECK (char_length(btrim("kiosk"."name")) BETWEEN 1 AND 100)
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "kiosk" ADD CONSTRAINT "kiosk_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "kiosk" ADD CONSTRAINT "kiosk_location_fk" FOREIGN KEY ("location_id","organization_id") REFERENCES "public"."location"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "kiosk" ADD CONSTRAINT "kiosk_pairing_code_issued_by_user_id_fk" FOREIGN KEY ("pairing_code_issued_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "kiosk" ADD CONSTRAINT "kiosk_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "kiosk" ADD CONSTRAINT "kiosk_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "kiosk" ADD CONSTRAINT "kiosk_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "kiosk_tokenHash_idx" ON "kiosk" USING btree ("token_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "kiosk_pairingCodeHash_idx" ON "kiosk" USING btree ("pairing_code_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kiosk_organizationId_idx" ON "kiosk" USING btree ("organization_id");
