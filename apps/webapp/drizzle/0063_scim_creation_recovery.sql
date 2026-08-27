ALTER TYPE "public"."scim_connection_state" ADD VALUE 'creation_failed' BEFORE 'active';--> statement-breakpoint
ALTER TABLE "scim_provider_config" ADD COLUMN "creation_recovery_claim_token" uuid;--> statement-breakpoint
ALTER TABLE "scim_provider_config" ADD COLUMN "creation_recovery_claim_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "scim_provider_config" ADD COLUMN "creation_attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "scim_provider_config" ADD COLUMN "creation_last_error" text;