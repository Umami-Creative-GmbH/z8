-- #1289: a rotated kiosk device token is kept by its SHA-256, so the commands an offline kiosk
-- queued before the rotation can be attributed to the kiosk and refused (spec #885).
CREATE TABLE IF NOT EXISTS "kiosk_retired_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"kiosk_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"retired_at" timestamp with time zone NOT NULL,
	"retired_by" text
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kiosk_retired_token" ADD CONSTRAINT "kiosk_retired_token_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kiosk_retired_token" ADD CONSTRAINT "kiosk_retired_token_retired_by_user_id_fk" FOREIGN KEY ("retired_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kiosk_retired_token" ADD CONSTRAINT "kiosk_retired_token_kiosk_fk" FOREIGN KEY ("kiosk_id","organization_id") REFERENCES "public"."kiosk"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "kioskRetiredToken_tokenHash_idx" ON "kiosk_retired_token" USING btree ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kioskRetiredToken_kiosk_idx" ON "kiosk_retired_token" USING btree ("organization_id","kiosk_id");
