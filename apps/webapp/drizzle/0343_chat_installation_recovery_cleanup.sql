-- #2046 / #2037: Chat installation rotation, revocation, generation-fenced cleanup, & restore.
-- 1) Tracks `endpoint_state` on `chat_installation` so timed-out/uncertain provider endpoint
--    mutations require explicit provider state reconciliation before reactivation.
-- 2) Adds `chat_installation_cleanup_job` for asynchronous, retryable, generation-fenced
--    credential revision cleanup and provider endpoint cleanup serialized by `stable_bot_key`.
ALTER TABLE "chat_installation"
	ADD COLUMN IF NOT EXISTS "endpoint_state" text DEFAULT 'synced' NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
	ALTER TABLE "chat_installation"
		ADD CONSTRAINT "chat_installation_endpoint_state_check"
		CHECK ("endpoint_state" IN ('synced', 'uncertain', 'removed'));
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_installation_cleanup_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
	"installation_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"stable_bot_key" text NOT NULL,
	"kind" text NOT NULL,
	"credential_revision_id" uuid REFERENCES "chat_installation_credential_revision"("id") ON DELETE set null,
	"authorized_generation" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error_code" text,
	"redacted_diagnostics" jsonb,
	"completed_at" timestamp with time zone,
	"exhausted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_installation_cleanup_job_installation_fk" FOREIGN KEY ("installation_id", "organization_id")
		REFERENCES "chat_installation"("id", "organization_id") ON DELETE cascade,
	CONSTRAINT "chat_installation_cleanup_job_provider_check" CHECK ("provider" IN ('slack', 'teams', 'telegram', 'discord')),
	CONSTRAINT "chat_installation_cleanup_job_kind_check" CHECK ("kind" IN ('credential_revision_cleanup', 'provider_endpoint_cleanup')),
	CONSTRAINT "chat_installation_cleanup_job_status_check" CHECK ("status" IN ('pending', 'processing', 'completed', 'skipped_stale_generation', 'exhausted')),
	CONSTRAINT "chat_installation_cleanup_job_authorized_generation_check" CHECK ("authorized_generation" >= 0),
	CONSTRAINT "chat_installation_cleanup_job_attempts_check" CHECK ("attempt_count" >= 0 AND "max_attempts" >= 1),
	CONSTRAINT "chat_installation_cleanup_job_stable_bot_key_check" CHECK (length(btrim("stable_bot_key")) > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chatInstallationCleanupJob_due_idx"
	ON "chat_installation_cleanup_job" USING btree ("status", "next_attempt_at")
	WHERE "status" IN ('pending', 'processing');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chatInstallationCleanupJob_org_inst_idx"
	ON "chat_installation_cleanup_job" USING btree ("organization_id", "installation_id", "kind", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chatInstallationCleanupJob_stable_bot_key_idx"
	ON "chat_installation_cleanup_job" USING btree ("stable_bot_key", "status");
