import { is, type SQL } from "drizzle-orm";
import {
	getTableConfig,
	IndexedColumn,
	PgColumn,
	PgDialect,
} from "drizzle-orm/pg-core";
import {
	createTableRelationsHelpers,
	extractTablesRelationalConfig,
	normalizeRelation,
} from "drizzle-orm/relations";
import { describe, expect, it } from "vitest";
import {
	APPROVAL_ACTOR_KINDS,
	APPROVAL_OUTBOX_EXPANSION_STATUSES,
	APPROVAL_OUTBOX_STATUSES,
} from "../../../lib/approvals/workflow/types";
import * as authSchema from "../../auth-schema";
import { absenceEntry } from "../absence";
import {
	approvalInboxProjection,
	approvalOutbox,
	approvalOutboxDelivery,
	approvalRequesterProjection,
	approvalStageAssignment,
	approvalWorkflow,
	approvalWorkflowCommand,
	approvalWorkflowEvent,
	approvalWorkflowMigrationIssue,
	approvalWorkflowRollout,
	approvalWorkflowStage,
} from "../approval-workflow";
import { complianceException } from "../compliance";
import {
	approvalActorKindEnum,
	approvalOutboxExpansionStatusEnum,
	approvalOutboxStatusEnum,
} from "../enums";
import * as businessSchema from "../index";
import { notification } from "../notification";
import { employee } from "../organization";
import { shift, shiftRequest } from "../shift";
import { workPeriod } from "../time-tracking";
import { travelExpenseClaim } from "../travel-expense";

type Table = Parameters<typeof getTableConfig>[0];

const canonicalTables = [
	approvalWorkflow,
	approvalWorkflowStage,
	approvalStageAssignment,
	approvalWorkflowEvent,
	approvalWorkflowCommand,
	approvalRequesterProjection,
	approvalInboxProjection,
	approvalOutbox,
	approvalOutboxDelivery,
	approvalWorkflowRollout,
	approvalWorkflowMigrationIssue,
];

const requiredLifecycleTimestamps: Array<{
	table: Table;
	columns: string[];
}> = [
	{
		table: approvalWorkflow,
		columns: [
			"submitted_at",
			"completed_at",
			"cancelled_at",
			"created_at",
			"updated_at",
		],
	},
	{
		table: approvalWorkflowStage,
		columns: ["activated_at", "decided_at", "created_at", "updated_at"],
	},
	{
		table: approvalStageAssignment,
		columns: ["assigned_at", "resolved_at", "created_at", "updated_at"],
	},
	{ table: approvalWorkflowEvent, columns: ["occurred_at", "created_at"] },
	{ table: approvalWorkflowCommand, columns: ["created_at", "updated_at"] },
	{ table: approvalRequesterProjection, columns: ["created_at", "updated_at"] },
	{ table: approvalInboxProjection, columns: ["created_at", "updated_at"] },
	{ table: approvalOutbox, columns: ["expanded_at", "created_at"] },
	{
		table: approvalOutboxDelivery,
		columns: [
			"available_at",
			"claimed_at",
			"processed_at",
			"created_at",
			"updated_at",
		],
	},
	{
		table: approvalWorkflowRollout,
		columns: [
			"backfilled_through",
			"last_reconciled_at",
			"created_at",
			"updated_at",
		],
	},
	{
		table: approvalWorkflowMigrationIssue,
		columns: ["disposed_at", "created_at", "updated_at"],
	},
];

function columnNames(columns: unknown[]): string[] | undefined {
	const names: string[] = [];

	for (const column of columns) {
		if (
			!(is(column, IndexedColumn) || is(column, PgColumn)) ||
			typeof column.name !== "string"
		) {
			return undefined;
		}

		names.push(column.name);
	}

	return names;
}

function outerParenthesesEncloseExpression(value: string): boolean {
	let depth = 0;
	let inStringLiteral = false;

	for (let index = 0; index < value.length; index += 1) {
		const character = value[index];

		if (character === "'") {
			if (inStringLiteral && value[index + 1] === "'") {
				index += 1;
				continue;
			}

			inStringLiteral = !inStringLiteral;
			continue;
		}

		if (inStringLiteral) continue;
		if (character === "(") depth += 1;
		if (character === ")") depth -= 1;
		if (depth === 0) return index === value.length - 1;
	}

	return false;
}

