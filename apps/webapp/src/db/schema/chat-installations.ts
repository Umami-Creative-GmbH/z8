import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	foreignKey,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "../auth-schema";
import { employee } from "./organization";
import { secretStoreProviderEnum } from "./secret-store";
import { currentTimestamp } from "./timestamp";

// ============================================
// CHAT INSTALLATIONS FOUNDATION (#2037 / #2040)
// ============================================

export const CHAT_INSTALLATION_PROVIDERS = ["slack", "teams", "telegram", "discord"] as const;
export type ChatInstallationProvider = (typeof CHAT_INSTALLATION_PROVIDERS)[number];

export const CHAT_CREDENTIAL_SOURCES = ["organization_owned", "deployment_managed"] as const;
export type ChatCredentialSource = (typeof CHAT_CREDENTIAL_SOURCES)[number];

export const CHAT_INSTALLATION_STATUSES = [
	"candidate",
	"active",
	"legacy_active",
	"retiring",
	"retired",
	"revoked",
	"remediation_required",
] as const;
export type ChatInstallationStatus = (typeof CHAT_INSTALLATION_STATUSES)[number];

export const CHAT_OWNERSHIP_CLAIM_KINDS = ["workspace", "tenant", "bot"] as const;
export type ChatOwnershipClaimKind = (typeof CHAT_OWNERSHIP_CLAIM_KINDS)[number];

export const CHAT_OWNERSHIP_CLAIM_PROVENANCES = ["legacy_backfill", "verified_setup"] as const;
export type ChatOwnershipClaimProvenance = (typeof CHAT_OWNERSHIP_CLAIM_PROVENANCES)[number];

export const CHAT_LEGACY_TABLE_NAMES = [
	"slack_workspace_config",
	"teams_tenant_config",
	"telegram_bot_config",
	"discord_bot_config",
] as const;
export type ChatLegacyTableName = (typeof CHAT_LEGACY_TABLE_NAMES)[number];

export const CHAT_VERIFICATION_STATES = [
	"unverified",
	"pending",
	"verified",
	"failed",
	"expired",
] as const;
export type ChatVerificationState = (typeof CHAT_VERIFICATION_STATES)[number];

export const CHAT_REMEDIATION_REASONS = [
	"duplicate_external_identity",
	"unknown_bot_identity",
	"unexpected_legacy_status",
	"secret_store_unavailable",
] as const;
export type ChatRemediationReason = (typeof CHAT_REMEDIATION_REASONS)[number];

export const CHAT_CREDENTIAL_REVISION_STATUSES = [
	"staged",
	"verified",
	"active",
	"superseded",
	"revoked",
	"cleanup_pending",
	"cleaned_up",
] as const;
export type ChatCredentialRevisionStatus = (typeof CHAT_CREDENTIAL_REVISION_STATUSES)[number];

export const CHAT_CONVERSATION_REACHABILITY_STATUSES = [
	"unknown",
	"reachable",
	"action_needed",
	"unreachable",
] as const;
export type ChatConversationReachabilityStatus =
	(typeof CHAT_CONVERSATION_REACHABILITY_STATUSES)[number];

export const CHAT_INSTALLATION_ENDPOINT_STATES = ["synced", "uncertain", "removed"] as const;
export type ChatInstallationEndpointState = (typeof CHAT_INSTALLATION_ENDPOINT_STATES)[number];

export interface ChatRemediationDetails {
	missingField?: string;
	legacyStatus?: string;
	legacyTable?: ChatLegacyTableName;
	legacyRecordId?: string;
	claimKind?: ChatOwnershipClaimKind;
	externalIdentityLabel?: string | null;
	secretStoreUnavailable?: boolean;
}

export interface ChatVerificationEvidence {
	source: "legacy_metadata" | "verified_setup";
	configuredAt?: string | null;
	workspaceId?: string | null;
	workspaceName?: string | null;
	tenantId?: string | null;
	applicationId?: string | null;
	botId?: string | null;
	botUserId?: string | null;
	botUsername?: string | null;
	numericBotId?: string | null;
	webhookRegistered?: boolean;
	interactionEndpointConfigured?: boolean;
	serviceUrlRecorded?: boolean;
	deploymentBotConfigured?: boolean;
	secretStoreStatus?: "available" | "missing" | "unavailable" | "not_applicable";
	identityVerifiedAt?: string | null;
	identityRevisionId?: string | null;
	signedEventVerifiedAt?: string | null;
	signedEventRevisionId?: string | null;
	signedEventType?: string | null;
	signedEventExpiresAt?: string | null;
	privateDeliveryVerifiedAt?: string | null;
	privateDeliveryRevisionId?: string | null;
	privateDeliveryTargetUserId?: string | null;
	privateDeliveryChannelId?: string | null;
	privateDeliveryExpiresAt?: string | null;
	commandsRegisteredAt?: string | null;
	lastFailureStep?: "credentials" | "identity" | "signed_event" | "private_test" | null;
	lastFailureCode?: string | null;
	lastFailureAt?: string | null;
	enrollmentProofCount?: number;
	lastEnrollmentProofAt?: string | null;
	rotatedAt?: string | null;
	rotatedRevisionId?: string | null;
	endpointReconciledAt?: string | null;
	endpointReconciledGeneration?: number | null;
}

