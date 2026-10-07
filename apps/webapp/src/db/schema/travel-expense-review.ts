import { sql } from "drizzle-orm";
import {
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
import { employee } from "./organization";
import { travelExpenseReport } from "./travel-expense";

/**
 * How one submission cycle of a travel expense report closed without a final
 * decision (#603): a reviewer returned it for changes, or its employee
 * withdrew it. An approved cycle that an approver reopened for correction
 * before export or reimbursement (#614) is `reopened`: its approval stays.
 */
export const TRAVEL_EXPENSE_REPORT_CYCLE_CLOSURE_KINDS = [
	"returned",
	"withdrawn",
	"reopened",
] as const;
export type TravelExpenseReportCycleClosureKind =
	(typeof TRAVEL_EXPENSE_REPORT_CYCLE_CLOSURE_KINDS)[number];

// Append-only record of a closed submission cycle (#603). At most one per cycle:
// a cycle that was returned or withdrawn is never decided, and a new submission
// opens the next cycle. The legacy approval request, decision evidence and
// frozen revision are kept by value, like other legacy evidence references.
export const travelExpenseReportCycleClosure = pgTable(
	"travel_expense_report_cycle_closure",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		reportId: uuid("report_id").notNull(),
		submissionCycle: integer("submission_cycle").notNull(),
		kind: text("kind").$type<TravelExpenseReportCycleClosureKind>().notNull(),
		/** The reviewer's note; required to return, absent on withdrawal. */
		note: text("note"),
		submittedRevisionId: uuid("submitted_revision_id").notNull(),
		approvalRequestId: uuid("approval_request_id").notNull(),
		decisionEvidenceId: uuid("decision_evidence_id"),
		/**
		 * Who closed the cycle. Null only after that employee or user was deleted
		 * (migration 0130): history never blocks deleting a reviewer.
		 */
		actorEmployeeId: uuid("actor_employee_id"),
		actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		foreignKey({
			name: "travel_expense_report_cycle_closure_report_fk",
			columns: [table.reportId, table.organizationId],
			foreignColumns: [travelExpenseReport.id, travelExpenseReport.organizationId],
		}).onDelete("cascade"),
		// Migration 0130 deletes with SET NULL ("actor_employee_id") only, keeping the organization.
		foreignKey({
			name: "travel_expense_report_cycle_closure_actor_fk",
			columns: [table.actorEmployeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("set null"),
		uniqueIndex("travelExpenseReportCycleClosure_id_org_idx").on(table.id, table.organizationId),
		uniqueIndex("travelExpenseReportCycleClosure_report_cycle_idx").on(
			table.organizationId,
			table.reportId,
			table.submissionCycle,
		),
		check(
			"travel_expense_report_cycle_closure_kind_check",
			sql`${table.kind} IN ('returned', 'withdrawn', 'reopened')`,
		),
		// A reopened cycle (#614) keeps the reopen reason and names, by value, the
		// approval decision evidence it reopened.
		check(
			"travel_expense_report_cycle_closure_note_check",
			sql`${table.submissionCycle} >= 1
			AND (${table.kind} IN ('returned', 'reopened') AND ${table.note} IS NOT NULL
					AND length(btrim(${table.note})) > 0 AND ${table.decisionEvidenceId} IS NOT NULL
				OR ${table.kind} = 'withdrawn' AND ${table.note} IS NULL
					AND ${table.decisionEvidenceId} IS NULL)`,
		),
	],
);

// A reviewer's comment on one item of a returned submission (#603), written
// with the return. The item is referenced by value: the employee may remove it
// while correcting the report, and the comment stays with the frozen cycle.
export const travelExpenseReportReviewNote = pgTable(
	"travel_expense_report_review_note",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id").notNull(),
		closureId: uuid("closure_id").notNull(),
		itemId: uuid("item_id").notNull(),
		body: text("body").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		foreignKey({
			name: "travel_expense_report_review_note_closure_fk",
			columns: [table.closureId, table.organizationId],
			foreignColumns: [
				travelExpenseReportCycleClosure.id,
				travelExpenseReportCycleClosure.organizationId,
			],
		}).onDelete("cascade"),
		uniqueIndex("travelExpenseReportReviewNote_closure_item_idx").on(table.closureId, table.itemId),
		index("travelExpenseReportReviewNote_org_idx").on(table.organizationId),
		check("travel_expense_report_review_note_body_check", sql`length(btrim(${table.body})) > 0`),
	],
);
