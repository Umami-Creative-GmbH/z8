import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	date,
	foreignKey,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "../auth-schema";
import { employee } from "./organization";
import { currentTimestamp } from "./timestamp";

type JsonObject = Record<string, unknown>;

// Text checks instead of PostgreSQL enums so new values never need an enum
// migration that is unusable inside the transaction that adds it.
export const employmentPeriodStatuses = ["open", "closed", "legacy_unknown"] as const;
export const employmentPeriodStartProvenances = ["recorded", "legacy", "unknown"] as const;
export const departureModes = ["scheduled", "immediate"] as const;
export const departureStatuses = ["pending", "canceled", "blocked", "effective"] as const;
export const departureEventKinds = [
	"departure_scheduled",
	"departure_rescheduled",
	"departure_canceled",
	"departure_superseded",
	"departure_blocked",
	"departure_effective",
	"employee_rehired",
	"review_resolved",
	"task_failed",
	"replacement_assigned",
	// Employment history of a deactivation without a departure (#1440, #1441).
	"employee_deactivated",
	"employee_reactivated",
] as const;
/** Audit reason a deactivation row was written under (#1440, #1442). */
export const deactivationReasons = [
	"employee_deactivated",
	"employee_deactivation_backfill",
] as const;
export const departureTaskKinds = [
	"dispatch_departure",
	"session_revocation",
	"billing_sync",
	"clock_postprocess",
	"notify_review",
	"clock_repair",
	"approval_handover",
	// One cleared deputy assignment to notify about (#1014).
	"notify_deputy_release",
	// Download your personal data before the cutoff, once per cutoff (#1173).
	"notify_data_export_reminder",
] as const;
export const departureTaskStatuses = ["pending", "processing", "completed", "failed"] as const;
export const departureReviewKinds = [
	"clock_out",
	"clock_repair",
	"approval_handover",
	"future_work",
	"employment_terms",
] as const;
export const departureReviewStatuses = ["open", "resolved"] as const;

export type EmploymentPeriodStatus = (typeof employmentPeriodStatuses)[number];
export type EmploymentPeriodStartProvenance = (typeof employmentPeriodStartProvenances)[number];
export type DepartureEventKind = (typeof departureEventKinds)[number];
export type DepartureTaskKind = (typeof departureTaskKinds)[number];
export type DepartureTaskStatus = (typeof departureTaskStatuses)[number];
export type DepartureReviewKind = (typeof departureReviewKinds)[number];

function textIn(column: string, values: readonly string[]) {
	return sql.raw(`${column} IN (${values.map((value) => `'${value}'`).join(", ")})`);
}

/**
 * A stint of employment. Terms history rows belong to a period; editing terms
 * never creates a new period. Intervals are half-open: [started_at, ended_at).
 */