/**
 * Separate external identity ownership claims (workspace, tenant, or bot).
 * Enforces unique ownership per (provider, claim_kind, external_id) across organizations,
 * while letting the owning organization attach multiple installations (active, candidate,
 * retiring) to the same claim via composite (claim_id, organization_id) FKs.
 */
export const chatExternalOwnershipClaim = pgTable(
	"chat_external_ownership_claim",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		provider: text("provider").$type<ChatInstallationProvider>().notNull(),
		claimKind: text("claim_kind").$type<ChatOwnershipClaimKind>().notNull(),
		externalId: text("external_id").notNull(),
		provenance: text("provenance")
			.$type<ChatOwnershipClaimProvenance>()
			.default("verified_setup")
			.notNull(),
		verifiedAt: timestamp("verified_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		unique("chatExternalOwnershipClaim_id_organizationId_unique").on(
			table.id,
			table.organizationId,
		),
		uniqueIndex("chatExternalOwnershipClaim_provider_kind_external_unique_idx").on(
			table.provider,
			table.claimKind,
			table.externalId,
		),
		index("chatExternalOwnershipClaim_organizationId_idx").on(table.organizationId),
		check(
			"chat_external_ownership_claim_provider_check",
			sql`${table.provider} IN ('slack', 'teams', 'telegram', 'discord')`,
		),
		check(
			"chat_external_ownership_claim_kind_check",
			sql`${table.claimKind} IN ('workspace', 'tenant', 'bot')`,
		),
		check(
			"chat_external_ownership_claim_provenance_check",
			sql`${table.provenance} IN ('legacy_backfill', 'verified_setup')`,
		),
		check(
			"chat_external_ownership_claim_external_id_check",
			sql`length(btrim(${table.externalId})) > 0`,
		),
	],
);

/**
 * Organization-scoped chat installation rows across Slack, Teams, Telegram, and Discord.
 * Enforces at most one `active` installation per (organization_id, provider) while allowing
 * multiple `legacy_active` Teams tenants prior to the first atomic switch and simultaneous
 * candidate/retiring installations.
 */
