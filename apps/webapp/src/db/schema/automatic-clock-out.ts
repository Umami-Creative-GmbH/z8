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
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import type {
	AutoClockOutCandidate,
	AutoClockOutTaskKind,
} from "@/lib/time-tracking/automatic-clock-out/types";
import { organization, user } from "../auth-schema";
import { employee } from "./organization";

// Committed closure evidence. Source work/entry IDs remain historical values,
// and an UPDATE trigger in the migration protects the entire execution row.
export const automaticClockOutExecution = pgTable(
	"automatic_clock_out_execution",
	{
		id: uuid("id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		workPeriodId: uuid("work_period_id").notNull(),
		startTime: timestamp("start_time", { withTimezone: true }).notNull(),
		cutoffTime: timestamp("cutoff_time", { withTimezone: true }).notNull(),
		maxUninterruptedMinutes: integer("max_uninterrupted_minutes").notNull(),
		settingsRevision: integer("settings_revision").notNull(),
		timezone: text("timezone").notNull(),
		utcOffsetMinutes: integer("utc_offset_minutes").notNull(),
		recipientUserId: text("recipient_user_id")
			.notNull()
			.references(() => user.id),
		provenanceUserId: text("provenance_user_id")
			.notNull()
			.references(() => user.id),
		clockOutEntryId: uuid("clock_out_entry_id").notNull(),
		closurePayload: jsonb("closure_payload").$type<Record<string, unknown>>().notNull(),
		processedAt: timestamp("processed_at", { withTimezone: true }).notNull(),
	},
	(table) => [
		foreignKey({
			name: "automatic_clock_out_execution_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		uniqueIndex("automaticClockOutExecution_ownership_idx").on(
			table.id,
			table.organizationId,
			table.employeeId,
		),
		index("automaticClockOutExecution_org_period_idx").on(table.organizationId, table.workPeriodId),
		check(
			"automatic_clock_out_execution_limit_check",
			sql`${table.maxUninterruptedMinutes} BETWEEN 1 AND 2147483647`,
		),
		check("automatic_clock_out_execution_revision_check", sql`${table.settingsRevision} >= 0`),
		check(
			"automatic_clock_out_execution_cutoff_check",
			sql`${table.cutoffTime} = ${table.startTime} + ${table.maxUninterruptedMinutes} * INTERVAL '1 minute'`,
		),
		check(
			"automatic_clock_out_execution_offset_check",
			sql`${table.utcOffsetMinutes} BETWEEN -840 AND 840`,
		),
		check(
			"automatic_clock_out_execution_payload_check",
			sql`jsonb_typeof(${table.closurePayload}) = 'object'`,
		),
	],
);

export const automaticClockOutTask = pgTable(
	"automatic_clock_out_task",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		operationId: uuid("operation_id").notNull(),
		kind: text("kind").$type<AutoClockOutTaskKind>().notNull(),
		dedupeKey: text("dedupe_key").notNull(),
		payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
		status: text("status")
			.$type<"pending" | "processing" | "completed" | "failed">()
			.default("pending")
			.notNull(),
		claimToken: uuid("claim_token"),
		leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
		availableAt: timestamp("available_at", { withTimezone: true }).defaultNow().notNull(),
		attemptCount: integer("attempt_count").default(0).notNull(),
		// Only sanitized transport/processing summaries belong here, never secrets.
		lastError: text("last_error"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		foreignKey({
			name: "automatic_clock_out_task_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "automatic_clock_out_task_execution_fk",
			columns: [table.operationId, table.organizationId, table.employeeId],
			foreignColumns: [
				automaticClockOutExecution.id,
				automaticClockOutExecution.organizationId,
				automaticClockOutExecution.employeeId,
			],
		}).onDelete("cascade"),
		uniqueIndex("automaticClockOutTask_org_dedupe_idx").on(table.organizationId, table.dedupeKey),
		index("automaticClockOutTask_due_idx").on(table.status, table.availableAt, table.id),
		index("automaticClockOutTask_lease_idx").on(table.status, table.leaseExpiresAt, table.id),
		check(
			"automatic_clock_out_task_kind_check",
			sql`${table.kind} IN ('follow_up', 'plan_notification', 'notification_channel')`,
		),
		check(
			"automatic_clock_out_task_status_check",
			sql`${table.status} IN ('pending', 'processing', 'completed', 'failed')`,
		),
		check("automatic_clock_out_task_attempts_check", sql`${table.attemptCount} >= 0`),
		check(
			"automatic_clock_out_task_lease_check",
			sql`(${table.status} = 'processing' AND ${table.claimToken} IS NOT NULL AND ${table.leaseExpiresAt} IS NOT NULL) OR (${table.status} <> 'processing' AND ${table.claimToken} IS NULL AND ${table.leaseExpiresAt} IS NULL)`,
		),
		check("automatic_clock_out_task_payload_check", sql`jsonb_typeof(${table.payload}) = 'object'`),
	],
);

// Internal global scan progress; it contains no organization configuration and
// must never be exposed through tenant-facing queries or settings APIs.
export const automaticClockOutScanState = pgTable(
	"automatic_clock_out_scan_state",
	{
		id: text("id").primaryKey().default("maintenance"),
		cursor: jsonb("cursor").$type<AutoClockOutCandidate>(),
		claimToken: uuid("claim_token"),
		leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		check("automatic_clock_out_scan_state_id_check", sql`${table.id} = 'maintenance'`),
		check(
			"automatic_clock_out_scan_state_lease_check",
			sql`(${table.claimToken} IS NULL) = (${table.leaseExpiresAt} IS NULL)`,
		),
		check(
			"automatic_clock_out_scan_state_cursor_check",
			sql`${table.cursor} IS NULL OR (jsonb_typeof(${table.cursor}) = 'object' AND ${table.cursor} ?& ARRAY['organizationId', 'employeeId', 'workPeriodId'] AND ${table.cursor} - ARRAY['organizationId', 'employeeId', 'workPeriodId'] = '{}'::jsonb AND jsonb_typeof(${table.cursor}->'organizationId') = 'string' AND jsonb_typeof(${table.cursor}->'employeeId') = 'string' AND jsonb_typeof(${table.cursor}->'workPeriodId') = 'string')`,
		),
	],
);
