import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, session, user } from "../auth-schema";

export const organizationMfaPolicy = pgTable(
	"organization_mfa_policy",
	{
		organizationId: text("organization_id")
			.primaryKey()
			.references(() => organization.id, { onDelete: "cascade" }),
		enabled: boolean("enabled").notNull().default(false),
		gracePeriodDays: integer("grace_period_days").notNull().default(14),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedBy: text("updated_by")
			.notNull()
			.references(() => user.id),
	},
	(t) => [
		check(
			"organization_mfa_grace_check",
			sql`${t.gracePeriodDays} IN (0,7,14,30)`,
		),
	],
);

/** Survives membership deletion. The activation event freezes the first applicable start/window.
 * Temporal materializes its absolute deadline before any decision or notice is returned. */
export const organizationMfaWindow = pgTable(
	"organization_mfa_window",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
		gracePeriodDays: integer("grace_period_days").notNull(),
		deadline: timestamp("deadline", { withTimezone: true }),
		lastQualifyingAccessAt: timestamp("last_qualifying_access_at", {
			withTimezone: true,
		}),
	},
	(t) => [
		uniqueIndex("organization_mfa_window_identity_idx").on(
			t.organizationId,
			t.userId,
		),
		index("organization_mfa_window_org_idx").on(t.organizationId),
		index("organization_mfa_window_user_idx").on(t.userId),
		check(
			"organization_mfa_window_grace_check",
			sql`${t.gracePeriodDays} IN (0,7,14,30)`,
		),
	],
);

export const sessionMfaProof = pgTable(
	"session_mfa_proof",
	{
		sessionId: text("session_id")
			.primaryKey()
			.references(() => session.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		revision: integer("revision").notNull(),
		method: text("method").notNull().$type<"totp" | "passkey">(),
		factorId: text("factor_id").notNull(),
		factorFingerprint: text("factor_fingerprint").notNull(),
		verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
	},
	(t) => [
		index("session_mfa_proof_user_idx").on(t.userId),
		check(
			"session_mfa_proof_method_check",
			sql`${t.method} IN ('totp','passkey')`,
		),
	],
);

/** Authentication freshness is distinct from local MFA qualification. */
export const sessionAuthentication = pgTable("session_authentication", {
	sessionId: text("session_id")
		.primaryKey()
		.references(() => session.id, { onDelete: "cascade" }),
	userId: text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	revision: integer("revision").notNull(),
	method: text("method").notNull().$type<"password" | "social" | "recovery">(),
	verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
});

export const organizationMfaNotice = pgTable(
	"organization_mfa_notice",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		deduplicationKey: text("deduplication_key").notNull(),
		kind: text("kind")
			.notNull()
			.$type<"assigned" | "three-days" | "one-day" | "security">(),
		dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
		payload: jsonb("payload")
			.notNull()
			.$type<{ deadline?: string; event?: string }>(),
		sentAt: timestamp("sent_at", { withTimezone: true }),
	},
	(t) => [
		uniqueIndex("organization_mfa_notice_identity_idx").on(
			t.organizationId,
			t.deduplicationKey,
		),
		index("organization_mfa_notice_due_idx").on(t.dueAt),
	],
);

/** Deduplication follows changes in outcomes, rather than suppressing all later denials. */
export const organizationMfaAccessOutcome = pgTable(
	"organization_mfa_access_outcome",
	{
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		sessionId: text("session_id")
			.notNull()
			.references(() => session.id, { onDelete: "cascade" }),
		outcome: text("outcome").notNull(),
	},
	(t) => [primaryKey({ columns: [t.organizationId, t.sessionId] })],
);

export const userMfaRevision = pgTable("user_mfa_revision", {
	userId: text("user_id")
		.primaryKey()
		.references(() => user.id, { onDelete: "cascade" }),
	revision: integer("revision").notNull().default(0),
});