export const chatInstallation = pgTable(
	"chat_installation",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		provider: text("provider").$type<ChatInstallationProvider>().notNull(),
		credentialSource: text("credential_source").$type<ChatCredentialSource>().notNull(),
		status: text("status").$type<ChatInstallationStatus>().notNull(),
		routeId: text("route_id").notNull(),
		externalAppId: text("external_app_id"),
		externalBotId: text("external_bot_id"),
		externalBotUsername: text("external_bot_username"),
		externalDisplayName: text("external_display_name"),
		externalSpaceId: text("external_space_id"),
		externalSpaceName: text("external_space_name"),
		receiverScope: text("receiver_scope"),
		spaceClaimId: uuid("space_claim_id"),
		botClaimId: uuid("bot_claim_id"),
		activeCredentialRevisionId: uuid("active_credential_revision_id"),
		legacyTable: text("legacy_table").$type<ChatLegacyTableName>(),
		legacyRecordId: uuid("legacy_record_id"),
		legacyStatus: text("legacy_status"),
		remediationReason: text("remediation_reason").$type<ChatRemediationReason>(),
		remediationDetails: jsonb("remediation_details").$type<ChatRemediationDetails>(),
		verificationState: text("verification_state")
			.$type<ChatVerificationState>()
			.default("unverified")
			.notNull(),
		verificationEvidence: jsonb("verification_evidence").$type<ChatVerificationEvidence>(),
		lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
		retirementDeadlineAt: timestamp("retirement_deadline_at", { withTimezone: true }),
		retiredAt: timestamp("retired_at", { withTimezone: true }),
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
		endpointGeneration: integer("endpoint_generation").default(0).notNull(),
		endpointState: text("endpoint_state")
			.$type<ChatInstallationEndpointState>()
			.default("synced")
			.notNull(),
		createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		unique("chatInstallation_id_organizationId_unique").on(table.id, table.organizationId),
		uniqueIndex("chatInstallation_routeId_unique_idx").on(table.routeId),
		uniqueIndex("chatInstallation_org_provider_active_unique_idx")
			.on(table.organizationId, table.provider)
			.where(sql`${table.status} = 'active'`),
		uniqueIndex("chatInstallation_org_legacy_record_unique_idx")
			.on(table.organizationId, table.legacyTable, table.legacyRecordId)
			.where(sql`${table.legacyTable} IS NOT NULL AND ${table.legacyRecordId} IS NOT NULL`),
		index("chatInstallation_org_provider_status_idx").on(
			table.organizationId,
			table.provider,
			table.status,
		),
		index("chatInstallation_spaceClaimId_idx").on(table.spaceClaimId),
		index("chatInstallation_botClaimId_idx").on(table.botClaimId),
		foreignKey({
			name: "chat_installation_space_claim_fk",
			columns: [table.spaceClaimId, table.organizationId],
			foreignColumns: [chatExternalOwnershipClaim.id, chatExternalOwnershipClaim.organizationId],
		}),
		foreignKey({
			name: "chat_installation_bot_claim_fk",
			columns: [table.botClaimId, table.organizationId],
			foreignColumns: [chatExternalOwnershipClaim.id, chatExternalOwnershipClaim.organizationId],
		}),
		check(
			"chat_installation_provider_check",
			sql`${table.provider} IN ('slack', 'teams', 'telegram', 'discord')`,
		),
		check(
			"chat_installation_credential_source_check",
			sql`${table.credentialSource} IN ('organization_owned', 'deployment_managed')`,
		),
		check(
			"chat_installation_status_check",
			sql`${table.status} IN ('candidate', 'active', 'legacy_active', 'retiring', 'retired', 'revoked', 'remediation_required')`,
		),
		check(
			"chat_installation_verification_state_check",
			sql`${table.verificationState} IN ('unverified', 'pending', 'verified', 'failed', 'expired')`,
		),
		check(
			"chat_installation_legacy_table_check",
			sql`${table.legacyTable} IS NULL OR ${table.legacyTable} IN ('slack_workspace_config', 'teams_tenant_config', 'telegram_bot_config', 'discord_bot_config')`,
		),
		check(
			"chat_installation_legacy_pair_check",
			sql`(${table.legacyTable} IS NULL) = (${table.legacyRecordId} IS NULL)`,
		),
		check(
			"chat_installation_remediation_reason_check",
			sql`${table.remediationReason} IS NULL OR ${table.remediationReason} IN ('duplicate_external_identity', 'unknown_bot_identity', 'unexpected_legacy_status', 'secret_store_unavailable')`,
		),
		check("chat_installation_endpoint_generation_check", sql`${table.endpointGeneration} >= 0`),
		check(
			"chat_installation_endpoint_state_check",
			sql`${table.endpointState} IN ('synced', 'uncertain', 'removed')`,
		),
		check("chat_installation_route_id_check", sql`length(btrim(${table.routeId})) > 0`),
	],
);

/**
 * Per (organization, provider) effective settings record.
 * Becomes authoritative at the first atomic switch; before then, legacy rows
 * retain their effective settings and traffic.
 */
export const chatProviderSettings = pgTable(
	"chat_provider_settings",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		provider: text("provider").$type<ChatInstallationProvider>().notNull(),
		isAuthoritative: boolean("is_authoritative").default(false).notNull(),
		activeInstallationId: uuid("active_installation_id"),
		enableApprovals: boolean("enable_approvals").default(true).notNull(),
		enableCommands: boolean("enable_commands").default(true).notNull(),
		enableDailyDigest: boolean("enable_daily_digest").default(true).notNull(),
		enableEscalations: boolean("enable_escalations").default(true).notNull(),
		digestTime: text("digest_time").default("08:00").notNull(),
		digestTimezone: text("digest_timezone").default("UTC").notNull(),
		escalationTimeoutHours: integer("escalation_timeout_hours").default(24).notNull(),
		confirmedByUserId: text("confirmed_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		uniqueIndex("chatProviderSettings_org_provider_unique_idx").on(
			table.organizationId,
			table.provider,
		),
		foreignKey({
			name: "chat_provider_settings_active_installation_fk",
			columns: [table.activeInstallationId, table.organizationId],
			foreignColumns: [chatInstallation.id, chatInstallation.organizationId],
		}),
		check(
			"chat_provider_settings_provider_check",
			sql`${table.provider} IN ('slack', 'teams', 'telegram', 'discord')`,
		),
		check(
			"chat_provider_settings_escalation_timeout_check",
			sql`${table.escalationTimeoutHours} >= 1`,
		),
	],
);

