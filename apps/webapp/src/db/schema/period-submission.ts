import { sql } from "drizzle-orm";
import {
	check,
	date,
	foreignKey,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import {
	SUBMISSION_CADENCE_KINDS,
	SUBMISSION_WEEKDAYS,
	type SubmissionCadenceKind,
	type SubmissionWeekday,
} from "@/lib/time-tracking/period-submissions/cadence";
import {
	DEFAULT_SECOND_REMINDER_DELAY_DAYS,
	MAX_SECOND_REMINDER_DELAY_DAYS,
	MIN_SECOND_REMINDER_DELAY_DAYS,
} from "@/lib/time-tracking/period-submissions/settings-policy";
import {
	PERIOD_SUBMISSION_CLOSED_CAUSES,
	PERIOD_SUBMISSION_STATUSES,
	type PeriodSubmissionClosedCause,
	type PeriodSubmissionStatus,
} from "@/lib/time-tracking/period-submissions/submission-status";
import { organization, user } from "../auth-schema";
import { approvalWorkflow } from "./approval-workflow";
import { employee } from "./organization";

function textIn(column: string, values: readonly string[]): string {
	return `${column} IN (${values.map((value) => `'${value}'`).join(", ")})`;
}

/**
 * Per-organization period submission settings (#805). A missing row means the defaults. The
 * cadence itself is kept as a history in `period_submission_cadence_change`, because a change
 * takes effect only at the next period boundary the old and new cadence share.
 */
export const periodSubmissionSettings = pgTable(
	"period_submission_settings",
	{
		organizationId: text("organization_id")
			.primaryKey()
			.references(() => organization.id, { onDelete: "cascade" }),
		secondReminderDelayDays: integer("second_reminder_delay_days")
			.default(DEFAULT_SECOND_REMINDER_DELAY_DAYS)
			.notNull(),
		revision: integer("revision").default(1).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
		updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
	},
	(table) => [
		check(
			"period_submission_settings_delay_check",
			sql.raw(
				`second_reminder_delay_days BETWEEN ${MIN_SECOND_REMINDER_DELAY_DAYS} AND ${MAX_SECOND_REMINDER_DELAY_DAYS}`,
			),
		),
		check("period_submission_settings_revision_check", sql`${table.revision} >= 1`),
	],
);

/**
 * Every saved submission cadence of an organization, append-only. The derivation of expected
 * submission periods replays it to find when each cadence was in effect.
 */
export const periodSubmissionCadenceChange = pgTable(
	"period_submission_cadence_change",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		cadence: text("cadence").$type<SubmissionCadenceKind>().notNull(),
		/** Set exactly for a weekly cadence. */
		weekStartDay: text("week_start_day").$type<SubmissionWeekday>(),
		changedAt: timestamp("changed_at", { withTimezone: true }).notNull(),
		changedBy: text("changed_by").references(() => user.id, { onDelete: "set null" }),
	},
	(table) => [
		index("period_submission_cadence_change_org_idx").on(table.organizationId, table.changedAt),
		check(
			"period_submission_cadence_change_cadence_check",
			sql.raw(textIn("cadence", SUBMISSION_CADENCE_KINDS)),
		),
		check(
			"period_submission_cadence_change_week_start_check",
			sql.raw(
				`(week_start_day IS NULL OR ${textIn("week_start_day", SUBMISSION_WEEKDAYS)}) AND ((cadence = 'weekly') = (week_start_day IS NOT NULL))`,
			),
		),
	],
);

/**
 * One submission of one submission period by one employee (#1059, spec #805): the source of
 * exactly one canonical `period_submission` approval workflow. A period is submitted again with a
 * new row, so earlier rows stay as history (a rejection, a withdrawal, or an approval that went out
 * of date after a change). At most one row per employee and period is live (pending or approved).
 *
 * The range is fixed at submission: local dates in `timezone` plus the instants they cover.
 */