function stripOuterParentheses(value: string): string {
	let result = value;

	while (
		result.startsWith("(") &&
		result.endsWith(")") &&
		outerParenthesesEncloseExpression(result)
	) {
		result = result.slice(1, -1).trim();
	}

	return result;
}

function transformOutsideStringLiterals(
	value: string,
	transform: (segment: string) => string,
): string {
	let result = "";
	let segmentStart = 0;

	for (let index = 0; index < value.length; index += 1) {
		if (value[index] !== "'") continue;

		result += transform(value.slice(segmentStart, index));
		const literalStart = index;
		index += 1;

		while (index < value.length) {
			if (value[index] !== "'") {
				index += 1;
				continue;
			}

			if (value[index + 1] === "'") {
				index += 2;
				continue;
			}

			break;
		}

		result += value.slice(literalStart, index + 1);
		segmentStart = index + 1;
	}

	return result + transform(value.slice(segmentStart));
}

function normalizePredicateSql(value: string): string {
	const normalizedIdentifiers = transformOutsideStringLiterals(
		value,
		(segment) =>
			segment.replaceAll('"', "").replace(/\b[A-Za-z_][A-Za-z0-9_]*\./g, ""),
	);
	const normalizedFormatting = transformOutsideStringLiterals(
		normalizedIdentifiers,
		(segment) => segment.replace(/\s+/g, " ").replace(/\s*=\s*/g, " = "),
	);

	return stripOuterParentheses(normalizedFormatting.trim().replace(/;$/, ""));
}

function predicateQuery(where: SQL | undefined):
	| {
			sql: string;
			params: unknown[];
	  }
	| undefined {
	if (!where) return undefined;

	const query = new PgDialect().sqlToQuery(where);

	return { sql: normalizePredicateSql(query.sql), params: query.params };
}

function isPendingOnlyPredicate(where: SQL | undefined): boolean {
	const predicate = predicateQuery(where);
	if (predicate?.params.length !== 0) return false;

	const literalMatch = predicate.sql.match(
		/^(?:status = '([^']*)'|'([^']*)' = status)$/i,
	);
	return (literalMatch?.[1] ?? literalMatch?.[2]) === "pending";
}

function isPendingExpansionPredicate(where: SQL | undefined): boolean {
	const predicate = predicateQuery(where);
	if (predicate?.params.length !== 0) return false;

	const literalMatch = predicate.sql.match(
		/^(?:expansion_status = '([^']*)'|'([^']*)' = expansion_status)$/i,
	);
	return (literalMatch?.[1] ?? literalMatch?.[2]) === "pending";
}

function isIdempotencyKeyNotNullPredicate(where: SQL | undefined): boolean {
	const predicate = predicateQuery(where);

	return (
		predicate?.params.length === 0 &&
		/^idempotency_key\s+is\s+not\s+null$/i.test(predicate.sql)
	);
}

function uniqueDefinitions(table: Table) {
	const config = getTableConfig(table);

	return [
		...config.indexes
			.filter((index) => index.config.unique)
			.map((index) => ({
				columns: columnNames(index.config.columns),
				where: index.config.where,
			})),
		...config.uniqueConstraints.map((constraint) => ({
			columns: constraint.columns.map((column) => column.name),
			where: undefined,
		})),
	];
}

function hasUniqueColumns(
	table: Table,
	columns: string[],
	options: { predicate?: (where: SQL | undefined) => boolean } = {},
): boolean {
	return uniqueDefinitions(table).some((definition) => {
		const predicateMatches = options.predicate
			? options.predicate(definition.where)
			: definition.where === undefined;

		return (
			definition.columns !== undefined &&
			definition.columns.length === columns.length &&
			columns.every(
				(column, index) => definition.columns?.[index] === column,
			) &&
			predicateMatches
		);
	});
}

function expectColumnsNotNull(table: Table, columns: string[]): void {
	const tableColumns = getTableConfig(table).columns;

	for (const columnName of columns) {
		const column = tableColumns.find(
			(candidate) => candidate.name === columnName,
		);

		expect(column, `${getTableConfig(table).name}.${columnName}`).toBeDefined();
		expect(column?.notNull, `${getTableConfig(table).name}.${columnName}`).toBe(
			true,
		);
	}
}

