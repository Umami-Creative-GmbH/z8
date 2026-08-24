CREATE TYPE "public"."lifecycle_actor_type" AS ENUM('user', 'system');--> statement-breakpoint
CREATE TYPE "public"."scim_connection_state" AS ENUM('creating', 'active', 'decommissioning', 'decommissioned');--> statement-breakpoint
CREATE TYPE "public"."scim_deprovision_action" AS ENUM('soft_delete', 'suspend');--> statement-breakpoint
CREATE TYPE "public"."scim_outbox_status" AS ENUM('pending', 'processing', 'completed');--> statement-breakpoint
CREATE TYPE "public"."scim_projection_recovery_status" AS ENUM('pending', 'processing', 'completed');--> statement-breakpoint
CREATE TABLE "scim_connection_binding" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"connection_key" text NOT NULL,
	"provisioning_domain_id" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"decommissioned_at" timestamp,
	"decommission_status" text DEFAULT 'active' NOT NULL,
	"decommission_cursor_user_id" text,
	"decommission_reconciled_user_count" integer DEFAULT 0 NOT NULL,
	"decommission_batch_count" integer DEFAULT 0 NOT NULL,
	"decommission_revision" integer DEFAULT 0 NOT NULL,
	"decommission_completed_at" timestamp,
	"decommission_lease_id" text,
	"decommission_lease_expires_at" timestamp,
	CONSTRAINT "scim_connection_binding_connection_key_unique" UNIQUE("connection_key")
);
--> statement-breakpoint
CREATE TABLE "scim_group" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"provisioning_domain_id" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"display_name" text NOT NULL,
	"display_name_key" text NOT NULL,
	"external_id" text,
	"external_id_key" text,
	"order_key" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "scim_group_display_name_key_unique" UNIQUE("display_name_key"),
	CONSTRAINT "scim_group_external_id_key_unique" UNIQUE("external_id_key"),
	CONSTRAINT "scim_group_order_key_unique" UNIQUE("order_key")
);
--> statement-breakpoint
CREATE TABLE "scim_group_member" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"group_id" text NOT NULL,
	"scim_user_id" text NOT NULL,
	"membership_key" text NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "scim_group_member_membership_key_unique" UNIQUE("membership_key")
);
--> statement-breakpoint
CREATE TABLE "scim_identity_tombstone" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"provisioning_domain_id" text NOT NULL,
	"external_id" text NOT NULL,
	"external_id_key" text NOT NULL,
	"user_id" text NOT NULL,
	"profile" text NOT NULL,
	"deleted_at" timestamp NOT NULL,
	CONSTRAINT "scim_identity_tombstone_external_id_key_unique" UNIQUE("external_id_key")
);
--> statement-breakpoint
CREATE TABLE "scim_managed_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"creation_request_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"provisioning_domain_id" text NOT NULL,
	"status" text NOT NULL,
	"revision" integer NOT NULL,
	"created_at" timestamp NOT NULL,
	"created_by" text NOT NULL,
	"decommission_started_at" timestamp,
	"decommission_started_by" text,
	"decommissioned_at" timestamp,
	"decommissioned_by" text,
	CONSTRAINT "scim_managed_connection_creation_request_id_unique" UNIQUE("creation_request_id"),
	CONSTRAINT "scim_managed_connection_connection_id_unique" UNIQUE("connection_id")
);
--> statement-breakpoint
CREATE TABLE "scim_managed_connection_event" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_record_id" text NOT NULL,
	"event_key" text NOT NULL,
	"sequence" integer NOT NULL,
	"type" text NOT NULL,
	"actor_id" text NOT NULL,
	"credential_id" text,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "scim_managed_connection_event_event_key_unique" UNIQUE("event_key")
);
--> statement-breakpoint
CREATE TABLE "scim_managed_credential" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_record_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"token_digest" text NOT NULL,
	"hash_version" text NOT NULL,
	"active_slot_key" text NOT NULL,
	"status" text NOT NULL,
	"serialized_scopes" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	"created_by" text NOT NULL,
	"last_used_at" timestamp,
	"revoked_at" timestamp,
	"revoked_by" text,
	"decommissioned_at" timestamp,
	CONSTRAINT "scim_managed_credential_credential_id_unique" UNIQUE("credential_id"),
	CONSTRAINT "scim_managed_credential_active_slot_key_unique" UNIQUE("active_slot_key")
);
--> statement-breakpoint
CREATE TABLE "scim_projection_grant" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"provisioning_domain_id" text NOT NULL,
	"scim_user_id" text NOT NULL,
	"user_id" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" text NOT NULL,
	"source_value" text,
	"role" text NOT NULL,
	"grant_key" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "scim_projection_grant_grant_key_unique" UNIQUE("grant_key")
);
--> statement-breakpoint
CREATE TABLE "scim_subject" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"profile_source_id" text,
	"revision" integer NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "scim_subject_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "scim_user" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"provisioning_domain_id" text NOT NULL,
	"user_id" text NOT NULL,
	"connection_user_key" text NOT NULL,
	"user_name" text NOT NULL,
	"user_name_key" text NOT NULL,
	"primary_email" text NOT NULL,
	"work_email_value_index" text NOT NULL,
	"email_value_index" text NOT NULL,
	"display_name" text NOT NULL,
	"formatted_name" text NOT NULL,
	"given_name" text,
	"family_name" text,
	"serialized_emails" text NOT NULL,
	"serialized_attributes" text,
	"external_id" text,
	"external_id_key" text,
	"active" boolean NOT NULL,
	"order_key" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "scim_user_connection_user_key_unique" UNIQUE("connection_user_key"),
	CONSTRAINT "scim_user_user_name_key_unique" UNIQUE("user_name_key"),
	CONSTRAINT "scim_user_external_id_key_unique" UNIQUE("external_id_key"),
	CONSTRAINT "scim_user_order_key_unique" UNIQUE("order_key")
);
--> statement-breakpoint
CREATE TABLE "scim_projection_recovery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"status" "scim_projection_recovery_status" DEFAULT 'pending' NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"claim_token" uuid,
	"claimed_at" timestamp with time zone,
	"last_error_code" varchar(64),
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scim_role_projection_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role_template_id" uuid NOT NULL,
	"source_group_id" text,
	"applied_role_template_id" uuid,
	"applied_default_team_id" uuid,
	"applied_default_team_membership_owned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scim_billing_seat_sync_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"user_id" text,
	"membership_revision" integer NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" "scim_outbox_status" DEFAULT 'pending' NOT NULL,
	"available_at" timestamp DEFAULT now() NOT NULL,
	"claimed_at" timestamp,
	"claim_token" uuid,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scim_user_lifecycle_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"user_id" text NOT NULL,
	"membership_revision" integer NOT NULL,
	"scim_active" boolean NOT NULL,
	"prior_member_status" text,
	"prior_employee_is_active" boolean,
	"deactivation_owned" boolean DEFAULT false NOT NULL,
	"member_deactivation_owned" boolean DEFAULT false NOT NULL,
	"employee_deactivation_owned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $enabled_legacy_scim_setup_guard$
