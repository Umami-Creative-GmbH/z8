-- #2043 / #2037: Record originating chat installation & credential revision on
-- approval delivery messages, approval delivery work, and legacy provider card tables,
-- plus durable pre-dispatch intent & cross-switch reconciliation columns on approval_delivery_work.
-- Additive and nullable so existing rows and older application versions keep working.
ALTER TABLE "approval_delivery_message"
	ADD COLUMN IF NOT EXISTS "installation_id" uuid REFERENCES "chat_installation"("id") ON DELETE set null,
	ADD COLUMN IF NOT EXISTS "credential_revision_id" uuid REFERENCES "chat_installation_credential_revision"("id") ON DELETE set null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approvalDeliveryMessage_org_installation_state_idx"
	ON "approval_delivery_message" USING btree ("organization_id", "installation_id", "state");
--> statement-breakpoint
ALTER TABLE "approval_delivery_work"
	ADD COLUMN IF NOT EXISTS "installation_id" uuid REFERENCES "chat_installation"("id") ON DELETE set null,
	ADD COLUMN IF NOT EXISTS "credential_revision_id" uuid REFERENCES "chat_installation_credential_revision"("id") ON DELETE set null,
	ADD COLUMN IF NOT EXISTS "dispatch_intent_at" timestamp with time zone,
	ADD COLUMN IF NOT EXISTS "dispatch_attempt_state" text,
	ADD COLUMN IF NOT EXISTS "reconciliation_required_at" timestamp with time zone,
	ADD COLUMN IF NOT EXISTS "reconciliation_context" jsonb,
	ADD COLUMN IF NOT EXISTS "unknown_closed_at" timestamp with time zone;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'approval_delivery_work_dispatch_attempt_state_check'
	) THEN
		ALTER TABLE "approval_delivery_work"
			ADD CONSTRAINT "approval_delivery_work_dispatch_attempt_state_check"
			CHECK (
				"dispatch_attempt_state" IS NULL
				OR "dispatch_attempt_state" IN (
					'none',
					'intent_recorded',
					'confirmed_unsent',
					'sent',
					'uncertain_across_switch',
					'closed_unknown'
				)
			);
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approvalDeliveryWork_org_installation_status_idx"
	ON "approval_delivery_work" USING btree ("organization_id", "installation_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approvalDeliveryWork_org_reconciliation_idx"
	ON "approval_delivery_work" USING btree ("organization_id", "dispatch_attempt_state", "reconciliation_required_at")
	WHERE "dispatch_attempt_state" = 'uncertain_across_switch';
--> statement-breakpoint
ALTER TABLE "slack_approval_message"
	ADD COLUMN IF NOT EXISTS "installation_id" uuid REFERENCES "chat_installation"("id") ON DELETE set null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "slackApprovalMessage_org_installation_idx"
	ON "slack_approval_message" USING btree ("organization_id", "installation_id");
--> statement-breakpoint
ALTER TABLE "teams_approval_card"
	ADD COLUMN IF NOT EXISTS "installation_id" uuid REFERENCES "chat_installation"("id") ON DELETE set null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "teamsApprovalCard_org_installation_idx"
	ON "teams_approval_card" USING btree ("organization_id", "installation_id");
--> statement-breakpoint
ALTER TABLE "telegram_approval_message"
	ADD COLUMN IF NOT EXISTS "installation_id" uuid REFERENCES "chat_installation"("id") ON DELETE set null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "telegramApprovalMessage_org_installation_idx"
	ON "telegram_approval_message" USING btree ("organization_id", "installation_id");
--> statement-breakpoint
ALTER TABLE "discord_approval_message"
	ADD COLUMN IF NOT EXISTS "installation_id" uuid REFERENCES "chat_installation"("id") ON DELETE set null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "discordApprovalMessage_org_installation_idx"
	ON "discord_approval_message" USING btree ("organization_id", "installation_id");
