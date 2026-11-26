import { sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { organization } from "../auth-schema";
import {
	type ChatInstallationProvider,
	chatInstallation,
	chatInstallationCredentialRevision,
} from "./chat-installations";
import { currentTimestamp } from "./timestamp";

// ============================================
// CHAT INSTALLATION ASYNC CLEANUP QUEUE (#2037 / #2046)
// ============================================

export const CHAT_INSTALLATION_CLEANUP_JOB_KINDS = [
	"credential_revision_cleanup",
	"provider_endpoint_cleanup",
] as const;
export type ChatInstallationCleanupJobKind = (typeof CHAT_INSTALLATION_CLEANUP_JOB_KINDS)[number];

export const CHAT_INSTALLATION_CLEANUP_JOB_STATUSES = [
	"pending",
	"processing",
	"completed",
	"skipped_stale_generation",
	"exhausted",
] as const;
export type ChatInstallationCleanupJobStatus =
	(typeof CHAT_INSTALLATION_CLEANUP_JOB_STATUSES)[number];

/**
 * Strictly redacted operational diagnostics for async credential and endpoint cleanup jobs.
 * MUST NEVER store raw tokens, signing secrets, webhook secrets, or authorization headers.
 */
export interface ChatInstallationCleanupRedactedDiagnostics {
	reason?: string | null;
	errorCode?: string | null;
	errorName?: string | null;
	httpStatus?: number | null;
	timedOut?: boolean;
	deletedKeys?: string[];
	failedKeys?: string[];
	observedGeneration?: number | null;
	observedStatus?: string | null;
	endpointReconciliationRequired?: boolean;
}

/**
 * Durable asynchronous retryable cleanup queue for:
 * 1) `credential_revision_cleanup`: deleting unreferenced org-owned secret revisions from Vault/Scaleway.
 * 2) `provider_endpoint_cleanup`: tearing down provider endpoints fenced by `authorized_generation`
 *    and serialized by `stable_bot_key` so stale delayed cleanup never mutates a reactivated bot.
 */
export const chatInstallationCleanupJob = pgTable(
	"chat_installation_cleanup_job",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		installationId: uuid("installation_id").notNull(),
		provider: text("provider").$type<ChatInstallationProvider>().notNull(),
		stableBotKey: text("stable_bot_key").notNull(),
		kind: text("kind").$type<ChatInstallationCleanupJobKind>().notNull(),
		credentialRevisionId: uuid("credential_revision_id").references(
			() => chatInstallationCredentialRevision.id,
			{ onDelete: "set null" },
		),
		authorizedGeneration: integer("authorized_generation").notNull(),
		status: text("status").$type<ChatInstallationCleanupJobStatus>().default("pending").notNull(),
		attemptCount: integer("attempt_count").default(0).notNull(),
		maxAttempts: integer("max_attempts").default(5).notNull(),
		nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).defaultNow().notNull(),
		lastErrorCode: text("last_error_code"),
		redactedDiagnostics:
			jsonb("redacted_diagnostics").$type<ChatInstallationCleanupRedactedDiagnostics>(),
		completedAt: timestamp("completed_at", { withTimezone: true }),
		exhaustedAt: timestamp("exhausted_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		foreignKey({
			name: "chat_installation_cleanup_job_installation_fk",
			columns: [table.installationId, table.organizationId],
			foreignColumns: [chatInstallation.id, chatInstallation.organizationId],
		}).onDelete("cascade"),
		index("chatInstallationCleanupJob_due_idx")
			.on(table.status, table.nextAttemptAt)
			.where(sql`${table.status} IN ('pending', 'processing')`),
		index("chatInstallationCleanupJob_org_inst_idx").on(
			table.organizationId,
			table.installationId,
			table.kind,
			table.status,
		),
		index("chatInstallationCleanupJob_stable_bot_key_idx").on(table.stableBotKey, table.status),
		check(
			"chat_installation_cleanup_job_provider_check",
			sql`${table.provider} IN ('slack', 'teams', 'telegram', 'discord')`,
		),
		check(
			"chat_installation_cleanup_job_kind_check",
			sql`${table.kind} IN ('credential_revision_cleanup', 'provider_endpoint_cleanup')`,
		),
		check(
			"chat_installation_cleanup_job_status_check",
			sql`${table.status} IN ('pending', 'processing', 'completed', 'skipped_stale_generation', 'exhausted')`,
		),
		check(
			"chat_installation_cleanup_job_authorized_generation_check",
			sql`${table.authorizedGeneration} >= 0`,
		),
		check(
			"chat_installation_cleanup_job_attempts_check",
			sql`${table.attemptCount} >= 0 AND ${table.maxAttempts} >= 1`,
		),
		check(
			"chat_installation_cleanup_job_stable_bot_key_check",
			sql`length(btrim(${table.stableBotKey})) > 0`,
		),
	],
);
