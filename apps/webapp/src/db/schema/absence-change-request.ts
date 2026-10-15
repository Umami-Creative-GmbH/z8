import { sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import type {
	AbsenceChangeKind,
	AbsenceChangeOriginal,
	AbsenceChangeProposal,
	AbsenceChangeStatus,
} from "@/lib/absences/change-request-types";
import { organization, user } from "../auth-schema";
import { approvalWorkflow } from "./approval-workflow";
import { employee } from "./organization";

/** A proposal and its history survive cancellation of the effective absence (#1190). */
export const absenceChangeRequest = pgTable(
	"absence_change_request",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		// Intentionally no absence FK: approved cancellation removes that row, not this history.
		absenceId: uuid("absence_id").notNull(),
		kind: text("kind").$type<AbsenceChangeKind>().notNull(),
		status: text("status").$type<AbsenceChangeStatus>().default("pending").notNull(),
		original: jsonb("original").$type<AbsenceChangeOriginal>().notNull(),
		proposed: jsonb("proposed").$type<AbsenceChangeProposal | null>(),
		reason: text("reason").notNull(),
		approvalWorkflowId: uuid("approval_workflow_id"),
		submittedBy: text("submitted_by")
			.notNull()
			.references(() => user.id),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		decidedAt: timestamp("decided_at", { withTimezone: true }),
		decidedBy: text("decided_by").references(() => user.id),
		decisionReason: text("decision_reason"),
	},
	(table) => [
		foreignKey({
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.approvalWorkflowId, table.organizationId],
			foreignColumns: [approvalWorkflow.id, approvalWorkflow.organizationId],
		}),
		uniqueIndex("absenceChangeRequest_pending_idx")
			.on(table.organizationId, table.absenceId)
			.where(sql`${table.status} = 'pending'`),
		index("absenceChangeRequest_employee_history_idx").on(
			table.organizationId,
			table.employeeId,
			table.createdAt,
		),
		// Keep the names PostgreSQL assigned to the unnamed checks in migration 0231.
		check("absence_change_request_kind_check", sql`${table.kind} in ('change', 'cancel')`),
		check(
			"absence_change_request_status_check",
			sql`${table.status} in ('pending', 'approved', 'rejected', 'withdrawn', 'obsolete', 'expired')`,
		),
		check(
			"absence_change_request_reason_check",
			sql`length(trim(${table.reason})) between 1 and 2000`,
		),
		check(
			"absence_change_request_check",
			sql`(${table.kind} = 'cancel' and ${table.proposed} is null) or (${table.kind} = 'change' and ${table.proposed} is not null)`,
		),
	],
);
