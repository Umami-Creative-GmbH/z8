-- #991: an ICS feed URL is a bearer credential, so store only a digest of its
-- secret. Existing secrets are hashed in place with the digest the app computes
-- (hex SHA-256, version v1), so every URL already subscribed in a calendar app
-- keeps resolving to the same feed. Deactivated feeds become revoked feeds,
-- dated by their last update; who deactivated them was never recorded.
-- Every step is guarded, so re-running the migration changes nothing.
ALTER TABLE "ics_feed" ADD COLUMN IF NOT EXISTS "secret_digest" text;--> statement-breakpoint
ALTER TABLE "ics_feed" ADD COLUMN IF NOT EXISTS "secret_hash_version" text;--> statement-breakpoint
ALTER TABLE "ics_feed" ADD COLUMN IF NOT EXISTS "revoked_at" timestamp;--> statement-breakpoint
ALTER TABLE "ics_feed" ADD COLUMN IF NOT EXISTS "revoked_by" text;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'ics_feed' AND column_name = 'secret'
	) THEN
		UPDATE "ics_feed"
		SET "secret_digest" = encode(sha256(convert_to("secret", 'UTF8')), 'hex'),
			"secret_hash_version" = 'v1'
		WHERE "secret_digest" IS NULL;
	END IF;
	IF EXISTS (
		SELECT 1 FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'ics_feed' AND column_name = 'is_active'
	) THEN
		UPDATE "ics_feed" SET "revoked_at" = "updated_at"
		WHERE "is_active" = false AND "revoked_at" IS NULL;
	END IF;
	IF EXISTS (
		SELECT 1 FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'ics_feed' AND column_name = 'last_accessed_at'
	) AND NOT EXISTS (
		SELECT 1 FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'ics_feed' AND column_name = 'last_used_at'
	) THEN
		ALTER TABLE "ics_feed" RENAME COLUMN "last_accessed_at" TO "last_used_at";
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'ics_feed_revoked_by_user_id_fk'
	) THEN
		ALTER TABLE "ics_feed" ADD CONSTRAINT "ics_feed_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "ics_feed" ALTER COLUMN "secret_digest" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ics_feed" ALTER COLUMN "secret_hash_version" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "icsFeed_secretDigest_idx" ON "ics_feed" USING btree ("secret_digest");--> statement-breakpoint
DROP INDEX IF EXISTS "icsFeed_secret_idx";--> statement-breakpoint
ALTER TABLE "ics_feed" DROP CONSTRAINT IF EXISTS "ics_feed_secret_unique";--> statement-breakpoint
ALTER TABLE "ics_feed" DROP COLUMN IF EXISTS "secret";--> statement-breakpoint
ALTER TABLE "ics_feed" DROP COLUMN IF EXISTS "is_active";
