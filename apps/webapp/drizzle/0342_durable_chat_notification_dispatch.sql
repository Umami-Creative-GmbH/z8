-- #2044 / #2037: Durable chat notification dispatch ledger.
-- Records selected installation, credential revision, and dispatch intent before any
-- persistent chat notification or durable Telegram digest provider call.
-- Partial unique index prevents concurrent or repeated dispatch attempts unless prior
-- attempts were explicitly marked `confirmed_unsent`.
CREATE TABLE IF NOT EXISTS "chat_notification_dispatch_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
	"provider" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_ref_id" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"installation_id" uuid REFERENCES "chat_installation"("id") ON DELETE set null,
	"credential_revision_id" uuid REFERENCES "chat_installation_credential_revision"("id") ON DELETE set null,
	"status" text NOT NULL,
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"intent_recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider_called_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"reconciliation_required_at" timestamp with time zone,
	"unknown_closed_at" timestamp with time zone,
	"failure_classification" text,
	"redacted_diagnostics" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_notification_dispatch_attempt_provider_check" CHECK ("provider" IN ('slack', 'teams', 'telegram', 'discord')),
	CONSTRAINT "chat_notification_dispatch_attempt_source_kind_check" CHECK ("source_kind" IN ('persistent_notification', 'telegram_digest')),
	CONSTRAINT "chat_notification_dispatch_attempt_status_check" CHECK ("status" IN ('intent_recorded', 'confirmed_unsent', 'sent', 'reconciliation_required', 'closed_unknown')),
	CONSTRAINT "chat_notification_dispatch_attempt_failure_classification_check" CHECK ("failure_classification" IS NULL OR "failure_classification" IN ('confirmed_unsent', 'ambiguous', 'worker_lost', 'provider_error')),
	CONSTRAINT "chat_notification_dispatch_attempt_number_check" CHECK ("attempt_number" >= 1),
	CONSTRAINT "chat_notification_dispatch_attempt_source_ref_id_check" CHECK (length(btrim("source_ref_id")) > 0),
	CONSTRAINT "chat_notification_dispatch_attempt_dedupe_key_check" CHECK (length(btrim("dedupe_key")) > 0),
	CONSTRAINT "chat_notification_dispatch_attempt_closed_unknown_at_check" CHECK ("status" <> 'closed_unknown' OR "unknown_closed_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chatNotificationDispatchAttempt_org_dedupe_attempt_unique_idx"
	ON "chat_notification_dispatch_attempt" USING btree ("organization_id", "dedupe_key", "attempt_number");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chatNotificationDispatchAttempt_org_dedupe_active_unique_idx"
	ON "chat_notification_dispatch_attempt" USING btree ("organization_id", "dedupe_key")
	WHERE "status" IN ('intent_recorded', 'sent', 'reconciliation_required', 'closed_unknown');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chatNotificationDispatchAttempt_org_dedupe_idx"
	ON "chat_notification_dispatch_attempt" USING btree ("organization_id", "dedupe_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chatNotificationDispatchAttempt_org_provider_status_idx"
	ON "chat_notification_dispatch_attempt" USING btree ("organization_id", "provider", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chatNotificationDispatchAttempt_status_reconciliation_at_idx"
	ON "chat_notification_dispatch_attempt" USING btree ("status", "reconciliation_required_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chatNotificationDispatchAttempt_org_inst_status_idx"
	ON "chat_notification_dispatch_attempt" USING btree ("organization_id", "installation_id", "status");
