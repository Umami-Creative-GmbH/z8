import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	foreignKey,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "../auth-schema";
import { chatInstallation } from "./chat-installations";
import { employee } from "./organization";
import { currentTimestamp } from "./timestamp";

// ============================================
// CHAT INSTALLATION LINK PROOFS & MEMBER LINKS (#2042 / #2037)
// ============================================

export const CHAT_LINK_PROOF_PURPOSES = ["member_link", "candidate_enrollment"] as const;
export type ChatLinkProofPurpose = (typeof CHAT_LINK_PROOF_PURPOSES)[number];

export const CHAT_MEMBER_LINK_PROVENANCES = [
	"link_proof",
	"verified_same_scope_reuse",
	"legacy_backfill",
] as const;
export type ChatMemberLinkProvenance = (typeof CHAT_MEMBER_LINK_PROVENANCES)[number];

/**
 * Short-lived, single-use, purpose-bound link proofs scoped to an organization,
 * chat installation, purpose, and eligible employee.
 * Only the SHA-256 digest of the normalized code is persisted; raw codes are never stored.
 */
export const chatInstallationLinkProof = pgTable(
	"chat_installation_link_proof",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		installationId: uuid("installation_id").notNull(),
		purpose: text("purpose").$type<ChatLinkProofPurpose>().notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		codeDigest: text("code_digest").notNull(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		consumedAt: timestamp("consumed_at", { withTimezone: true }),
		consumedByExternalUserId: text("consumed_by_external_user_id"),
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
		attemptCount: integer("attempt_count").default(0).notNull(),
		lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
		rateLimitWindowStart: timestamp("rate_limit_window_start", { withTimezone: true })
			.defaultNow()
			.notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("chatInstallationLinkProof_inst_purpose_digest_unique_idx").on(
			table.installationId,
			table.purpose,
			table.codeDigest,
		),
		index("chatInstallationLinkProof_org_inst_user_purpose_idx").on(
			table.organizationId,
			table.installationId,
			table.userId,
			table.purpose,
			table.createdAt,
		),
		index("chatInstallationLinkProof_org_inst_expires_idx").on(
			table.organizationId,
			table.installationId,
			table.expiresAt,
		),
		foreignKey({
			name: "chat_installation_link_proof_installation_fk",
			columns: [table.installationId, table.organizationId],
			foreignColumns: [chatInstallation.id, chatInstallation.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "chat_installation_link_proof_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		check(
			"chat_installation_link_proof_purpose_check",
			sql`${table.purpose} IN ('member_link', 'candidate_enrollment')`,
		),
		check("chat_installation_link_proof_digest_check", sql`length(${table.codeDigest}) = 64`),
		check("chat_installation_link_proof_attempt_count_check", sql`${table.attemptCount} >= 0`),
	],
);

/**
 * Per-(organization, installation, purpose, actor) rate-limit window counters
 * for both proof issuance and failed redemption guesses (including unknown codes).
 */
export const chatInstallationLinkAttempt = pgTable(
	"chat_installation_link_attempt",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		installationId: uuid("installation_id").notNull(),
		purpose: text("purpose").$type<ChatLinkProofPurpose>().notNull(),
		actorKey: text("actor_key").notNull(),
		attemptCount: integer("attempt_count").default(0).notNull(),
		rateLimitWindowStart: timestamp("rate_limit_window_start", { withTimezone: true })
			.defaultNow()
			.notNull(),
		lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("chatInstallationLinkAttempt_org_inst_purpose_actor_unique_idx").on(
			table.organizationId,
			table.installationId,
			table.purpose,
			table.actorKey,
		),
		foreignKey({
			name: "chat_installation_link_attempt_installation_fk",
			columns: [table.installationId, table.organizationId],
			foreignColumns: [chatInstallation.id, chatInstallation.organizationId],
		}).onDelete("cascade"),
		check(
			"chat_installation_link_attempt_purpose_check",
			sql`${table.purpose} IN ('member_link', 'candidate_enrollment')`,
		),
		check(
			"chat_installation_link_attempt_actor_key_check",
			sql`length(btrim(${table.actorKey})) > 0`,
		),
		check("chat_installation_link_attempt_count_check", sql`${table.attemptCount} >= 0`),
	],
);

/**
 * Installation-scoped employee chat identity links.
 * Segregates candidate enrollment (`is_candidate_enrollment = true`) from live employee links
 * and records the exact verified external scope so identity reuse never crosses orgs, workspaces,
 * tenants, or bots.
 */
export const chatInstallationMemberLink = pgTable(
	"chat_installation_member_link",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		installationId: uuid("installation_id").notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id"),
		externalUserId: text("external_user_id").notNull(),
		externalUsername: text("external_username"),
		externalDisplayName: text("external_display_name"),
		externalScope: text("external_scope").notNull(),
		provenance: text("provenance").$type<ChatMemberLinkProvenance>().notNull(),
		isCandidateEnrollment: boolean("is_candidate_enrollment").default(false).notNull(),
		isActive: boolean("is_active").default(true).notNull(),
		verifiedAt: timestamp("verified_at", { withTimezone: true }).defaultNow().notNull(),
		unlinkedAt: timestamp("unlinked_at", { withTimezone: true }),
		lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		uniqueIndex("chatInstallationMemberLink_inst_user_lane_active_unique_idx")
			.on(table.installationId, table.userId, table.isCandidateEnrollment)
			.where(sql`${table.isActive} = true`),
		uniqueIndex("chatInstallationMemberLink_inst_ext_user_lane_active_unique_idx")
			.on(table.installationId, table.externalUserId, table.isCandidateEnrollment)
			.where(sql`${table.isActive} = true`),
		index("chatInstallationMemberLink_org_inst_lane_active_idx").on(
			table.organizationId,
			table.installationId,
			table.isCandidateEnrollment,
			table.isActive,
		),
		index("chatInstallationMemberLink_org_user_lane_active_idx").on(
			table.organizationId,
			table.userId,
			table.isCandidateEnrollment,
			table.isActive,
		),
		index("chatInstallationMemberLink_org_scope_user_idx").on(
			table.organizationId,
			table.externalScope,
			table.userId,
		),
		foreignKey({
			name: "chat_installation_member_link_installation_fk",
			columns: [table.installationId, table.organizationId],
			foreignColumns: [chatInstallation.id, chatInstallation.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "chat_installation_member_link_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}),
		check(
			"chat_installation_member_link_provenance_check",
			sql`${table.provenance} IN ('link_proof', 'verified_same_scope_reuse', 'legacy_backfill')`,
		),
		check(
			"chat_installation_member_link_external_user_id_check",
			sql`length(btrim(${table.externalUserId})) > 0`,
		),
		check(
			"chat_installation_member_link_external_scope_check",
			sql`length(btrim(${table.externalScope})) > 0`,
		),
	],
);