function hasCompositeForeignKey(
	table: Table,
	columns: string[],
	foreignTable: Table,
	foreignColumns: string[],
): boolean {
	return getTableConfig(table).foreignKeys.some((foreignKey) => {
		const reference = foreignKey.reference();

		return (
			reference.columns.map((column) => column.name).join(",") ===
				columns.join(",") &&
			reference.foreignColumns.map((column) => column.name).join(",") ===
				foreignColumns.join(",") &&
			reference.foreignColumns.every((column) => column.table === foreignTable)
		);
	});
}

function matchingForeignKey(
	table: Table,
	columns: string[],
	foreignTable: Table,
	foreignColumns: string[],
) {
	return getTableConfig(table).foreignKeys.find((foreignKey) => {
		const reference = foreignKey.reference();

		return (
			reference.columns.map((column) => column.name).join(",") ===
				columns.join(",") &&
			reference.foreignColumns.map((column) => column.name).join(",") ===
				foreignColumns.join(",") &&
			reference.foreignColumns.every((column) => column.table === foreignTable)
		);
	});
}

function hasForeignKeyColumns(table: Table, columns: string[]): boolean {
	return getTableConfig(table).foreignKeys.some(
		(foreignKey) =>
			foreignKey
				.reference()
				.columns.map((column) => column.name)
				.join(",") === columns.join(","),
	);
}

function namedCheckQuery(
	table: Table,
	name: string,
): { sql: string; params: unknown[] } | undefined {
	const constraint = getTableConfig(table).checks.find(
		(checkConstraint) => checkConstraint.name === name,
	);
	if (!constraint) return undefined;

	const query = new PgDialect().sqlToQuery(constraint.value);
	return { sql: normalizePredicateSql(query.sql), params: query.params };
}

