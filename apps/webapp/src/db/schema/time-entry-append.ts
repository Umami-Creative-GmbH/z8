import { sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	integer,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { organization } from "../auth-schema";
import { historicalWorkProposal } from "./completed-work";
import { employee } from "./organization";
import { timeEntry } from "./time-tracking";

export const TIME_ENTRY_APPEND_MODES = ["inactive", "active"] as const;
export type TimeEntryAppendMode = (typeof TIME_ENTRY_APPEND_MODES)[number];

export const TIME_ENTRY_APPEND_ADMISSIONS = [
	"empty_history",
	"verified_lineage",
	"authorized_continuation",
] as const;
export type TimeEntryAppendAdmission = (typeof TIME_ENTRY_APPEND_ADMISSIONS)[number];

export const TIME_ENTRY_APPEND_OPERATIONS = [
	"live_clock_in",
	"live_clock_out",
	"reviewed_import",
	"demo_generation",
	"demo_correction",
	"completed_work_correction",
	"manual_entry",
	"time_correction_submission",
	"policy_clock_out_break",
	"completed_work_split",
	"authorized_continuation",
] as const;
export type TimeEntryAppendOperation = (typeof TIME_ENTRY_APPEND_OPERATIONS)[number];

// Per-organization evidence-based append adoption (#262/#273). No row keeps the
// legacy head selection. There is deliberately no application setter: activation
// waits for every competing writer to participate or be drained.
export const timeEntryAppendControl = pgTable(
	"time_entry_append_control",
	{
		organizationId: text("organization_id")
			.primaryKey()
			.references(() => organization.id, { onDelete: "cascade" }),
		mode: text("mode").$type<TimeEntryAppendMode>().default("inactive").notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		check("time_entry_append_control_mode_check", sql`${table.mode} IN ('inactive', 'active')`),
	],
);

// Versioned employee append position: the exact tip under which the next fresh
// entry is appended, how that continuity was admitted, and the operation that last
// advanced it. `entryCount` is position evidence: any unexpected write or
// removal in the employee's history changes it and holds fresh appends for
// review. The tip reference keeps committed evidence from being removed under it.
// An authorized continuation (#323) is established by its approved proposal at the
// anchor, with the tip at the anchor and the digest of the history it disclosed.
export const timeEntryAppendPosition = pgTable(
	"time_entry_append_position",
	{
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		tipEntryId: uuid("tip_entry_id")
			.notNull()
			.references(() => timeEntry.id),
		tipHash: text("tip_hash").notNull(),
		version: integer("version").notNull(),
		entryCount: integer("entry_count").notNull(),
		admission: text("admission").$type<TimeEntryAppendAdmission>().notNull(),
		// The verified tip admission was granted from; null only for empty history.
		admittedTipEntryId: uuid("admitted_tip_entry_id").references(() => timeEntry.id),
		admittedTipHash: text("admitted_tip_hash"),
		admittedEntryCount: integer("admitted_entry_count").notNull(),
		// Digest of the disclosed history an authorized continuation admitted over.
		admittedHistoryDigest: text("admitted_history_digest"),
		continuationProposalId: uuid("continuation_proposal_id").references(
			() => historicalWorkProposal.id,
		),
		admittedOperation: text("admitted_operation").$type<TimeEntryAppendOperation>().notNull(),
		admittedAt: timestamp("admitted_at", { withTimezone: true }).notNull(),
		lastOperation: text("last_operation").$type<TimeEntryAppendOperation>().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.organizationId, table.employeeId] }),
		foreignKey({
			name: "time_entry_append_position_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		check("time_entry_append_position_version_check", sql`${table.version} >= 1`),
		check(
			"time_entry_append_position_count_check",
			sql`(${table.entryCount} > ${table.admittedEntryCount} OR (${table.admission} = 'authorized_continuation' AND ${table.entryCount} = ${table.admittedEntryCount})) AND ${table.admittedEntryCount} >= 0`,
		),
		check(
			"time_entry_append_position_admission_check",
			sql`(${table.admission} = 'empty_history' AND ${table.admittedTipEntryId} IS NULL AND ${table.admittedTipHash} IS NULL AND ${table.admittedEntryCount} = 0 AND ${table.admittedHistoryDigest} IS NULL AND ${table.continuationProposalId} IS NULL) OR (${table.admission} = 'verified_lineage' AND ${table.admittedTipEntryId} IS NOT NULL AND ${table.admittedTipHash} IS NOT NULL AND ${table.admittedEntryCount} > 0 AND ${table.admittedHistoryDigest} IS NULL AND ${table.continuationProposalId} IS NULL) OR (${table.admission} = 'authorized_continuation' AND ${table.admittedTipEntryId} IS NOT NULL AND ${table.admittedTipHash} IS NOT NULL AND ${table.admittedEntryCount} > 0 AND ${table.admittedHistoryDigest} IS NOT NULL AND ${table.continuationProposalId} IS NOT NULL)`,
		),
		check(
			"time_entry_append_position_operation_check",
			sql`${table.admittedOperation} IN ('live_clock_in', 'live_clock_out', 'reviewed_import', 'demo_generation', 'demo_correction', 'completed_work_correction', 'manual_entry', 'time_correction_submission', 'policy_clock_out_break', 'completed_work_split', 'authorized_continuation') AND ${table.lastOperation} IN ('live_clock_in', 'live_clock_out', 'reviewed_import', 'demo_generation', 'demo_correction', 'completed_work_correction', 'manual_entry', 'time_correction_submission', 'policy_clock_out_break', 'completed_work_split', 'authorized_continuation')`,
		),
	],
);
