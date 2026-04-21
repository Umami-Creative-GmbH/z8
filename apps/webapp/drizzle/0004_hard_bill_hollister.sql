ALTER TABLE "sso_provider" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "two_factor" ADD COLUMN "verified" boolean DEFAULT true;--> statement-breakpoint
