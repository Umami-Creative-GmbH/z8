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
import { organization, user } from "../auth-schema";
import {
	type ContractMigrationConflictKind,
	type ContractMigrationConflictStatus,
	contractMigrationConflictKinds,
	contractMigrationConflictStatuses,
} from "./contract-types";
import { employeeEmploymentHistory, employmentTermAgreement } from "./employment-history";
import { employee } from "./organization";
import { workPolicy } from "./work-policy";

type JsonObject = Record<string, unknown>;

function textIn(column: string, values: readonly string[]) {
	return sql.raw(`"${column}" IN (${values.map((value) => `'${value}'`).join(", ")})`);
}

/** Durable conflict ledger for backfill and mutating-write-path mismatches. */
export const contractMigrationConflict = pgTable(
	"contract_migration_conflict",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id"),
		employmentHistoryId: uuid("employment_history_id").references(
			() => employeeEmploymentHistory.id,
			{ onDelete: "cascade" },
		),
		workPolicyId: uuid("work_policy_id"),
		conflictKind: text("conflict_kind").$type<ContractMigrationConflictKind>().notNull(),
		dedupeKey: text("dedupe_key").notNull(),
		status: text("status").$type<ContractMigrationConflictStatus>().default("open").notNull(),
		details: jsonb("details").$type<JsonObject>().default({}).notNull(),
		resolvedAt: timestamp("resolved_at", { withTimezone: true }),
		resolvedBy: text("resolved_by").references(() => user.id, { onDelete: "set null" }),
		resolutionNote: text("resolution_note"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("contractMigrationConflict_org_dedupe_uidx").on(
			table.organizationId,
			table.dedupeKey,
		),
		index("contractMigrationConflict_org_status_idx").on(table.organizationId, table.status),
		index("contractMigrationConflict_employee_idx").on(table.organizationId, table.employeeId),
		foreignKey({
			name: "contract_migration_conflict_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "contract_migration_conflict_work_policy_fk",
			columns: [table.workPolicyId, table.organizationId],
			foreignColumns: [workPolicy.id, workPolicy.organizationId],
		}).onDelete("cascade"),
		check(
			"contract_migration_conflict_kind_check",
			textIn("conflict_kind", contractMigrationConflictKinds),
		),
		check(
			"contract_migration_conflict_status_check",
			textIn("status", contractMigrationConflictStatuses),
		),
	],
);

/** Org-admin acknowledgements of statutory or contract review notices. */
export const contractReviewAcknowledgement = pgTable(
	"contract_review_acknowledgement",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		employmentHistoryId: uuid("employment_history_id"),
		agreementId: uuid("agreement_id").references(() => employmentTermAgreement.id, {
			onDelete: "cascade",
		}),
		reviewKind: text("review_kind").notNull(),
		dedupeKey: text("dedupe_key").notNull(),
		acknowledgedBy: text("acknowledged_by")
			.notNull()
			.references(() => user.id),
		acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }).defaultNow().notNull(),
		note: text("note"),
		metadata: jsonb("metadata").$type<JsonObject>().default({}).notNull(),
		/**
		 * Statutory acknowledgements (#1988): what was evaluated (e.g. a month `2026-03`), the
		 * deterministic fingerprint of the evaluated inputs, and an optional legal note. A row with a
		 * fingerprint is immutable; a changed fingerprint makes it stale rather than editing it.
		 */
		subjectKey: text("subject_key"),
		inputFingerprint: text("input_fingerprint"),
		legalNote: text("legal_note"),
	},
	(table) => [
		uniqueIndex("contractReviewAck_org_dedupe_uidx").on(table.organizationId, table.dedupeKey),
		index("contractReviewAck_org_employee_idx").on(table.organizationId, table.employeeId),
		index("contractReviewAck_statutory_subject_idx")
			.on(
				table.organizationId,
				table.employeeId,
				table.reviewKind,
				table.subjectKey,
				table.acknowledgedAt,
			)
			.where(sql`"input_fingerprint" IS NOT NULL`),
		check(
			"contract_review_ack_statutory_shape_check",
			sql`("subject_key" IS NULL) = ("input_fingerprint" IS NULL) AND ("input_fingerprint" IS NULL OR ("note" IS NOT NULL AND length(btrim("note")) > 0))`,
		),
		foreignKey({
			name: "contract_review_ack_employee_fk",
			columns: [table.employeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "contract_review_ack_history_fk",
			columns: [table.employmentHistoryId, table.organizationId],
			foreignColumns: [employeeEmploymentHistory.id, employeeEmploymentHistory.organizationId],
		}).onDelete("cascade"),
	],
);

export type ContractMigrationConflict = typeof contractMigrationConflict.$inferSelect;
export type ContractReviewAcknowledgement = typeof contractReviewAcknowledgement.$inferSelect;