export const employeeEmploymentPeriod = pgTable(
	"employee_employment_period",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		status: text("status").$type<EmploymentPeriodStatus>().notNull(),
		startedAt: timestamp("started_at", { withTimezone: true }),
		endedAt: timestamp("ended_at", { withTimezone: true }),
		startProvenance: text("start_provenance").$type<EmploymentPeriodStartProvenance>().notNull(),
		/** Why a legacy period could not be classified from existing dates. */
		legacyDiagnostic: text("legacy_diagnostic"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		createdBy: text("created_by").references(() => user.id, {
			onDelete: "set null",
		}),
	},
	(table) => [
		unique("employeeEmploymentPeriod_id_org_unique").on(table.id, table.organizationId),
		unique("employeeEmploymentPeriod_id_org_employee_unique").on(
			table.id,
			table.organizationId,
			table.employeeId,
		),
		uniqueIndex("employeeEmploymentPeriod_one_open_idx")
			.on(table.organizationId, table.employeeId)
			.where(sql`status = 'open'`),
		index("employeeEmploymentPeriod_employee_idx").on(table.organizationId, table.employeeId),
		foreignKey({
			name: "employeeEmploymentPeriod_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		check("employeeEmploymentPeriod_status_check", textIn("status", employmentPeriodStatuses)),
		check(
			"employeeEmploymentPeriod_start_provenance_check",
			textIn("start_provenance", employmentPeriodStartProvenances),
		),
		check(
			"employeeEmploymentPeriod_unknown_start_check",
			sql`(start_provenance = 'unknown') = (started_at IS NULL)`,
		),
		check(
			"employeeEmploymentPeriod_interval_check",
			sql`started_at IS NULL OR ended_at IS NULL OR ended_at >= started_at`,
		),
		check(
			"employeeEmploymentPeriod_closed_end_check",
			sql`status <> 'closed' OR ended_at IS NOT NULL`,
		),
		check("employeeEmploymentPeriod_open_end_check", sql`status <> 'open' OR ended_at IS NULL`),
	],
);

/**
 * A departure ends one employment period at `cutoff_at`. Status is separate
 * from follow-up completion, which is tracked by tasks and reviews.
 */
export const employeeDeparture = pgTable(
	"employee_departure",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		employmentPeriodId: uuid("employment_period_id").notNull(),
		mode: text("mode").$type<(typeof departureModes)[number]>().notNull(),
		lastWorkingDay: date("last_working_day", { mode: "string" }),
		/** Zone frozen when the cutoff was calculated. */
		timezone: text("timezone").notNull(),
		cutoffAt: timestamp("cutoff_at", { withTimezone: true }).notNull(),
		replacementEmployeeId: uuid("replacement_employee_id"),
		acknowledgeUnassignedDuties: boolean("acknowledge_unassigned_duties").default(false).notNull(),
		revision: integer("revision").notNull(),
		status: text("status").$type<(typeof departureStatuses)[number]>().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		requestId: uuid("request_id").notNull(),
		requestFingerprint: text("request_fingerprint").notNull(),
		/** Allocated once so every retry closes the timer with the same action. */
		clockOutActionId: uuid("clock_out_action_id").defaultRandom().notNull(),
		effectiveAt: timestamp("effective_at", { withTimezone: true }),
		processedAt: timestamp("processed_at", { withTimezone: true }),
		blockedReason: text("blocked_reason"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		unique("employeeDeparture_id_org_unique").on(table.id, table.organizationId),
		unique("employeeDeparture_identity_unique").on(
			table.id,
			table.organizationId,
			table.employeeId,
			table.employmentPeriodId,
		),
		uniqueIndex("employeeDeparture_one_pending_idx")
			.on(table.organizationId, table.employeeId)
			.where(sql`status = 'pending'`),
		uniqueIndex("employeeDeparture_request_idx").on(table.organizationId, table.requestId),
		index("employeeDeparture_due_idx")
			.on(table.cutoffAt, table.organizationId, table.id)
			.where(sql`status = 'pending'`),
		index("employeeDeparture_employee_idx").on(table.organizationId, table.employeeId),
		foreignKey({
			name: "employeeDeparture_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "employeeDeparture_period_fk",
			columns: [table.employmentPeriodId, table.organizationId, table.employeeId],
			foreignColumns: [
				employeeEmploymentPeriod.id,
				employeeEmploymentPeriod.organizationId,
				employeeEmploymentPeriod.employeeId,
			],
		}).onDelete("cascade"),
		foreignKey({
			name: "employeeDeparture_replacement_fk",
			columns: [table.replacementEmployeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}),
		check("employeeDeparture_mode_check", textIn("mode", departureModes)),
		check("employeeDeparture_status_check", textIn("status", departureStatuses)),
		check("employeeDeparture_revision_check", sql`revision > 0`),
		check(
			"employeeDeparture_scheduled_day_check",
			sql`mode <> 'scheduled' OR last_working_day IS NOT NULL`,
		),
		check(
			"employeeDeparture_effective_at_check",
			sql`(status = 'effective') = (effective_at IS NOT NULL)`,
		),
		check(
			"employeeDeparture_blocked_reason_check",
			sql`status <> 'blocked' OR blocked_reason IS NOT NULL`,
		),
		check(
			"employeeDeparture_replacement_check",
			sql`replacement_employee_id IS NULL OR replacement_employee_id <> employee_id`,
		),
	],
);

/**
 * One deactivation of an employee (#1440, Organization ADR 0006): the
 * anchor of its approval handover tasks and reviews, the request-ID replay
 * ledger of the Deactivate command, the source of the reactivation checklist
 * (#1441, `applied`) and the backfill's idempotency marker (#1442). A
 * reactivation stamps `reactivated_at`; the row itself is never deleted.
 */
export const employeeDeactivation = pgTable(
	"employee_deactivation",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		/** The open or legacy period at deactivation; null when the employee had none. */
		employmentPeriodId: uuid("employment_period_id"),
		/** Equals the `employee.deactivated_at` the deactivation wrote. */
		deactivatedAt: timestamp("deactivated_at", { withTimezone: true }).notNull(),
		/** Audit evidence; not a foreign key so user deletion cannot rewrite history. */
		createdBy: text("created_by").notNull(),
		reason: text("reason").$type<(typeof deactivationReasons)[number]>().notNull(),
		requestId: uuid("request_id").notNull(),
		requestFingerprint: text("request_fingerprint").notNull(),
		/** What a replayed request returns. */
		result: jsonb("result").$type<JsonObject>(),
		/** Report employee id → replacement manager employee id, as submitted. */
		replacementManagers: jsonb("replacement_managers")
			.$type<Record<string, string>>()
			.default({})
			.notNull(),
		/** The consequences applied (`DeactivationApplied`). */
		applied: jsonb("applied").$type<JsonObject>(),
		reactivatedAt: timestamp("reactivated_at", { withTimezone: true }),
		reactivatedBy: text("reactivated_by"),
		reactivationRequestId: uuid("reactivation_request_id"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		unique("employeeDeactivation_id_org_employee_unique").on(
			table.id,
			table.organizationId,
			table.employeeId,
		),
		uniqueIndex("employeeDeactivation_request_idx").on(table.organizationId, table.requestId),
		index("employeeDeactivation_employee_idx").on(table.organizationId, table.employeeId),
		foreignKey({
			name: "employeeDeactivation_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "employeeDeactivation_period_fk",
			columns: [table.employmentPeriodId, table.organizationId, table.employeeId],
			foreignColumns: [
				employeeEmploymentPeriod.id,
				employeeEmploymentPeriod.organizationId,
				employeeEmploymentPeriod.employeeId,
			],
		}).onDelete("cascade"),
		check("employeeDeactivation_reason_check", textIn("reason", deactivationReasons)),
		check(
			"employeeDeactivation_reactivation_check",
			sql`reactivated_at IS NOT NULL OR (reactivated_by IS NULL AND reactivation_request_id IS NULL)`,
		),
	],
);

/**
 * Append-only audit and request receipts. Index 0 is the receipt for a
 * request; additional events from the same request use positive indices.
 */
export const employeeDepartureEvent = pgTable(
	"employee_departure_event",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		departureId: uuid("departure_id"),
		employmentPeriodId: uuid("employment_period_id").notNull(),
		requestId: uuid("request_id").notNull(),
		eventIndex: integer("event_index").default(0).notNull(),
		revision: integer("revision"),
		kind: text("kind").$type<DepartureEventKind>().notNull(),
		/** Audit evidence; not a foreign key so user deletion cannot rewrite history. */
		actorUserId: text("actor_user_id"),
		occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
		metadata: jsonb("metadata").$type<JsonObject>().default({}).notNull(),
		requestFingerprint: text("request_fingerprint"),
		result: jsonb("result").$type<JsonObject>(),
	},
	(table) => [
		uniqueIndex("employeeDepartureEvent_request_idx").on(
			table.organizationId,
			table.requestId,
			table.eventIndex,
		),
		index("employeeDepartureEvent_employee_idx").on(
			table.organizationId,
			table.employeeId,
			table.occurredAt,
		),
		foreignKey({
			name: "employeeDepartureEvent_period_fk",
			columns: [table.employmentPeriodId, table.organizationId, table.employeeId],
			foreignColumns: [
				employeeEmploymentPeriod.id,
				employeeEmploymentPeriod.organizationId,
				employeeEmploymentPeriod.employeeId,
			],
		}).onDelete("cascade"),
		foreignKey({
			name: "employeeDepartureEvent_departure_fk",
			columns: [
				table.departureId,
				table.organizationId,
				table.employeeId,
				table.employmentPeriodId,
			],
			foreignColumns: [
				employeeDeparture.id,
				employeeDeparture.organizationId,
				employeeDeparture.employeeId,
				employeeDeparture.employmentPeriodId,
			],
		}).onDelete("cascade"),
		check("employeeDepartureEvent_kind_check", textIn("kind", departureEventKinds)),
		check("employeeDepartureEvent_index_check", sql`event_index >= 0`),
	],
);

/** Durable follow-up work, claimed by workers with a lease token. */
export const employeeDepartureTask = pgTable(
	"employee_departure_task",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		employmentPeriodId: uuid("employment_period_id").notNull(),
		/** Null for rehire billing work, which does not belong to a departure. */
		departureId: uuid("departure_id"),
		/** Set instead of `departureId` for a deactivation's follow-up work (#1440). */
		deactivationId: uuid("deactivation_id"),
		kind: text("kind").$type<DepartureTaskKind>().notNull(),
		dedupeKey: text("dedupe_key").notNull(),
		payload: jsonb("payload").$type<JsonObject>().default({}).notNull(),
		status: text("status").$type<DepartureTaskStatus>().default("pending").notNull(),
		availableAt: timestamp("available_at", { withTimezone: true }).defaultNow().notNull(),
		claimToken: uuid("claim_token"),
		attemptCount: integer("attempt_count").default(0).notNull(),
		lastError: text("last_error"),
		completedAt: timestamp("completed_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		uniqueIndex("employeeDepartureTask_dedupe_idx").on(table.organizationId, table.dedupeKey),
		index("employeeDepartureTask_due_idx")
			.on(table.availableAt, table.id)
			.where(sql`status IN ('pending', 'processing')`),
		index("employeeDepartureTask_departure_idx").on(table.organizationId, table.departureId),
		index("employeeDepartureTask_deactivation_idx")
			.on(table.organizationId, table.deactivationId)
			.where(sql`deactivation_id IS NOT NULL`),
		foreignKey({
			name: "employeeDepartureTask_deactivation_fk",
			columns: [table.deactivationId, table.organizationId, table.employeeId],
			foreignColumns: [
				employeeDeactivation.id,
				employeeDeactivation.organizationId,
				employeeDeactivation.employeeId,
			],
		}).onDelete("cascade"),
		check(
			"employeeDepartureTask_one_anchor_check",
			sql`departure_id IS NULL OR deactivation_id IS NULL`,
		),
		foreignKey({
			name: "employeeDepartureTask_period_fk",
			columns: [table.employmentPeriodId, table.organizationId, table.employeeId],
			foreignColumns: [
				employeeEmploymentPeriod.id,
				employeeEmploymentPeriod.organizationId,
				employeeEmploymentPeriod.employeeId,
			],
		}).onDelete("cascade"),
		foreignKey({
			name: "employeeDepartureTask_departure_fk",
			columns: [
				table.departureId,
				table.organizationId,
				table.employeeId,
				table.employmentPeriodId,
			],
			foreignColumns: [
				employeeDeparture.id,
				employeeDeparture.organizationId,
				employeeDeparture.employeeId,
				employeeDeparture.employmentPeriodId,
			],
		}).onDelete("cascade"),
		check("employeeDepartureTask_kind_check", textIn("kind", departureTaskKinds)),
		check("employeeDepartureTask_status_check", textIn("status", departureTaskStatuses)),
		check("employeeDepartureTask_attempt_check", sql`attempt_count >= 0`),
	],
);

/**
 * Persistent human-resolution work linked to exactly one departure or one
 * deactivation (#1440).
 */
export const employeeDepartureReview = pgTable(
	"employee_departure_review",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		employmentPeriodId: uuid("employment_period_id").notNull(),
		departureId: uuid("departure_id"),
		deactivationId: uuid("deactivation_id"),
		kind: text("kind").$type<DepartureReviewKind>().notNull(),
		subjectId: uuid("subject_id"),
		status: text("status")
			.$type<(typeof departureReviewStatuses)[number]>()
			.default("open")
			.notNull(),
		metadata: jsonb("metadata").$type<JsonObject>().default({}).notNull(),
		resolvedBy: text("resolved_by").references(() => user.id, {
			onDelete: "set null",
		}),
		resolvedAt: timestamp("resolved_at", { withTimezone: true }),
		resolution: text("resolution"),
		affectedStartAt: timestamp("affected_start_at", { withTimezone: true }),
		affectedEndAt: timestamp("affected_end_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		// Exactly one anchor is set, so the other column is always NULL and
		// NULLS NOT DISTINCT keeps one review per anchor, kind and subject.
		unique("employeeDepartureReview_anchor_subject_unique")
			.on(
				table.organizationId,
				table.departureId,
				table.deactivationId,
				table.kind,
				table.subjectId,
			)
			.nullsNotDistinct(),
		index("employeeDepartureReview_open_idx")
			.on(table.organizationId, table.employeeId)
			.where(sql`status = 'open'`),
		index("employeeDepartureReview_deactivation_idx")
			.on(table.organizationId, table.deactivationId)
			.where(sql`deactivation_id IS NOT NULL`),
		foreignKey({
			name: "employeeDepartureReview_deactivation_fk",
			columns: [table.deactivationId, table.organizationId, table.employeeId],
			foreignColumns: [
				employeeDeactivation.id,
				employeeDeactivation.organizationId,
				employeeDeactivation.employeeId,
			],
		}).onDelete("cascade"),
		check(
			"employeeDepartureReview_one_anchor_check",
			sql`(departure_id IS NULL) <> (deactivation_id IS NULL)`,
		),
		foreignKey({
			name: "employeeDepartureReview_departure_fk",
			columns: [
				table.departureId,
				table.organizationId,
				table.employeeId,
				table.employmentPeriodId,
			],
			foreignColumns: [
				employeeDeparture.id,
				employeeDeparture.organizationId,
				employeeDeparture.employeeId,
				employeeDeparture.employmentPeriodId,
			],
		}).onDelete("cascade"),
		check("employeeDepartureReview_kind_check", textIn("kind", departureReviewKinds)),
		check("employeeDepartureReview_status_check", textIn("status", departureReviewStatuses)),
		check(
			"employeeDepartureReview_resolution_check",
			sql`(status = 'resolved') = (resolved_at IS NOT NULL)`,
		),
		check(
			"employeeDepartureReview_affected_range_check",
			sql`affected_start_at IS NULL OR affected_end_at IS NULL OR affected_end_at >= affected_start_at`,
		),
	],
);

export type EmployeeEmploymentPeriod = typeof employeeEmploymentPeriod.$inferSelect;
export type EmployeeDeparture = typeof employeeDeparture.$inferSelect;
export type EmployeeDeactivation = typeof employeeDeactivation.$inferSelect;
export type EmployeeDepartureEvent = typeof employeeDepartureEvent.$inferSelect;
export type EmployeeDepartureTask = typeof employeeDepartureTask.$inferSelect;
export type EmployeeDepartureReview = typeof employeeDepartureReview.$inferSelect;