/**
 * Immutable organization-scoped credential revision references stored in Vault or Scaleway.
 * Raw secrets are never stored in PostgreSQL; only key prefixes and key names are persisted.
 */
export const chatInstallationCredentialRevision = pgTable(
	"chat_installation_credential_revision",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		installationId: uuid("installation_id").notNull(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		revisionNumber: integer("revision_number").notNull(),
		secretStoreProvider: secretStoreProviderEnum("secret_store_provider").notNull(),
		secretKeyPrefix: text("secret_key_prefix").notNull(),
		secretKeys: jsonb("secret_keys").$type<string[]>().notNull(),
		status: text("status").$type<ChatCredentialRevisionStatus>().default("staged").notNull(),
		externalIdentityFingerprint: text("external_identity_fingerprint"),
		verifiedAt: timestamp("verified_at", { withTimezone: true }),
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
		createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		unique("chatInstallationCredentialRevision_id_inst_org_unique").on(
			table.id,
			table.installationId,
			table.organizationId,
		),
		uniqueIndex("chatInstallationCredentialRevision_inst_rev_unique_idx").on(
			table.installationId,
			table.revisionNumber,
		),
		index("chatInstallationCredentialRevision_org_inst_idx").on(
			table.organizationId,
			table.installationId,
		),
		foreignKey({
			name: "chat_installation_credential_revision_installation_fk",
			columns: [table.installationId, table.organizationId],
			foreignColumns: [chatInstallation.id, chatInstallation.organizationId],
		}).onDelete("cascade"),
		check("chat_installation_credential_revision_number_check", sql`${table.revisionNumber} >= 1`),
		check(
			"chat_installation_credential_revision_status_check",
			sql`${table.status} IN ('staged', 'verified', 'active', 'superseded', 'revoked', 'cleanup_pending', 'cleaned_up')`,
		),
	],
);

/**
 * Installation-scoped conversation and reachability records.
 * Scoped by installation_id so an existing installation and its staged or retiring
 * replacement address conversations independently for the same user and organization.
 */
export const chatInstallationConversation = pgTable(
	"chat_installation_conversation",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		installationId: uuid("installation_id").notNull(),
		userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id"),
		externalUserId: text("external_user_id"),
		externalConversationId: text("external_conversation_id").notNull(),
		conversationType: text("conversation_type").default("private").notNull(),
		conversationReference: jsonb("conversation_reference").$type<Record<string, unknown>>(),
		reachabilityStatus: text("reachability_status")
			.$type<ChatConversationReachabilityStatus>()
			.default("unknown")
			.notNull(),
		reachabilityReason: text("reachability_reason"),
		verifiedAt: timestamp("verified_at", { withTimezone: true }),
		lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
		isActive: boolean("is_active").default(true).notNull(),
		legacyRecordId: uuid("legacy_record_id"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		uniqueIndex("chatInstallationConversation_inst_user_type_unique_idx")
			.on(table.installationId, table.userId, table.conversationType)
			.where(sql`${table.userId} IS NOT NULL`),
		uniqueIndex("chatInstallationConversation_inst_ext_conv_unique_idx").on(
			table.installationId,
			table.externalConversationId,
		),
		index("chatInstallationConversation_org_inst_idx").on(
			table.organizationId,
			table.installationId,
		),
		index("chatInstallationConversation_org_user_idx").on(table.organizationId, table.userId),
		foreignKey({
			name: "chat_installation_conversation_installation_fk",
			columns: [table.installationId, table.organizationId],
			foreignColumns: [chatInstallation.id, chatInstallation.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "chat_installation_conversation_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}),
		check(
			"chat_installation_conversation_reachability_check",
			sql`${table.reachabilityStatus} IN ('unknown', 'reachable', 'action_needed', 'unreachable')`,
		),
	],
);

/**
 * Additive-default rollout control for organization-owned chat app switches.
 * No rows are inserted by migration: missing row = switch disabled (legacy default).
 */
export const chatInstallationSwitchControl = pgTable(
	"chat_installation_switch_control",
	{
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		provider: text("provider").$type<ChatInstallationProvider>().notNull(),
		enabledAt: timestamp("enabled_at", { withTimezone: true }).defaultNow().notNull(),
		enabledByUserId: text("enabled_by_user_id").references(() => user.id, { onDelete: "set null" }),
		notes: text("notes"),
	},
	(table) => [
		primaryKey({
			name: "chat_installation_switch_control_pk",
			columns: [table.organizationId, table.provider],
		}),
		check(
			"chat_installation_switch_control_provider_check",
			sql`${table.provider} IN ('slack', 'teams', 'telegram', 'discord')`,
		),
	],
);