export const periodSubmission = pgTable(
	"period_submission",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		cadence: text("cadence").$type<Exclude<SubmissionCadenceKind, "off">>().notNull(),
		/** Set exactly for a weekly cadence. */
		weekStartDay: text("week_start_day").$type<SubmissionWeekday>(),
		timezone: text("timezone").notNull(),
		/** The submitted range, inclusive local dates (clipped to employment). */
		startDate: date("start_date").notNull(),
		endDate: date("end_date").notNull(),
		/** The whole week or month the range belongs to: the period across employees. */
		cadenceStartDate: date("cadence_start_date").notNull(),
		cadenceEndDate: date("cadence_end_date").notNull(),
		/** The range as fixed instants, `[rangeStart, rangeEnd)`. */
		rangeStart: timestamp("range_start", { withTimezone: true }).notNull(),
		rangeEnd: timestamp("range_end", { withTimezone: true }).notNull(),
		status: text("status").$type<PeriodSubmissionStatus>().default("pending").notNull(),
		approvalWorkflowId: uuid("approval_workflow_id"),
		submittedBy: text("submitted_by")
			.notNull()
			.references(() => user.id),
		submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
		/** The approve or reject decision; kept when an approval goes out of date. */
		decidedAt: timestamp("decided_at", { withTimezone: true }),
		decidedByEmployeeId: uuid("decided_by_employee_id"),
		decisionReason: text("decision_reason"),
		/** When and why a pending submission was withdrawn, or an approval went out of date. */
		closedAt: timestamp("closed_at", { withTimezone: true }),
		closedCause: text("closed_cause").$type<PeriodSubmissionClosedCause>(),
		revision: integer("revision").default(1).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		unique("period_submission_id_organization_idx").on(table.id, table.organizationId),
		foreignKey({
			name: "period_submission_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "period_submission_approval_workflow_fk",
			columns: [table.approvalWorkflowId, table.organizationId],
			foreignColumns: [approvalWorkflow.id, approvalWorkflow.organizationId],
		}),
		uniqueIndex("period_submission_live_idx")
			.on(table.organizationId, table.employeeId, table.startDate)
			.where(sql`status IN ('pending', 'approved')`),
		uniqueIndex("period_submission_workflow_idx")
			.on(table.organizationId, table.approvalWorkflowId)
			.where(sql`approval_workflow_id IS NOT NULL`),
		index("period_submission_employee_idx").on(
			table.organizationId,
			table.employeeId,
			table.startDate,
		),
		index("period_submission_cadence_period_idx").on(table.organizationId, table.cadenceStartDate),
		check(
			"period_submission_cadence_check",
			sql.raw(
				`cadence IN ('weekly', 'monthly') AND (week_start_day IS NULL OR ${textIn("week_start_day", SUBMISSION_WEEKDAYS)}) AND ((cadence = 'weekly') = (week_start_day IS NOT NULL))`,
			),
		),
		check(
			"period_submission_range_check",
			sql`${table.endDate} >= ${table.startDate} AND ${table.startDate} >= ${table.cadenceStartDate} AND ${table.endDate} <= ${table.cadenceEndDate} AND ${table.rangeEnd} > ${table.rangeStart}`,
		),
		check("period_submission_status_check", sql.raw(textIn("status", PERIOD_SUBMISSION_STATUSES))),
		check(
			"period_submission_closed_cause_check",
			sql.raw(`closed_cause IS NULL OR ${textIn("closed_cause", PERIOD_SUBMISSION_CLOSED_CAUSES)}`),
		),
		check(
			"period_submission_lifecycle_check",
			sql.raw(`(status = 'pending' AND decided_at IS NULL AND closed_at IS NULL AND closed_cause IS NULL)
				OR (status = 'approved' AND decided_at IS NOT NULL AND closed_at IS NULL AND closed_cause IS NULL)
				OR (status = 'rejected' AND decided_at IS NOT NULL AND decision_reason IS NOT NULL AND closed_at IS NULL AND closed_cause IS NULL)
				OR (status = 'withdrawn' AND decided_at IS NULL AND closed_at IS NOT NULL AND closed_cause IS NOT NULL)
				OR (status = 'outdated' AND decided_at IS NOT NULL AND closed_at IS NOT NULL AND closed_cause = 'change')`),
		),
		check("period_submission_revision_check", sql`${table.revision} >= 1`),
	],
);