BEGIN
	IF to_regclass('public.enterprise_identity_setup') IS NOT NULL THEN
		IF EXISTS (
			SELECT 1
			FROM public."enterprise_identity_setup" AS setup
			WHERE CASE
				WHEN setup."scim" IS NULL OR setup."scim" = 'null'::jsonb THEN false
				WHEN jsonb_typeof(setup."scim") = 'boolean' THEN (setup."scim" #>> '{}')::boolean
				WHEN jsonb_typeof(setup."scim") <> 'object' THEN true
				WHEN NOT (setup."scim" ? 'enabled') THEN false
				WHEN setup."scim" -> 'enabled' = 'null'::jsonb THEN false
				WHEN jsonb_typeof(setup."scim" -> 'enabled') = 'boolean' THEN (setup."scim" ->> 'enabled')::boolean
				WHEN jsonb_typeof(setup."scim" -> 'enabled') = 'string' THEN
					lower(btrim(setup."scim" ->> 'enabled')) NOT IN ('false', 'f', '0', 'no', 'n', 'off', 'disabled')
				WHEN jsonb_typeof(setup."scim" -> 'enabled') = 'number' THEN (setup."scim" ->> 'enabled')::numeric <> 0
				ELSE true
			END
		) THEN
			RAISE EXCEPTION USING
				ERRCODE = 'P0001',
				MESSAGE = 'Legacy enterprise identity setup still claims SCIM is enabled. Disable the legacy SCIM setup explicitly, then retry.';
		END IF;
	END IF;
END
$enabled_legacy_scim_setup_guard$;
--> statement-breakpoint
DO $scim_legacy_storage_guard$
BEGIN
	IF to_regclass('public.scim_provider') IS NOT NULL THEN
		IF EXISTS (SELECT 1 FROM public."scim_provider") THEN
			RAISE EXCEPTION USING
				ERRCODE = 'P0001',
				MESSAGE = 'Legacy SCIM storage public.scim_provider is not empty; there is no supported automatic data migration. Remove or migrate those rows explicitly, then retry.';
		END IF;
	END IF;

	IF to_regclass('public.scim_provider_config') IS NOT NULL THEN
		IF EXISTS (SELECT 1 FROM public."scim_provider_config") THEN
			RAISE EXCEPTION USING
				ERRCODE = 'P0001',
				MESSAGE = 'Legacy SCIM storage public.scim_provider_config is not empty; there is no supported automatic data migration. Remove or migrate those rows explicitly, then retry.';
		END IF;
	END IF;
END
$scim_legacy_storage_guard$;
--> statement-breakpoint
ALTER TABLE "scim_provider" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "scim_provider";--> statement-breakpoint
ALTER TABLE "scim_provider_config" DROP CONSTRAINT "scim_provider_config_organization_id_unique";--> statement-breakpoint
DROP INDEX "scimProviderConfig_organizationId_idx";--> statement-breakpoint
DROP INDEX "scimProviderConfig_providerId_idx";--> statement-breakpoint
ALTER TABLE "user_lifecycle_event" ALTER COLUMN "created_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "scim_provider_config" ALTER COLUMN "deprovision_action" SET DEFAULT 'suspend'::"public"."scim_deprovision_action";--> statement-breakpoint
ALTER TABLE "scim_provider_config" ALTER COLUMN "deprovision_action" SET DATA TYPE "public"."scim_deprovision_action" USING "deprovision_action"::"public"."scim_deprovision_action";--> statement-breakpoint
ALTER TABLE "scim_provider_config" ALTER COLUMN "default_role_template_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_lifecycle_event" ADD COLUMN "actor_type" "lifecycle_actor_type" DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "scim_provider_config" ADD COLUMN "creation_request_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "scim_provider_config" ADD COLUMN "connection_id" text;--> statement-breakpoint
ALTER TABLE "scim_provider_config" ADD COLUMN "state" "scim_connection_state" DEFAULT 'creating' NOT NULL;--> statement-breakpoint
ALTER TABLE "scim_provider_config" ADD COLUMN "decommission_retry_at" timestamp;--> statement-breakpoint
ALTER TABLE "scim_provider_config" ADD COLUMN "decommission_attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "scim_provider_config" ADD COLUMN "decommission_last_error" text;--> statement-breakpoint
ALTER TABLE "scim_provider_config" ADD COLUMN "decommission_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "scim_provider_config" ADD COLUMN "decommission_completed_at" timestamp;--> statement-breakpoint
ALTER TABLE "scim_provisioning_log" ADD COLUMN "connection_id" text;--> statement-breakpoint
ALTER TABLE "scim_provisioning_log" ADD COLUMN "scim_resource_id" text;--> statement-breakpoint
ALTER TABLE "scim_provisioning_log" ADD COLUMN "request_id" text;--> statement-breakpoint
ALTER TABLE "scim_group_member" ADD CONSTRAINT "scim_group_member_group_id_scim_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."scim_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_group_member" ADD CONSTRAINT "scim_group_member_scim_user_id_scim_user_id_fk" FOREIGN KEY ("scim_user_id") REFERENCES "public"."scim_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_identity_tombstone" ADD CONSTRAINT "scim_identity_tombstone_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_managed_connection_event" ADD CONSTRAINT "scim_managed_connection_event_connection_record_id_scim_managed_connection_id_fk" FOREIGN KEY ("connection_record_id") REFERENCES "public"."scim_managed_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_managed_credential" ADD CONSTRAINT "scim_managed_credential_connection_record_id_scim_managed_connection_id_fk" FOREIGN KEY ("connection_record_id") REFERENCES "public"."scim_managed_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_projection_grant" ADD CONSTRAINT "scim_projection_grant_scim_user_id_scim_user_id_fk" FOREIGN KEY ("scim_user_id") REFERENCES "public"."scim_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_projection_grant" ADD CONSTRAINT "scim_projection_grant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_subject" ADD CONSTRAINT "scim_subject_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_user" ADD CONSTRAINT "scim_user_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_projection_recovery" ADD CONSTRAINT "scim_projection_recovery_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_role_projection_state" ADD CONSTRAINT "scim_role_projection_state_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_role_projection_state" ADD CONSTRAINT "scim_role_projection_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_role_projection_state" ADD CONSTRAINT "scim_role_projection_state_role_template_id_role_template_id_fk" FOREIGN KEY ("role_template_id") REFERENCES "public"."role_template"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_role_projection_state" ADD CONSTRAINT "scim_role_projection_state_applied_role_template_id_role_template_id_fk" FOREIGN KEY ("applied_role_template_id") REFERENCES "public"."role_template"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_role_projection_state" ADD CONSTRAINT "scim_role_projection_state_applied_default_team_id_team_id_fk" FOREIGN KEY ("applied_default_team_id") REFERENCES "public"."team"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_billing_seat_sync_outbox" ADD CONSTRAINT "scim_billing_seat_sync_outbox_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_billing_seat_sync_outbox" ADD CONSTRAINT "scim_billing_seat_sync_outbox_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_user_lifecycle_state" ADD CONSTRAINT "scim_user_lifecycle_state_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_user_lifecycle_state" ADD CONSTRAINT "scim_user_lifecycle_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scimConnectionBinding_connectionId_idx" ON "scim_connection_binding" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "scimGroup_connectionId_idx" ON "scim_group" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "scimGroup_provisioningDomainId_idx" ON "scim_group" USING btree ("provisioning_domain_id");--> statement-breakpoint
CREATE INDEX "scimGroupMember_connectionId_idx" ON "scim_group_member" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "scimGroupMember_groupId_idx" ON "scim_group_member" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "scimGroupMember_scimUserId_idx" ON "scim_group_member" USING btree ("scim_user_id");--> statement-breakpoint
CREATE INDEX "scimIdentityTombstone_connectionId_idx" ON "scim_identity_tombstone" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "scimIdentityTombstone_provisioningDomainId_idx" ON "scim_identity_tombstone" USING btree ("provisioning_domain_id");--> statement-breakpoint
CREATE INDEX "scimIdentityTombstone_userId_idx" ON "scim_identity_tombstone" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "scimManagedConnection_provisioningDomainId_idx" ON "scim_managed_connection" USING btree ("provisioning_domain_id");--> statement-breakpoint
CREATE INDEX "scimManagedConnectionEvent_connectionRecordId_idx" ON "scim_managed_connection_event" USING btree ("connection_record_id");--> statement-breakpoint
CREATE INDEX "scimManagedCredential_connectionRecordId_idx" ON "scim_managed_credential" USING btree ("connection_record_id");--> statement-breakpoint
CREATE INDEX "scimProjectionGrant_connectionId_idx" ON "scim_projection_grant" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "scimProjectionGrant_provisioningDomainId_idx" ON "scim_projection_grant" USING btree ("provisioning_domain_id");--> statement-breakpoint
CREATE INDEX "scimProjectionGrant_scimUserId_idx" ON "scim_projection_grant" USING btree ("scim_user_id");--> statement-breakpoint
CREATE INDEX "scimProjectionGrant_userId_idx" ON "scim_projection_grant" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "scimSubject_profileSourceId_idx" ON "scim_subject" USING btree ("profile_source_id");--> statement-breakpoint
CREATE INDEX "scimUser_connectionId_idx" ON "scim_user" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "scimUser_provisioningDomainId_idx" ON "scim_user" USING btree ("provisioning_domain_id");--> statement-breakpoint
CREATE INDEX "scimUser_userId_idx" ON "scim_user" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "scimProjectionRecovery_organizationId_status_availableAt_idx" ON "scim_projection_recovery" USING btree ("organization_id","status","available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "scimRoleProjectionState_organizationId_userId_unique_idx" ON "scim_role_projection_state" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scimSeatSyncOutbox_organizationId_dedupeKey_unique_idx" ON "scim_billing_seat_sync_outbox" USING btree ("organization_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "scimSeatSyncOutbox_status_availableAt_idx" ON "scim_billing_seat_sync_outbox" USING btree ("status","available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "scimUserLifecycleState_organizationId_userId_unique_idx" ON "scim_user_lifecycle_state" USING btree ("organization_id","user_id");--> statement-breakpoint
ALTER TABLE "scim_provider_config" ADD CONSTRAINT "scim_provider_config_default_role_template_id_role_template_id_fk" FOREIGN KEY ("default_role_template_id") REFERENCES "public"."role_template"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scimProviderConfig_organizationId_unique_idx" ON "scim_provider_config" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scimProviderConfig_creationRequestId_unique_idx" ON "scim_provider_config" USING btree ("creation_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scimProviderConfig_connectionId_unique_idx" ON "scim_provider_config" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "scimProviderConfig_organizationId_connectionId_idx" ON "scim_provider_config" USING btree ("organization_id","connection_id");--> statement-breakpoint
CREATE INDEX "scimProvisioningLog_organizationId_createdAt_idx" ON "scim_provisioning_log" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "scimProvisioningLog_connectionId_idx" ON "scim_provisioning_log" USING btree ("connection_id");--> statement-breakpoint
ALTER TABLE "scim_provider_config" DROP COLUMN "provider_id";--> statement-breakpoint
ALTER TABLE "user_lifecycle_event" ADD CONSTRAINT "user_lifecycle_event_actor_check" CHECK (("user_lifecycle_event"."actor_type" = 'user' AND "user_lifecycle_event"."created_by" IS NOT NULL) OR ("user_lifecycle_event"."actor_type" = 'system' AND "user_lifecycle_event"."created_by" IS NULL));
