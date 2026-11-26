-- #2040 / #2037: Additive foundation schema for organization-owned chat installations,
-- external ownership claims, immutable credential revisions, installation-scoped conversations,
-- provider settings, and additive-default switch rollout control.
-- Existing legacy provider tables and constraints remain untouched.
CREATE TABLE IF NOT EXISTS "chat_external_ownership_claim" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
	"provider" text NOT NULL,
	"claim_kind" text NOT NULL,
	"external_id" text NOT NULL,
	"provenance" text DEFAULT 'verified_setup' NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chatExternalOwnershipClaim_id_organizationId_unique" UNIQUE("id", "organization_id"),
	CONSTRAINT "chat_external_ownership_claim_provider_check" CHECK ("provider" IN ('slack', 'teams', 'telegram', 'discord')),
	CONSTRAINT "chat_external_ownership_claim_kind_check" CHECK ("claim_kind" IN ('workspace', 'tenant', 'bot')),
	CONSTRAINT "chat_external_ownership_claim_provenance_check" CHECK ("provenance" IN ('legacy_backfill', 'verified_setup')),
	CONSTRAINT "chat_external_ownership_claim_external_id_check" CHECK (length(btrim("external_id")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chatExternalOwnershipClaim_provider_kind_external_unique_idx"
	ON "chat_external_ownership_claim" USING btree ("provider", "claim_kind", "external_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chatExternalOwnershipClaim_organizationId_idx"
	ON "chat_external_ownership_claim" USING btree ("organization_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_installation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
	"provider" text NOT NULL,
	"credential_source" text NOT NULL,
	"status" text NOT NULL,
	"route_id" text NOT NULL,
	"external_app_id" text,
	"external_bot_id" text,
	"external_bot_username" text,
	"external_display_name" text,
	"external_space_id" text,
	"external_space_name" text,
	"receiver_scope" text,
	"space_claim_id" uuid,
	"bot_claim_id" uuid,
	"active_credential_revision_id" uuid,
	"legacy_table" text,
	"legacy_record_id" uuid,
	"legacy_status" text,
	"remediation_reason" text,
	"remediation_details" jsonb,
	"verification_state" text DEFAULT 'unverified' NOT NULL,
	"verification_evidence" jsonb,
	"last_verified_at" timestamp with time zone,
	"retirement_deadline_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"endpoint_generation" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" text REFERENCES "user"("id") ON DELETE set null,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chatInstallation_id_organizationId_unique" UNIQUE("id", "organization_id"),
	CONSTRAINT "chat_installation_space_claim_fk" FOREIGN KEY ("space_claim_id", "organization_id") REFERENCES "chat_external_ownership_claim"("id", "organization_id"),
	CONSTRAINT "chat_installation_bot_claim_fk" FOREIGN KEY ("bot_claim_id", "organization_id") REFERENCES "chat_external_ownership_claim"("id", "organization_id"),
	CONSTRAINT "chat_installation_provider_check" CHECK ("provider" IN ('slack', 'teams', 'telegram', 'discord')),
	CONSTRAINT "chat_installation_credential_source_check" CHECK ("credential_source" IN ('organization_owned', 'deployment_managed')),
	CONSTRAINT "chat_installation_status_check" CHECK ("status" IN ('candidate', 'active', 'legacy_active', 'retiring', 'retired', 'revoked', 'remediation_required')),
	CONSTRAINT "chat_installation_verification_state_check" CHECK ("verification_state" IN ('unverified', 'pending', 'verified', 'failed', 'expired')),
	CONSTRAINT "chat_installation_legacy_table_check" CHECK ("legacy_table" IS NULL OR "legacy_table" IN ('slack_workspace_config', 'teams_tenant_config', 'telegram_bot_config', 'discord_bot_config')),
	CONSTRAINT "chat_installation_legacy_pair_check" CHECK (("legacy_table" IS NULL) = ("legacy_record_id" IS NULL)),
	CONSTRAINT "chat_installation_remediation_reason_check" CHECK ("remediation_reason" IS NULL OR "remediation_reason" IN ('duplicate_external_identity', 'unknown_bot_identity', 'unexpected_legacy_status', 'secret_store_unavailable')),
	CONSTRAINT "chat_installation_endpoint_generation_check" CHECK ("endpoint_generation" >= 0),
	CONSTRAINT "chat_installation_route_id_check" CHECK (length(btrim("route_id")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chatInstallation_routeId_unique_idx"
	ON "chat_installation" USING btree ("route_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chatInstallation_org_provider_active_unique_idx"
	ON "chat_installation" USING btree ("organization_id", "provider")
	WHERE "status" = 'active';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chatInstallation_org_legacy_record_unique_idx"
	ON "chat_installation" USING btree ("organization_id", "legacy_table", "legacy_record_id")
	WHERE "legacy_table" IS NOT NULL AND "legacy_record_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chatInstallation_org_provider_status_idx"
	ON "chat_installation" USING btree ("organization_id", "provider", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chatInstallation_spaceClaimId_idx"
	ON "chat_installation" USING btree ("space_claim_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chatInstallation_botClaimId_idx"
	ON "chat_installation" USING btree ("bot_claim_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_provider_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
	"provider" text NOT NULL,
	"is_authoritative" boolean DEFAULT false NOT NULL,
	"active_installation_id" uuid,
	"enable_approvals" boolean DEFAULT true NOT NULL,
	"enable_commands" boolean DEFAULT true NOT NULL,
	"enable_daily_digest" boolean DEFAULT true NOT NULL,
	"enable_escalations" boolean DEFAULT true NOT NULL,
	"digest_time" text DEFAULT '08:00' NOT NULL,
	"digest_timezone" text DEFAULT 'UTC' NOT NULL,
	"escalation_timeout_hours" integer DEFAULT 24 NOT NULL,
	"confirmed_by_user_id" text REFERENCES "user"("id") ON DELETE set null,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_provider_settings_active_installation_fk" FOREIGN KEY ("active_installation_id", "organization_id") REFERENCES "chat_installation"("id", "organization_id"),
	CONSTRAINT "chat_provider_settings_provider_check" CHECK ("provider" IN ('slack', 'teams', 'telegram', 'discord')),
	CONSTRAINT "chat_provider_settings_escalation_timeout_check" CHECK ("escalation_timeout_hours" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chatProviderSettings_org_provider_unique_idx"
	ON "chat_provider_settings" USING btree ("organization_id", "provider");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_installation_credential_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"installation_id" uuid NOT NULL,
	"organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
	"revision_number" integer NOT NULL,
	"secret_store_provider" "secret_store_provider" NOT NULL,
	"secret_key_prefix" text NOT NULL,
	"secret_keys" jsonb NOT NULL,
	"status" text DEFAULT 'staged' NOT NULL,
	"external_identity_fingerprint" text,
	"verified_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by_user_id" text REFERENCES "user"("id") ON DELETE set null,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chatInstallationCredentialRevision_id_inst_org_unique" UNIQUE("id", "installation_id", "organization_id"),
	CONSTRAINT "chat_installation_credential_revision_installation_fk" FOREIGN KEY ("installation_id", "organization_id") REFERENCES "chat_installation"("id", "organization_id") ON DELETE cascade,
	CONSTRAINT "chat_installation_credential_revision_number_check" CHECK ("revision_number" >= 1),
	CONSTRAINT "chat_installation_credential_revision_status_check" CHECK ("status" IN ('staged', 'verified', 'active', 'superseded', 'revoked', 'cleanup_pending', 'cleaned_up'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chatInstallationCredentialRevision_inst_rev_unique_idx"
	ON "chat_installation_credential_revision" USING btree ("installation_id", "revision_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chatInstallationCredentialRevision_org_inst_idx"
	ON "chat_installation_credential_revision" USING btree ("organization_id", "installation_id");
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'chat_installation_active_credential_revision_fk'
	) THEN
		ALTER TABLE "chat_installation"
			ADD CONSTRAINT "chat_installation_active_credential_revision_fk"
			FOREIGN KEY ("active_credential_revision_id", "id", "organization_id")
			REFERENCES "chat_installation_credential_revision"("id", "installation_id", "organization_id")
			DEFERRABLE INITIALLY DEFERRED;
	END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_installation_conversation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
	"installation_id" uuid NOT NULL,
	"user_id" text REFERENCES "user"("id") ON DELETE cascade,
	"employee_id" uuid,
	"external_user_id" text,
	"external_conversation_id" text NOT NULL,
	"conversation_type" text DEFAULT 'private' NOT NULL,
	"conversation_reference" jsonb,
	"reachability_status" text DEFAULT 'unknown' NOT NULL,
	"reachability_reason" text,
	"verified_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"legacy_record_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_installation_conversation_installation_fk" FOREIGN KEY ("installation_id", "organization_id") REFERENCES "chat_installation"("id", "organization_id") ON DELETE cascade,
	CONSTRAINT "chat_installation_conversation_employee_fk" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employee"("id", "organization_id"),
	CONSTRAINT "chat_installation_conversation_reachability_check" CHECK ("reachability_status" IN ('unknown', 'reachable', 'action_needed', 'unreachable'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chatInstallationConversation_inst_user_type_unique_idx"
	ON "chat_installation_conversation" USING btree ("installation_id", "user_id", "conversation_type")
	WHERE "user_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chatInstallationConversation_inst_ext_conv_unique_idx"
	ON "chat_installation_conversation" USING btree ("installation_id", "external_conversation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chatInstallationConversation_org_inst_idx"
	ON "chat_installation_conversation" USING btree ("organization_id", "installation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chatInstallationConversation_org_user_idx"
	ON "chat_installation_conversation" USING btree ("organization_id", "user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_installation_switch_control" (
	"organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
	"provider" text NOT NULL,
	"enabled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"enabled_by_user_id" text REFERENCES "user"("id") ON DELETE set null,
	"notes" text,
	CONSTRAINT "chat_installation_switch_control_pk" PRIMARY KEY ("organization_id", "provider"),
	CONSTRAINT "chat_installation_switch_control_provider_check" CHECK ("provider" IN ('slack', 'teams', 'telegram', 'discord'))
);
