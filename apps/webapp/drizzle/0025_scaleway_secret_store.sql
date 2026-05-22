CREATE TYPE "public"."secret_store_provider" AS ENUM('vault', 'scaleway');--> statement-breakpoint
CREATE TABLE "organization_secret" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"key" text NOT NULL,
	"provider" "secret_store_provider" NOT NULL,
	"kms_key_id" text NOT NULL,
	"ciphertext" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_secret_key" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"provider" "secret_store_provider" NOT NULL,
	"scaleway_key_id" text NOT NULL,
	"region" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"disabled_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "organization_secret" ADD CONSTRAINT "organization_secret_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_secret_key" ADD CONSTRAINT "organization_secret_key_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organizationSecret_organizationId_idx" ON "organization_secret" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizationSecret_org_key_idx" ON "organization_secret" USING btree ("organization_id","key");--> statement-breakpoint
CREATE INDEX "organizationSecretKey_organizationId_idx" ON "organization_secret_key" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizationSecretKey_org_provider_active_idx" ON "organization_secret_key" USING btree ("organization_id","provider") WHERE "organization_secret_key"."disabled_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "organizationSecretKey_scalewayKeyId_idx" ON "organization_secret_key" USING btree ("scaleway_key_id");
