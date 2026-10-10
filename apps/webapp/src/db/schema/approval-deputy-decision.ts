import {
	check,
	foreignKey,
	index,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organization } from "../auth-schema";
import { absenceEntry } from "./absence";
import { employee } from "./organization";

/**
 * The acting-for record (#1016, spec #802, Approvals ADR 0002, migration
 * 0197): one row per approval decision a covering deputy made for an absent
 * approver, under legacy or canonical authority, written in the decision's
 * transaction. The approver stays assigned; this row is what says "decided by
 * Y as deputy for X", for requester history, the audit trail, deputy cards
 * (#1017) and cover summaries (#1018, by `absence_id`).
 */
export const approvalDeputyDecision = pgTable(
	"approval_deputy_decision",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		/** The covering deputy Y who decided. */
		deputyEmployeeId: uuid("deputy_employee_id").notNull(),
		/** The absent approver X the decision was made for. */
		actingForEmployeeId: uuid("acting_for_employee_id").notNull(),
		/** X's absence that made the cover; cleared if the absence is deleted. */
		absenceId: uuid("absence_id"),
		authority: text("authority").$type<"legacy" | "canonical">().notNull(),
		/** `absence_entry` | `time_entry` | `travel_expense_report`. */
		entityType: text("entity_type").notNull(),
		entityId: uuid("entity_id").notNull(),
		/** The legacy request, or the canonical stage's compatibility row. */
		approvalRequestId: uuid("approval_request_id"),
		workflowId: uuid("workflow_id"),
		assignmentId: uuid("assignment_id"),
		decision: text("decision").$type<"approved" | "rejected">().notNull(),
		decidedAt: timestamp("decided_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		foreignKey({
			name: "approval_deputy_decision_deputy_fk",
			columns: [table.deputyEmployeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "approval_deputy_decision_acting_for_fk",
			columns: [table.actingForEmployeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "approval_deputy_decision_absence_fk",
			columns: [table.absenceId, table.organizationId],
			foreignColumns: [absenceEntry.id, absenceEntry.organizationId],
		}).onDelete("set null"),
		check(
			"approval_deputy_decision_shape_check",
			sql`${table.authority} IN ('legacy', 'canonical') AND ${table.decision} IN ('approved', 'rejected') AND ${table.deputyEmployeeId} <> ${table.actingForEmployeeId} AND (${table.authority} = 'legacy' OR (${table.workflowId} IS NOT NULL AND ${table.assignmentId} IS NOT NULL))`,
		),
		uniqueIndex("approvalDeputyDecision_org_assignment_idx")
			.on(table.organizationId, table.assignmentId)
			.where(sql`${table.assignmentId} IS NOT NULL`),
		uniqueIndex("approvalDeputyDecision_org_legacyRequest_idx")
			.on(table.organizationId, table.approvalRequestId)
			.where(sql`${table.authority} = 'legacy'`),
		index("approvalDeputyDecision_org_actingFor_decidedAt_idx").on(
			table.organizationId,
			table.actingForEmployeeId,
			table.decidedAt,
		),
		index("approvalDeputyDecision_org_absence_idx").on(table.organizationId, table.absenceId),
		index("approvalDeputyDecision_org_entity_idx").on(
			table.organizationId,
			table.entityType,
			table.entityId,
		),
	],
);