describe("canonical approval workflow schema", () => {
	it("exports every canonical workflow and projection table", () => {
		const barrelExports = [
			businessSchema.approvalWorkflow,
			businessSchema.approvalWorkflowStage,
			businessSchema.approvalStageAssignment,
			businessSchema.approvalWorkflowEvent,
			businessSchema.approvalWorkflowCommand,
			businessSchema.approvalRequesterProjection,
			businessSchema.approvalInboxProjection,
			businessSchema.approvalOutbox,
			businessSchema.approvalOutboxDelivery,
			businessSchema.approvalWorkflowRollout,
			businessSchema.approvalWorkflowMigrationIssue,
		];

		for (const [index, table] of canonicalTables.entries()) {
			expect(table).toBeDefined();
			expect(barrelExports[index]).toBe(table);
		}
	});

	it("provides organization-scoped parent keys and workflow relationships", () => {
		for (const table of canonicalTables) {
			const organizationColumn = getTableConfig(table).columns.find(
				(column) => column.name === "organization_id",
			);

			expect(organizationColumn).toBeDefined();
			expect(organizationColumn?.notNull).toBe(true);
		}

		for (const table of [
			approvalWorkflow,
			approvalWorkflowStage,
			approvalOutbox,
		]) {
			expect(hasUniqueColumns(table, ["id", "organization_id"])).toBe(true);
		}

		for (const table of [
			approvalWorkflowStage,
			approvalWorkflowEvent,
			approvalWorkflowCommand,
			approvalRequesterProjection,
			approvalWorkflowMigrationIssue,
		]) {
			expect(
				hasCompositeForeignKey(
					table,
					["workflow_id", "organization_id"],
					approvalWorkflow,
					["id", "organization_id"],
				),
			).toBe(true);
		}

		expect(
			hasCompositeForeignKey(
				approvalStageAssignment,
				["workflow_id", "stage_id", "organization_id"],
				approvalWorkflowStage,
				["workflow_id", "id", "organization_id"],
			),
		).toBe(true);
		expect(
			hasCompositeForeignKey(
				approvalOutboxDelivery,
				["outbox_id", "organization_id", "disposition"],
				approvalOutbox,
				["id", "organization_id", "disposition"],
			),
		).toBe(true);
	});

	it("keeps each outbox event inside its workflow and organization", () => {
		expect(
			hasUniqueColumns(approvalWorkflowEvent, [
				"workflow_id",
				"id",
				"organization_id",
				"event_type",
			]),
		).toBe(true);
		expect(
			hasCompositeForeignKey(
				approvalOutbox,
				["workflow_id", "event_id", "organization_id", "event_type"],
				approvalWorkflowEvent,
				["workflow_id", "id", "organization_id", "event_type"],
			),
		).toBe(true);
		expect(
			hasForeignKeyColumns(approvalOutbox, ["workflow_id", "organization_id"]),
		).toBe(false);
		expect(
			hasForeignKeyColumns(approvalOutbox, [
				"workflow_id",
				"event_id",
				"organization_id",
			]),
		).toBe(false);
		expect(
			matchingForeignKey(
				approvalWorkflowEvent,
				["workflow_id", "organization_id"],
				approvalWorkflow,
				["id", "organization_id"],
			)?.onDelete,
		).toBe("cascade");
		expect(
			matchingForeignKey(
				approvalOutbox,
				["workflow_id", "event_id", "organization_id", "event_type"],
				approvalWorkflowEvent,
				["workflow_id", "id", "organization_id", "event_type"],
			)?.onDelete,
		).toBe("cascade");
	});

	it("models durable expansion and terminal observe suppression states", () => {
		expect
			.soft(APPROVAL_ACTOR_KINDS)
			.toEqual(["employee", "system", "legacy_unknown"]);
		expect
			.soft(APPROVAL_OUTBOX_STATUSES)
			.toEqual(["pending", "processing", "delivered", "failed", "suppressed"]);
		expect
			.soft(APPROVAL_OUTBOX_EXPANSION_STATUSES)
			.toEqual(["pending", "expanded"]);

		expect
			.soft(approvalActorKindEnum.enumValues)
			.toEqual(["employee", "system", "legacy_unknown"]);
		expect
			.soft(approvalOutboxStatusEnum.enumValues)
			.toEqual(["pending", "processing", "delivered", "failed", "suppressed"]);
		expect
			.soft(approvalOutboxExpansionStatusEnum.enumValues)
			.toEqual(["pending", "expanded"]);

		const outboxColumns = getTableConfig(approvalOutbox).columns;
		const expansionStatus = outboxColumns.find(
			(column) => column.name === "expansion_status",
		);
		const expandedAt = outboxColumns.find(
			(column) => column.name === "expanded_at",
		);
		expect.soft(approvalWorkflowEvent.actorKind.notNull).toBe(true);
		expect.soft(expansionStatus?.notNull).toBe(true);
		expect.soft(expansionStatus?.default).toBe("pending");
		expect.soft(expandedAt?.notNull).toBe(false);
		expect.soft(expandedAt?.getSQLType() ?? "").toContain("with time zone");
	});

	it("keeps delivery disposition equal to its parent outbox", () => {
		expect(
			hasUniqueColumns(approvalOutbox, [
				"id",
				"organization_id",
				"disposition",
			]),
		).toBe(true);
		expect(
			hasCompositeForeignKey(
				approvalOutboxDelivery,
				["outbox_id", "organization_id", "disposition"],
				approvalOutbox,
				["id", "organization_id", "disposition"],
			),
		).toBe(true);
		expect(
			hasForeignKeyColumns(approvalOutboxDelivery, [
				"outbox_id",
				"organization_id",
			]),
		).toBe(false);
		expect(
			matchingForeignKey(
				approvalOutboxDelivery,
				["outbox_id", "organization_id", "disposition"],
				approvalOutbox,
				["id", "organization_id", "disposition"],
			)?.onDelete,
		).toBe("cascade");
	});

	it("indexes pending outbox expansion claims in creation order", () => {
		const indexName = "approvalOutbox_pendingExpansion_createdAt_idx";
		const pendingExpansionIndex = getTableConfig(approvalOutbox).indexes.find(
			(indexDefinition) => indexDefinition.config.name === indexName,
		);

		expect(indexName.length).toBeLessThanOrEqual(63);
		expect(pendingExpansionIndex).toBeDefined();
		expect(pendingExpansionIndex?.config.unique).toBe(false);
		expect(columnNames(pendingExpansionIndex?.config.columns ?? [])).toEqual([
			"expansion_status",
			"created_at",
		]);
		expect(
			isPendingExpansionPredicate(pendingExpansionIndex?.config.where),
		).toBe(true);
	});

	it("supports optimistic workflow updates and one active workflow per exact typed source", () => {
		expect(approvalWorkflow.version).toBeDefined();
		expect(approvalWorkflow.version.notNull).toBe(true);
		expect(
			hasUniqueColumns(
				approvalWorkflow,
				["organization_id", "workflow_type", "source_type", "source_id"],
				{ predicate: isPendingOnlyPredicate },
			),
		).toBe(true);
		expect(
			hasUniqueColumns(
				approvalWorkflow,
				["organization_id", "source_type", "source_id"],
				{ predicate: isPendingOnlyPredicate },
			),
		).toBe(false);
	});

	it("keeps columns that guarantee canonical uniqueness non-null", () => {
		expectColumnsNotNull(approvalWorkflow, [
			"id",
			"organization_id",
			"workflow_type",
			"source_id",
		]);
		expectColumnsNotNull(approvalWorkflowStage, [
			"id",
			"organization_id",
			"workflow_id",
			"stage_order",
		]);
		expectColumnsNotNull(approvalStageAssignment, [
			"organization_id",
			"workflow_id",
			"stage_id",
			"assignment_sequence",
			"approver_employee_id",
		]);
		expect(approvalStageAssignment.approverEmployeeId.name).toBe(
			"approver_employee_id",
		);
		expect(
			getTableConfig(approvalStageAssignment).columns.some(
				(column) => column.name === "actor_kind" || column.name === "actor_id",
			),
		).toBe(false);
		expect(
			hasCompositeForeignKey(
				approvalStageAssignment,
				["approver_employee_id", "organization_id"],
				employee,
				["id", "organization_id"],
			),
		).toBe(true);
		const reassignedByEmployeeColumn = getTableConfig(
			approvalStageAssignment,
		).columns.find((column) => column.name === "reassigned_by_employee_id");
		expect(reassignedByEmployeeColumn).toBeDefined();
		expect(reassignedByEmployeeColumn?.notNull).toBe(false);
		expect(
			hasCompositeForeignKey(
				approvalStageAssignment,
				["reassigned_by_employee_id", "organization_id"],
				employee,
				["id", "organization_id"],
			),
		).toBe(true);
		expectColumnsNotNull(approvalWorkflowEvent, [
			"organization_id",
			"workflow_id",
			"version",
			"event_index",
		]);
		expectColumnsNotNull(approvalWorkflowCommand, [
			"organization_id",
			"workflow_id",
			"idempotency_key",
		]);
		expectColumnsNotNull(approvalOutbox, [
			"id",
			"organization_id",
			"workflow_id",
			"event_id",
			"event_type",
			"dedupe_key",
		]);
		expectColumnsNotNull(approvalOutboxDelivery, [
			"organization_id",
			"outbox_id",
			"disposition",
			"channel",
		]);
	});

	it("keeps assignment history ordered while preventing duplicate pending assignees", () => {
		expect(
			hasUniqueColumns(approvalWorkflowStage, [
				"organization_id",
				"workflow_id",
				"stage_order",
			]),
		).toBe(true);
		expect(
			hasUniqueColumns(approvalStageAssignment, [
				"organization_id",
				"workflow_id",
				"stage_id",
				"assignment_sequence",
			]),
		).toBe(true);
		expect(
			hasUniqueColumns(
				approvalStageAssignment,
				["organization_id", "workflow_id", "stage_id", "approver_employee_id"],
				{ predicate: isPendingOnlyPredicate },
			),
		).toBe(true);
		expect(
			hasUniqueColumns(approvalStageAssignment, [
				"organization_id",
				"workflow_id",
				"stage_id",
				"approver_employee_id",
			]),
		).toBe(false);
		expect(
			hasUniqueColumns(approvalStageAssignment, [
				"workflow_id",
				"stage_id",
				"id",
				"organization_id",
			]),
		).toBe(true);
		expect(
			hasCompositeForeignKey(
				approvalStageAssignment,
				[
					"workflow_id",
					"stage_id",
					"reassigned_from_assignment_id",
					"organization_id",
				],
				approvalStageAssignment,
				["workflow_id", "stage_id", "id", "organization_id"],
			),
		).toBe(true);
		expect(
			hasForeignKeyColumns(approvalStageAssignment, [
				"reassigned_from_assignment_id",
				"organization_id",
			]),
		).toBe(false);
	});

	it("keeps inbox workflow and active stage identity coherent", () => {
		expect(
			hasCompositeForeignKey(
				approvalInboxProjection,
				["workflow_id", "active_stage_id", "organization_id"],
				approvalWorkflowStage,
				["workflow_id", "id", "organization_id"],
			),
		).toBe(true);
		expect(
			hasForeignKeyColumns(approvalInboxProjection, [
				"workflow_id",
				"organization_id",
			]),
		).toBe(false);
		expect(
			hasForeignKeyColumns(approvalInboxProjection, [
				"active_stage_id",
				"organization_id",
			]),
		).toBe(false);
	});

	it("enforces event ordering and organization-scoped event idempotency", () => {
		expect(approvalWorkflowEvent.idempotencyKey.notNull).toBe(false);
		expect(
			hasUniqueColumns(approvalWorkflowEvent, [
				"organization_id",
				"workflow_id",
				"version",
				"event_index",
			]),
		).toBe(true);
		expect(
			hasUniqueColumns(
				approvalWorkflowEvent,
				["organization_id", "idempotency_key"],
				{ predicate: isIdempotencyKeyNotNullPredicate },
			),
		).toBe(true);
	});

	it("deduplicates commands, outbox messages, and fanout deliveries per organization", () => {
		expect(
			hasUniqueColumns(approvalWorkflowCommand, [
				"organization_id",
				"workflow_id",
				"idempotency_key",
			]),
		).toBe(true);
		expect(
			hasUniqueColumns(approvalOutbox, ["organization_id", "dedupe_key"]),
		).toBe(true);
		expect(
			hasUniqueColumns(approvalOutboxDelivery, [
				"organization_id",
				"dedupe_key",
			]),
		).toBe(true);
		expect(
			hasUniqueColumns(approvalOutboxDelivery, [
				"organization_id",
				"outbox_id",
				"channel",
			]),
		).toBe(false);
	});

	it("keeps every expansion source link nullable and organization-contained", () => {
		for (const table of [
			absenceEntry,
			workPeriod,
			travelExpenseClaim,
			shiftRequest,
			complianceException,
		]) {
			const workflowColumn = getTableConfig(table).columns.find(
				(column) => column.name === "approval_workflow_id",
			);

			expect(
				workflowColumn,
				`${getTableConfig(table).name}.approval_workflow_id`,
			).toBeDefined();
			expect(workflowColumn?.notNull).toBe(false);
			expect(
				hasCompositeForeignKey(
					table,
					["approval_workflow_id", "organization_id"],
					approvalWorkflow,
					["id", "organization_id"],
				),
			).toBe(true);
		}

		for (const table of [workPeriod, travelExpenseClaim, complianceException]) {
			const organizationColumn = getTableConfig(table).columns.find(
				(column) => column.name === "organization_id",
			);
			expect(organizationColumn?.notNull, getTableConfig(table).name).toBe(
				true,
			);
		}
	});

	it("closes nullable organization bypasses for absence and shift workflow links", () => {
		for (const [table, constraintName] of [
			[absenceEntry, "absence_entry_approval_workflow_organization_check"],
			[shiftRequest, "shift_request_approval_workflow_organization_check"],
		] as const) {
			const predicate = namedCheckQuery(table, constraintName);
			expect.soft(predicate, constraintName).toBeDefined();
			expect
				.soft(predicate?.params ?? null, `${constraintName} params`)
				.toEqual([]);
			expect
				.soft(predicate?.sql ?? "", `${constraintName} SQL`)
				.toMatch(
					/^approval_workflow_id\s+is\s+null\s+or\s+organization_id\s+is\s+not\s+null$/i,
				);
		}
	});

	it("cascades tenant-owned nullable organization links on organization deletion", () => {
		for (const table of [absenceEntry, shiftRequest]) {
			const organizationColumn = getTableConfig(table).columns.find(
				(column) => column.name === "organization_id",
			);
			const organizationForeignKey = matchingForeignKey(
				table,
				["organization_id"],
				authSchema.organization,
				["id"],
			);

			expect(organizationColumn?.notNull, getTableConfig(table).name).toBe(
				false,
			);
			expect(organizationForeignKey, getTableConfig(table).name).toBeDefined();
			expect(organizationForeignKey?.onDelete).toBe("cascade");
		}
	});

	it("contains nullable shift request organizations within the referenced shift", () => {
		expect(hasUniqueColumns(shift, ["organization_id", "id"])).toBe(true);
		expect(
			hasCompositeForeignKey(
				shiftRequest,
				["organization_id", "shift_id"],
				shift,
				["organization_id", "id"],
			),
		).toBe(true);
		expect(hasForeignKeyColumns(shiftRequest, ["shift_id"])).toBe(true);
		expect(shiftRequest.organizationId.notNull).toBe(false);
	});

	it("keeps shift rollout fields nullable and notifications idempotent per organization", () => {
		expect(shiftRequest.organizationId.notNull).toBe(false);
		expect(shiftRequest.lifecycleStatus.notNull).toBe(false);
		expect(shiftRequest.lifecycleStatus.getSQLType()).toBe(
			"shift_request_status",
		);
		expect(notification.idempotencyKey.notNull).toBe(false);
		expect(
			hasUniqueColumns(notification, ["organization_id", "idempotency_key"], {
				predicate: isIdempotencyKeyNotNullPredicate,
			}),
		).toBe(true);
	});

	it("retains the nullable legacy request identifier without a runtime foreign key", async () => {
		expect(approvalWorkflowStage.legacyApprovalRequestId.notNull).toBe(false);
		expect(
			hasForeignKeyColumns(approvalWorkflowStage, [
				"legacy_approval_request_id",
				"organization_id",
			]),
		).toBe(false);
		await expect(import("../absence")).resolves.toHaveProperty("absenceEntry");
	});

	it("normalizes canonical workflow and organization inverse relations", () => {
		const { tables, tableNamesMap } = extractTablesRelationalConfig(
			{ ...authSchema, ...businessSchema },
			createTableRelationsHelpers,
		);
		const relationFields = [
			["organization", "approvalWorkflows"],
			["organization", "approvalWorkflowStages"],
			["organization", "approvalStageAssignments"],
			["organization", "approvalWorkflowEvents"],
			["organization", "approvalWorkflowCommands"],
			["organization", "approvalRequesterProjections"],
			["organization", "approvalInboxProjections"],
			["organization", "approvalOutboxMessages"],
			["organization", "approvalOutboxDeliveries"],
			["organization", "approvalWorkflowRollouts"],
			["organization", "approvalWorkflowMigrationIssues"],
			["organization", "shiftRequests"],
			["approvalStageAssignment", "approver"],
			["approvalStageAssignment", "resolvedByActor"],
			["approvalStageAssignment", "reassignedByEmployee"],
			["approvalStageAssignment", "reassignedFromAssignment"],
			["approvalWorkflowEvent", "actorUser"],
			["approvalWorkflowMigrationIssue", "operatorUser"],
		] as const;

		for (const [tableName, fieldName] of relationFields) {
			const relation = tables[tableName]?.relations[fieldName];
			expect(relation, `${tableName}.${fieldName}`).toBeDefined();
			if (!relation)
				throw new Error(`Missing relation ${tableName}.${fieldName}`);
			expect(() =>
				normalizeRelation(tables, tableNamesMap, relation),
			).not.toThrow();
		}

		const assignmentStage = tables.approvalStageAssignment.relations.stage;
		expect(assignmentStage).toBeDefined();
		if (!assignmentStage) throw new Error("Missing assignment stage relation");
		const assignmentStageRelation = normalizeRelation(
			tables,
			tableNamesMap,
			assignmentStage,
		);
		expect(assignmentStageRelation.fields.map((column) => column.name)).toEqual(
			["workflow_id", "stage_id", "organization_id"],
		);
		expect(
			assignmentStageRelation.references.map((column) => column.name),
		).toEqual(["workflow_id", "id", "organization_id"]);

		const outboxEvent = tables.approvalOutbox.relations.event;
		expect(outboxEvent).toBeDefined();
		if (!outboxEvent) throw new Error("Missing outbox event relation");
		const outboxEventRelation = normalizeRelation(
			tables,
			tableNamesMap,
			outboxEvent,
		);
		expect(outboxEventRelation.fields.map((column) => column.name)).toEqual([
			"workflow_id",
			"event_id",
			"organization_id",
			"event_type",
		]);
		expect(outboxEventRelation.references.map((column) => column.name)).toEqual(
			["workflow_id", "id", "organization_id", "event_type"],
		);

		const deliveryOutbox = tables.approvalOutboxDelivery.relations.outbox;
		expect(deliveryOutbox).toBeDefined();
		if (!deliveryOutbox) throw new Error("Missing delivery outbox relation");
		const deliveryOutboxRelation = normalizeRelation(
			tables,
			tableNamesMap,
			deliveryOutbox,
		);
		expect(deliveryOutboxRelation.fields.map((column) => column.name)).toEqual([
			"outbox_id",
			"organization_id",
			"disposition",
		]);
		expect(
			deliveryOutboxRelation.references.map((column) => column.name),
		).toEqual(["id", "organization_id", "disposition"]);

		const shiftRequestShift = tables.shiftRequest.relations.shift;
		expect(shiftRequestShift).toBeDefined();
		if (!shiftRequestShift)
			throw new Error("Missing shift request shift relation");
		const shiftRequestShiftRelation = normalizeRelation(
			tables,
			tableNamesMap,
			shiftRequestShift,
		);
		expect(
			shiftRequestShiftRelation.fields.map((column) => column.name),
		).toEqual(["shift_id"]);
		expect(
			shiftRequestShiftRelation.references.map((column) => column.name),
		).toEqual(["id"]);

		const organizationScopedShift =
			tables.shiftRequest.relations.organizationScopedShift;
		expect(organizationScopedShift).toBeDefined();
		if (!organizationScopedShift)
			throw new Error("Missing organization-scoped shift relation");
		const organizationScopedShiftRelation = normalizeRelation(
			tables,
			tableNamesMap,
			organizationScopedShift,
		);
		expect(
			organizationScopedShiftRelation.fields.map((column) => column.name),
		).toEqual(["organization_id", "shift_id"]);
		expect(
			organizationScopedShiftRelation.references.map((column) => column.name),
		).toEqual(["organization_id", "id"]);

		const reassignedFromAssignment =
			tables.approvalStageAssignment.relations.reassignedFromAssignment;
		expect(reassignedFromAssignment).toBeDefined();
		if (!reassignedFromAssignment)
			throw new Error("Missing reassignment chain relation");
		const reassignmentRelation = normalizeRelation(
			tables,
			tableNamesMap,
			reassignedFromAssignment,
		);
		expect(reassignmentRelation.fields.map((column) => column.name)).toEqual([
			"workflow_id",
			"stage_id",
			"reassigned_from_assignment_id",
			"organization_id",
		]);
		expect(
			reassignmentRelation.references.map((column) => column.name),
		).toEqual(["workflow_id", "stage_id", "id", "organization_id"]);
	});

	it("stores lifecycle instants as timezone-aware timestamps", () => {
		for (const requirement of requiredLifecycleTimestamps) {
			const config = getTableConfig(requirement.table);

			for (const columnName of requirement.columns) {
				const column = config.columns.find(
					(candidate) => candidate.name === columnName,
				);

				expect(column, `${config.name}.${columnName}`).toBeDefined();
				expect(column?.getSQLType(), `${config.name}.${columnName}`).toContain(
					"with time zone",
				);
			}

			const timestampColumns = config.columns.filter((column) =>
				column.columnType.startsWith("PgTimestamp"),
			);

			for (const column of timestampColumns) {
				expect(column.getSQLType(), `${config.name}.${column.name}`).toContain(
					"with time zone",
				);
			}
		}
	});
});
