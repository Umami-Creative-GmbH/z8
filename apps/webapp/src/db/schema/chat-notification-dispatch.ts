import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
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
// DURABLE CHAT NOTIFICATION DISPATCH LEDGER (#2037 / #2044)
// ============================================

export const CHAT_NOTIFICATION_DISPATCH_SOURCE_KINDS = [
	"persistent_notification",
	"telegram_digest",
] as const;
export type ChatNotificationDispatchSourceKind =
	(typeof CHAT_NOTIFICATION_DISPATCH_SOURCE_KINDS)[number];

export const CHAT_NOTIFICATION_DISPATCH_STATUSES = [
	"intent_recorded",
	"confirmed_unsent",
	"sent",
	"reconciliation_required",
	"closed_unknown",
] as const;
export type ChatNotificationDispatchStatus = (typeof CHAT_NOTIFICATION_DISPATCH_STATUSES)[number];

export const CHAT_NOTIFICATION_DISPATCH_FAILURE_CLASSIFICATIONS = [
	"confirmed_unsent",
	"ambiguous",
	"worker_lost",
	"provider_error",
] as const;
export type ChatNotificationDispatchFailureClassification =
	(typeof CHAT_NOTIFICATION_DISPATCH_FAILURE_CLASSIFICATIONS)[number];

/**
 * Strictly redacted operational diagnostics persisted on durable chat dispatch attempts.
 * MUST NEVER contain raw bot tokens, signing secrets, webhook secrets, authorization headers,
 * credentials, or notification message bodies.
 */
export interface ChatNotificationDispatchRedactedDiagnostics {
	reason?: string | null;
	errorCode?: string | null;
	errorName?: string | null;
	httpStatus?: number | null;
	switchedFromInstallationId?: string | null;
	activeInstallationIdAtCheck?: string | null;
	installationStatusAtIntent?: string | null;
	receiverScope?: string | null;
	legacyRecordId?: string | null;
	closedReason?: string | null;
}

/**
 * Durable dispatch ledger for persistent chat notifications (and reusable by Telegram's
 * durable digest path in #2047).
 *
 * Enforces:
 * - Recording selected installation, credential revision, and dispatch intent BEFORE any
 *   external provider API call.
 * - At most one active/blocking attempt (`intent_recorded`, `sent`, `reconciliation_required`,
 *   or `closed_unknown`) per `(organization_id, dedupe_key)` in PostgreSQL. Only attempts
 *   explicitly marked `confirmed_unsent` allow a new attempt to reroute under the same
 *   dedupe key.
 */
export const chatNotificationDispatchAttempt = pgTable(
	"chat_notification_dispatch_attempt",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		provider: text("provider").$type<ChatInstallationProvider>().notNull(),
		sourceKind: text("source_kind").$type<ChatNotificationDispatchSourceKind>().notNull(),
		sourceRefId: text("source_ref_id").notNull(),
		dedupeKey: text("dedupe_key").notNull(),
		installationId: uuid("installation_id").references(() => chatInstallation.id, {
			onDelete: "set null",
		}),
		credentialRevisionId: uuid("credential_revision_id").references(
			() => chatInstallationCredentialRevision.id,
			{ onDelete: "set null" },
		),
		status: text("status").$type<ChatNotificationDispatchStatus>().notNull(),
		attemptNumber: integer("attempt_number").default(1).notNull(),
		intentRecordedAt: timestamp("intent_recorded_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		providerCalledAt: timestamp("provider_called_at", { withTimezone: true }),
		completedAt: timestamp("completed_at", { withTimezone: true }),
		reconciliationRequiredAt: timestamp("reconciliation_required_at", { withTimezone: true }),
		unknownClosedAt: timestamp("unknown_closed_at", { withTimezone: true }),
		failureClassification:
			text("failure_classification").$type<ChatNotificationDispatchFailureClassification>(),
		redactedDiagnostics:
			jsonb("redacted_diagnostics").$type<ChatNotificationDispatchRedactedDiagnostics>(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		uniqueIndex("chatNotificationDispatchAttempt_org_dedupe_attempt_unique_idx").on(
			table.organizationId,
			table.dedupeKey,
			table.attemptNumber,
		),
		uniqueIndex("chatNotificationDispatchAttempt_org_dedupe_active_unique_idx")
			.on(table.organizationId, table.dedupeKey)
			.where(
				sql`${table.status} IN ('intent_recorded', 'sent', 'reconciliation_required', 'closed_unknown')`,
			),
		index("chatNotificationDispatchAttempt_org_dedupe_idx").on(
			table.organizationId,
			table.dedupeKey,
		),
		index("chatNotificationDispatchAttempt_org_provider_status_idx").on(
			table.organizationId,
			table.provider,
			table.status,
		),
		index("chatNotificationDispatchAttempt_status_reconciliation_at_idx").on(
			table.status,
			table.reconciliationRequiredAt,
		),
		index("chatNotificationDispatchAttempt_org_inst_status_idx").on(
			table.organizationId,
			table.installationId,
			table.status,
		),
		check(
			"chat_notification_dispatch_attempt_provider_check",
			sql`${table.provider} IN ('slack', 'teams', 'telegram', 'discord')`,
		),
		check(
			"chat_notification_dispatch_attempt_source_kind_check",
			sql`${table.sourceKind} IN ('persistent_notification', 'telegram_digest')`,
		),
		check(
			"chat_notification_dispatch_attempt_status_check",
			sql`${table.status} IN ('intent_recorded', 'confirmed_unsent', 'sent', 'reconciliation_required', 'closed_unknown')`,
		),
		check(
			"chat_notification_dispatch_attempt_failure_classification_check",
			sql`${table.failureClassification} IS NULL OR ${table.failureClassification} IN ('confirmed_unsent', 'ambiguous', 'worker_lost', 'provider_error')`,
		),
		check("chat_notification_dispatch_attempt_number_check", sql`${table.attemptNumber} >= 1`),
		check(
			"chat_notification_dispatch_attempt_source_ref_id_check",
			sql`length(btrim(${table.sourceRefId})) > 0`,
		),
		check(
			"chat_notification_dispatch_attempt_dedupe_key_check",
			sql`length(btrim(${table.dedupeKey})) > 0`,
		),
		check(
			"chat_notification_dispatch_attempt_closed_unknown_at_check",
			sql`${table.status} <> 'closed_unknown' OR ${table.unknownClosedAt} IS NOT NULL`,
		),
	],
);
