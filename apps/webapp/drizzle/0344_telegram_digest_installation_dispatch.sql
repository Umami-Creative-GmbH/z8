-- #2047: Add installation, credential revision, and durable dispatch attempt provenance
-- to telegram_digest_delivery so uncertain sends across a bot switch quarantine cleanly
-- without automatic repeat while remaining 100% additive for mixed-version deployments.

ALTER TABLE "telegram_digest_delivery"
	ADD COLUMN "installation_id" uuid REFERENCES "chat_installation"("id") ON DELETE SET NULL,
	ADD COLUMN "credential_revision_id" uuid REFERENCES "chat_installation_credential_revision"("id") ON DELETE SET NULL,
	ADD COLUMN "dispatch_attempt_id" uuid REFERENCES "chat_notification_dispatch_attempt"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX "telegramDigestDelivery_org_installation_idx"
	ON "telegram_digest_delivery" ("organization_id", "installation_id");
--> statement-breakpoint
CREATE INDEX "telegramDigestDelivery_dispatchAttemptId_idx"
	ON "telegram_digest_delivery" ("dispatch_attempt_id");
