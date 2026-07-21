/**
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 container.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	APPROVAL_EXPANSION_CONTRACT,
	type ApprovalExpansionCatalog,
	type ApprovalExpansionContract,
	loadAndValidateApprovalExpansionSchema,
	validateApprovalExpansionCatalog,
} from "../../../../scripts/approval-workflow-schema-contract";
import type { ApprovalDomainAdapterRegistry } from "../domain-adapters/registry";
import type { LegacyApprovalRowWriter } from "./compatibility-writer";
import {
	deriveApprovalAssignmentId,
	deriveApprovalEventId,
	deriveApprovalStageId,
	deriveApprovalWorkflowId,
} from "./identity";
import type {
	ApprovalCommandResult,
	ApprovalMaterializedTransitionPlan,
	ApprovalWorkflowEventSnapshot,
	ApprovalWorkflowSnapshot,
	StageActivationResolver,
} from "./ports";
import {
	type ApprovalWorkflowDatabase,
	createApprovalWorkflowRepository,
} from "./repository";
import {
	resolveApprovalWorkflowRepositoryTestConfiguration,
	verifyApprovalWorkflowRepositoryTestDatabase,
} from "./repository-integration-harness";

const databaseUrl = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL;
const testSentinel = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL;
const integrationRequired =
	process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_REQUIRED === "1";
const integrationConfiguration =
	resolveApprovalWorkflowRepositoryTestConfiguration({
		databaseUrl,
		required: integrationRequired,
		sentinel: testSentinel,
	});
if (integrationConfiguration.status === "error") {
	throw new Error(
		`Invalid approval workflow repository test configuration: ${integrationConfiguration.reason}`,
	);
}
const describeIntegration =
	integrationConfiguration.status === "enabled" ? describe : describe.skip;
if (integrationConfiguration.status === "unavailable") {
	describe.skip(`approval workflow repository PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}
const organizationOne = "integration-org-1";
const organizationTwo = "integration-org-2";
const userOne = "integration-user-1";
const userTwo = "integration-user-2";
const workflowOne = "10000000-0000-4000-8000-000000000011";
const workflowTwo = "10000000-0000-4000-8000-000000000012";
const sourceOne = "20000000-0000-4000-8000-000000000011";
const employeeOne = "30000000-0000-4000-8000-000000000011";
const employeeTwo = "30000000-0000-4000-8000-000000000012";
const stageOne = "40000000-0000-4000-8000-000000000011";
const assignmentOne = "50000000-0000-4000-8000-000000000011";
const eventOne = "60000000-0000-4000-8000-000000000011";
const initialSource = "20000000-0000-4000-8000-000000000021";
const now = parseInstant("2026-07-16T12:00:00Z");
const repositoryPersistenceTables = [
	"approval_workflow",
	"approval_workflow_stage",
	"approval_stage_assignment",
	"approval_workflow_event",
	"approval_workflow_command",
	"approval_requester_projection",
	"approval_inbox_projection",
	"approval_outbox",
	"approval_outbox_delivery",
	"approval_workflow_rollout",
	"approval_workflow_migration_issue",
] as const;
const repositoryCatalogTables = new Set([
	...repositoryPersistenceTables,
	...APPROVAL_EXPANSION_CONTRACT.sourceTables,
]);
const repositoryCatalogContract: ApprovalExpansionContract = {
	tables: repositoryPersistenceTables,
	operationalTables: [],
	sourceTables: APPROVAL_EXPANSION_CONTRACT.sourceTables,
	relations: [
		...repositoryPersistenceTables.map((name) => ({
			name,
			mode: "full" as const,
		})),
		...APPROVAL_EXPANSION_CONTRACT.sourceTables.map((name) => ({
			name,
			mode: "required_subset" as const,
		})),
	],
	enums: APPROVAL_EXPANSION_CONTRACT.enums,
	columns: APPROVAL_EXPANSION_CONTRACT.columns.filter((column) =>
		repositoryCatalogTables.has(column.table),
	),
	foreignKeys: APPROVAL_EXPANSION_CONTRACT.foreignKeys.filter((foreignKey) =>
		repositoryCatalogTables.has(foreignKey.table),
	),
	indexes: APPROVAL_EXPANSION_CONTRACT.indexes.filter((index) =>
		repositoryCatalogTables.has(index.table),
	),
	checks: APPROVAL_EXPANSION_CONTRACT.checks.filter((check) =>
		repositoryCatalogTables.has(check.table),
	),
};

function catalogEvidence(
	catalog: ApprovalExpansionCatalog,
	contract: ApprovalExpansionContract,
) {
	const requiredColumns = new Set(
		contract.columns.map((column) => `${column.table}\0${column.name}`),
	);
	const requiredForeignKeys = new Set(
		contract.foreignKeys.map((foreignKey) => foreignKey.name),
	);
	const requiredIndexes = new Set(contract.indexes.map((index) => index.name));
	const requiredChecks = new Set(contract.checks.map((check) => check.name));
	return {
		...catalog,
		tables: [...catalog.tables].sort(),
		operationalTables: [...catalog.operationalTables].sort(),
		sourceTables: [...catalog.sourceTables].sort(),
		columns: catalog.columns
			.filter((column) =>
				requiredColumns.has(`${column.table}\0${column.name}`),
			)
			.map((column) => `${column.table}.${column.name}`)
			.sort(),
		foreignKeys: catalog.foreignKeys
			.filter((foreignKey) => requiredForeignKeys.has(foreignKey.name))
			.map((foreignKey) => foreignKey.name)
			.sort(),
		indexes: catalog.indexes
			.filter((index) => requiredIndexes.has(index.name))
			.map((index) => index.name)
			.sort(),
		checks: catalog.checks
			.filter((check) => requiredChecks.has(check.name))
			.map((check) => check.name)
			.sort(),
	};
}

async function waitForTransactionLock(
	observer: Pool,
	applicationName: string,
	timeoutMilliseconds = 5_000,
) {
	const deadline = Date.now() + timeoutMilliseconds;
	while (true) {
		const activity = await observer.query<{
			wait_event: string | null;
			wait_event_type: string | null;
		}>(
			`select wait_event, wait_event_type
			from pg_stat_activity
			where application_name = $1
				and wait_event_type = 'Lock'
				and wait_event = 'transactionid'`,
			[applicationName],
		);
		if (activity.rows.length === 1) return activity.rows[0];
		if (Date.now() >= deadline) {
			throw new Error(
				`Timed out waiting for transaction lock from ${applicationName}`,
			);
		}
		await new Promise<void>((resolve) => setTimeout(resolve, 25));
	}
}

function createClaimBarrier() {
	let resolveClaimed: (() => void) | undefined;
	let rejectClaimed: ((cause: unknown) => void) | undefined;
	const claimed = new Promise<void>((resolve, reject) => {
		resolveClaimed = resolve;
		rejectClaimed = reject;
	});
	return {
		claimed,
		markClaimed: () => resolveClaimed?.(),
		rejectClaimed: (cause: unknown) => rejectClaimed?.(cause),
	};
}

function snapshot(
	organizationId: string,
	workflowId: string,
	version = 1,
): ApprovalWorkflowSnapshot {
	const requesterEmployeeId =
		organizationId === organizationOne ? employeeOne : employeeTwo;
	return {
		id: workflowId,
		organizationId,
		workflowType: "absence",
		sourceType: "absence_entry",
		sourceId: sourceOne,
		requesterEmployeeId,
		status: "approved",
		currentStageOrder: null,
		version,
		policySnapshot: { kind: "standard" },
		contextSnapshot: {},
		displaySnapshot: { title: "Integration" },
		submittedAt: now,
		completedAt: now,
		cancelledAt: null,
		decisionReason: null,
		stages: [],
	};
}

function commandResult(
	organizationId: string,
	workflowId: string,
): ApprovalCommandResult {
	const requesterEmployeeId =
		organizationId === organizationOne ? employeeOne : employeeTwo;
	return {
		snapshot: snapshot(organizationId, workflowId),
		events: [
			{
				id: eventOne,
				organizationId,
				workflowId,
				version: 1,
				eventIndex: 0,
				eventType: "workflow.approved",
				actor: { kind: "system", employeeId: null, userId: null },
				previousState: { status: "pending" },
				resultingState: { status: "approved" },
				reason: null,
				metadata: null,
				references: {},
				idempotencyKey: "integration-result",
				occurredAt: now,
			},
		],
		projection: {
			organizationId,
			workflowId,
			workflowType: "absence",
			sourceType: "absence_entry",
			sourceId: sourceOne,
			status: "approved",
			currentStageOrder: null,
			requesterEmployeeId,
			displayPayload: { title: "Integration" },
			searchText: "integration",
			activeInboxStage: null,
			updatedAt: now,
		},
		outbox: [],
	};
}

function initialWorkflowInput(
	organizationId = organizationOne,
	submissionKey = "integration-initial-submit",
	workflowType: "absence" | "travel_expense" = "absence",
): {
	snapshot: ApprovalWorkflowSnapshot;
	events: ApprovalWorkflowEventSnapshot[];
	submissionKey: string;
} {
	const requesterEmployeeId =
		organizationId === organizationOne ? employeeOne : employeeTwo;
	const workflowId = deriveApprovalWorkflowId({
		organizationId,
		workflowType,
		sourceType: "absence_entry",
		sourceId: initialSource,
		allocationKey: submissionKey,
	});
	const stageId = deriveApprovalStageId({
		organizationId,
		workflowId,
		allocationKey: "stage:1",
	});
	const assignmentId = deriveApprovalAssignmentId({
		organizationId,
		workflowId,
		allocationKey: `${workflowId}:stage:${stageId}:assignment:1`,
	});
	const snapshot: ApprovalWorkflowSnapshot = {
		id: workflowId,
		organizationId,
		workflowType,
		sourceType: "absence_entry",
		sourceId: initialSource,
		requesterEmployeeId,
		status: "pending",
		currentStageOrder: 1,
		version: 1,
		policySnapshot: { kind: "standard" },
		contextSnapshot: { source: "integration" },
		displaySnapshot: {
			displayPayload: { title: "Initial integration" },
			searchText: "initial integration",
		},
		submittedAt: now,
		completedAt: null,
		cancelledAt: null,
		decisionReason: null,
		stages: [
			{
				id: stageId,
				organizationId,
				workflowId,
				sequence: 1,
				label: "Manager",
				resolverSnapshot: { kind: "manager" },
				activationMode: "human",
				status: "pending",
				activatedAt: now,
				decidedAt: null,
				decisionReason: null,
				legacyApprovalRequestId: null,
				assignments: [
					{
						id: assignmentId,
						organizationId,
						workflowId,
						stageId,
						sequence: 1,
						approverEmployeeId: requesterEmployeeId,
						status: "pending",
						assignedAt: now,
						resolvedAt: null,
						resolvedBy: null,
						reassignedByEmployeeId: null,
						reassignedFromAssignmentId: null,
						reassignmentMetadata: null,
					},
				],
			},
		],
	};
	return {
		snapshot,
		submissionKey,
		events: [
			{
				id: deriveApprovalEventId({
					organizationId,
					workflowId,
					allocationKey: `${workflowId}:event:1:0`,
				}),
				organizationId,
				workflowId,
				version: 1,
				eventIndex: 0,
				eventType: "assignment.created",
				actor: { kind: "system", employeeId: null, userId: null },
				previousState: null,
				resultingState: {
					approverEmployeeId: requesterEmployeeId,
					sequence: 1,
					status: "pending",
				},
				reason: null,
				metadata: null,
				references: { assignmentId },
				idempotencyKey: submissionKey,
				occurredAt: now,
			},
			{
				id: deriveApprovalEventId({
					organizationId,
					workflowId,
					allocationKey: `${workflowId}:event:1:1`,
				}),
				organizationId,
				workflowId,
				version: 1,
				eventIndex: 1,
				eventType: "stage.activated",
				actor: { kind: "system", employeeId: null, userId: null },
				previousState: { status: "waiting" },
				resultingState: { status: "pending" },
				reason: null,
				metadata: { stageId, stageOrder: 1 },
				references: {},
				idempotencyKey: `${submissionKey}:1`,
				occurredAt: now,
			},
		],
	};
}

function materializedPlan(): ApprovalMaterializedTransitionPlan {
	const resulting = snapshot(organizationOne, workflowOne, 2);
	const event = commandResult(organizationOne, workflowOne).events[0];
	if (!event) throw new Error("Invalid integration fixture");
	return {
		expectedVersion: 1,
		resultingSnapshot: resulting,
		changes: {
			root: {
				previous: {
					status: "pending",
					currentStageOrder: 1,
					version: 1,
					completedAt: null,
					cancelledAt: null,
					decisionReason: null,
				},
				resulting: {
					status: "approved",
					currentStageOrder: null,
					version: 2,
					completedAt: now,
					cancelledAt: null,
					decisionReason: null,
				},
			},
			stages: [],
			assignments: [],
		},
		events: [
			{
				...event,
				version: 2,
				idempotencyKey: null,
				persistenceMetadata: null,
			},
		],
		nextAction: {
			kind: "finalize_terminal",
			transition: {
				kind: "approve",
				from: "pending",
				to: "approved",
				reason: null,
			},
		},
	};
}

function materializedPlanWithChildUpdates(): ApprovalMaterializedTransitionPlan {
	const plan = materializedPlan();
	const pendingAssignment = {
		id: assignmentOne,
		organizationId: organizationOne,
		workflowId: workflowOne,
		stageId: stageOne,
		sequence: 1,
		approverEmployeeId: employeeOne,
		status: "pending" as const,
		assignedAt: now,
		resolvedAt: null,
		resolvedBy: null,
		reassignedByEmployeeId: null,
		reassignedFromAssignmentId: null,
		reassignmentMetadata: null,
	};
	const approvedAssignment = {
		...pendingAssignment,
		status: "approved" as const,
		resolvedAt: now,
		resolvedBy: {
			kind: "employee" as const,
			employeeId: employeeOne,
			userId: null,
		},
	};
	const pendingStage = {
		id: stageOne,
		organizationId: organizationOne,
		workflowId: workflowOne,
		sequence: 1,
		label: "Manager",
		resolverSnapshot: { kind: "manager" },
		activationMode: "human",
		status: "pending" as const,
		activatedAt: now,
		decidedAt: null,
		decisionReason: null,
		legacyApprovalRequestId: null,
		assignments: [pendingAssignment],
	};
	const approvedStage = {
		...pendingStage,
		status: "approved" as const,
		decidedAt: now,
		decisionReason: "approved",
		assignments: [approvedAssignment],
	};
	return {
		...plan,
		resultingSnapshot: {
			...plan.resultingSnapshot,
			stages: [approvedStage],
		},
		changes: {
			...plan.changes,
			stages: [
				{
					stageId: stageOne,
					previous: pendingStage,
					resulting: approvedStage,
				},
			],
			assignments: [
				{
					kind: "update",
					assignmentId: assignmentOne,
					previous: pendingAssignment,
					resulting: approvedAssignment,
				},
			],
		},
	};
}

describeIntegration("approval workflow repository PostgreSQL contract", () => {
	const pool = new Pool({ connectionString: databaseUrl, max: 8 });
	const database = drizzle({ client: pool });
	const repository = createApprovalWorkflowRepository({
		db: database as unknown as ApprovalWorkflowDatabase,
		adapterRegistry: {} as ApprovalDomainAdapterRegistry,
		activationResolver: {} as StageActivationResolver,
		createLegacyRowWriter: () =>
			({
				writeLegacyRows: async () => undefined,
			}) satisfies LegacyApprovalRowWriter,
		observationPlanner: {
			plan: async () => commandResult(organizationOne, workflowOne),
		},
		clock: { nowInstant: () => now },
	});

	beforeAll(async () => {
		const enabled = await verifyApprovalWorkflowRepositoryTestDatabase({
			databaseUrl,
			required: integrationRequired,
			sentinel: testSentinel,
			currentDatabase: async () => {
				const result = await pool.query<{ database_name: string }>(
					"select current_database() as database_name",
				);
				return result.rows[0]?.database_name ?? "";
			},
		});
		if (enabled.status !== "enabled") {
			throw new Error(
				"Approval workflow repository integration test is not enabled",
			);
		}
	});

	beforeEach(async () => {
		await pool.query(`
			delete from approval_outbox_delivery
			where organization_id in ('integration-org-1', 'integration-org-2');
			delete from approval_outbox
			where organization_id in ('integration-org-1', 'integration-org-2');
			delete from approval_inbox_projection
			where organization_id in ('integration-org-1', 'integration-org-2');
			delete from approval_requester_projection
			where organization_id in ('integration-org-1', 'integration-org-2');
			delete from approval_workflow_command
			where organization_id in ('integration-org-1', 'integration-org-2');
			delete from approval_workflow_event
			where organization_id in ('integration-org-1', 'integration-org-2');
			delete from approval_stage_assignment
			where organization_id in ('integration-org-1', 'integration-org-2');
			delete from approval_workflow_stage
			where organization_id in ('integration-org-1', 'integration-org-2');
			delete from approval_workflow_migration_issue
			where organization_id in ('integration-org-1', 'integration-org-2');
			delete from approval_workflow_rollout
			where organization_id in ('integration-org-1', 'integration-org-2');
			delete from approval_workflow
			where organization_id in ('integration-org-1', 'integration-org-2');
			delete from employee where id in (
				'30000000-0000-4000-8000-000000000011',
				'30000000-0000-4000-8000-000000000012'
			);
			delete from member where id in ('member-integration-org-1', 'member-integration-org-2');
			delete from "user" where id in ('integration-user-1', 'integration-user-2');
			delete from organization where id in ('integration-org-1', 'integration-org-2')
		`);
		await seedOrganizationGraph(organizationOne, userOne, employeeOne);
		await seedOrganizationGraph(organizationTwo, userTwo, employeeTwo);
		await seedRoot(organizationOne, workflowOne, employeeOne);
		await seedRoot(organizationTwo, workflowTwo, employeeTwo);
	});

	afterAll(async () => {
		await pool.end();
	});

	async function seedOrganizationGraph(
		organizationId: string,
		userId: string,
		employeeId: string,
	) {
		const timestamp = new Date(now.epochMilliseconds);
		await pool.query(
			`insert into organization (id, name, slug, created_at)
			 values ($1, $2, $3, $4)`,
			[
				organizationId,
				`Integration ${organizationId}`,
				organizationId,
				timestamp,
			],
		);
		await pool.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 values ($1, $2, $3, $4, $4)`,
			[userId, `Integration ${userId}`, `${userId}@example.test`, timestamp],
		);
		await pool.query(
			`insert into member (id, organization_id, user_id, role, created_at)
			 values ($1, $2, $3, 'member', $4)`,
			[`member-${organizationId}`, organizationId, userId, timestamp],
		);
		await pool.query(
			`insert into employee (id, user_id, organization_id, updated_at)
			 values ($1, $2, $3, $4)`,
			[employeeId, userId, organizationId, timestamp],
		);
	}

	async function seedRoot(
		organizationId: string,
		workflowId: string,
		requesterEmployeeId: string,
	) {
		await pool.query(
			`insert into approval_workflow (
				id, organization_id, workflow_type, source_type, source_id,
				requester_employee_id, status, current_stage_order, version,
				policy_snapshot, context_snapshot, display_snapshot, submitted_at,
				created_at, updated_at
			) values ($1, $2, 'absence', 'absence_entry', $3, $4, 'pending', 1, 1,
				'{}', '{}', '{}', $5, $5, $5)`,
			[
				workflowId,
				organizationId,
				sourceOne,
				requesterEmployeeId,
				new Date(now.epochMilliseconds),
			],
		);
	}

	async function seedStageAndAssignment() {
		const timestamp = new Date(now.epochMilliseconds);
		await pool.query(
			`insert into approval_workflow_stage (
				id, organization_id, workflow_id, stage_order, label,
				resolver_snapshot, activation_mode, status, activated_at,
				created_at, updated_at
			) values ($1, $2, $3, 1, 'Manager', $4::jsonb, 'human', 'pending', $5, $5, $5)`,
			[stageOne, organizationOne, workflowOne, '{"kind":"manager"}', timestamp],
		);
		await pool.query(
			`insert into approval_stage_assignment (
				id, organization_id, workflow_id, stage_id, assignment_sequence,
				approver_employee_id, status, assigned_at, created_at, updated_at
			) values ($1, $2, $3, $4, 1, $5, 'pending', $6, $6, $6)`,
			[
				assignmentOne,
				organizationOne,
				workflowOne,
				stageOne,
				employeeOne,
				timestamp,
			],
		);
	}

	async function persistedWorkflowState() {
		const normalize = (value: unknown): unknown => {
			if (Array.isArray(value)) return value.map(normalize);
			if (value !== null && typeof value === "object") {
				return Object.fromEntries(
					Object.entries(value)
						.sort(([left], [right]) => left.localeCompare(right))
						.map(([key, child]) => [key, normalize(child)]),
				);
			}
			return value;
		};
		const [root, stage, assignment, event] = await Promise.all([
			pool.query<{ row: unknown }>(
				`select to_jsonb(workflow_row) as row
				from approval_workflow workflow_row
				where organization_id = $1 and id = $2
				order by id`,
				[organizationOne, workflowOne],
			),
			pool.query<{ row: unknown }>(
				`select to_jsonb(stage_row) as row
				from approval_workflow_stage stage_row
				where organization_id = $1 and workflow_id = $2
				order by id`,
				[organizationOne, workflowOne],
			),
			pool.query<{ row: unknown }>(
				`select to_jsonb(assignment_row) as row
				from approval_stage_assignment assignment_row
				where organization_id = $1 and workflow_id = $2
				order by id`,
				[organizationOne, workflowOne],
			),
			pool.query<{ row: unknown }>(
				`select to_jsonb(event_row) as row
				from approval_workflow_event event_row
				where organization_id = $1 and workflow_id = $2
				order by id`,
				[organizationOne, workflowOne],
			),
		]);
		return {
			root: root.rows.map(({ row }) => normalize(row)),
			stage: stage.rows.map(({ row }) => normalize(row)),
			assignment: assignment.rows.map(({ row }) => normalize(row)),
			event: event.rows.map(({ row }) => normalize(row)),
		};
	}

	it("has the complete approval workflow persistence catalog from real migrations", async () => {
		const catalog = await loadAndValidateApprovalExpansionSchema(
			database as unknown as Parameters<
				typeof loadAndValidateApprovalExpansionSchema
			>[0],
			repositoryCatalogContract,
		);
		expect(catalog.tables).toEqual(
			expect.arrayContaining([
				"approval_outbox_delivery",
				"approval_workflow_rollout",
				"approval_workflow_migration_issue",
			]),
		);
		const expected: ApprovalExpansionCatalog = {
			tables: [...repositoryCatalogContract.tables],
			operationalTables: [...repositoryCatalogContract.operationalTables],
			sourceTables: [...repositoryCatalogContract.sourceTables],
			enums: { ...repositoryCatalogContract.enums },
			columns: [...repositoryCatalogContract.columns],
			foreignKeys: [...repositoryCatalogContract.foreignKeys],
			indexes: [...repositoryCatalogContract.indexes],
			checks: [...repositoryCatalogContract.checks],
		};
		expect(catalogEvidence(catalog, repositoryCatalogContract)).toEqual(
			catalogEvidence(expected, repositoryCatalogContract),
		);

		const missingRequiredIndex = {
			...catalog,
			indexes: catalog.indexes.filter(
				(index) => index.name !== "approvalWorkflowRollout_org_type_idx",
			),
		};
		expect(() =>
			validateApprovalExpansionCatalog(
				missingRequiredIndex,
				repositoryCatalogContract,
			),
		).toThrow("unique index approvalWorkflowRollout_org_type_idx");
	});

	it("commits an initial workflow root, ordered children, and immutable events together", async () => {
		const input = initialWorkflowInput();
		await expect(
			repository.withTransaction(async ({ repository: txRepository }) =>
				txRepository.createInitialWorkflow(input),
			),
		).resolves.toEqual({ kind: "created", snapshot: input.snapshot });

		const counts = await pool.query<{ entity: string; count: number }>(
			`select 'root' as entity, count(*)::int as count from approval_workflow
				where organization_id = $1 and id = $2
			union all
			select 'stage', count(*)::int from approval_workflow_stage
				where organization_id = $1 and workflow_id = $2
			union all
			select 'assignment', count(*)::int from approval_stage_assignment
				where organization_id = $1 and workflow_id = $2
			union all
			select 'event', count(*)::int from approval_workflow_event
				where organization_id = $1 and workflow_id = $2`,
			[organizationOne, input.snapshot.id],
		);
		expect(
			Object.fromEntries(
				counts.rows.map(({ entity, count }) => [entity, count]),
			),
		).toEqual({
			root: 1,
			stage: 1,
			assignment: 1,
			event: 2,
		});
	});

	it.each([
		"child",
		"event",
	] as const)("rolls back the initial root when an injected %s insert fails", async (failurePoint) => {
		const input = initialWorkflowInput();
		if (failurePoint === "child") {
			const assignment = input.snapshot.stages[0]?.assignments[0];
			if (!assignment) throw new Error("Invalid initial integration fixture");
			assignment.approverEmployeeId = "30000000-0000-4000-8000-000000000099";
		} else {
			const event = input.events[0];
			if (!event) throw new Error("Invalid initial integration fixture");
			event.actor = {
				kind: "employee",
				employeeId: employeeOne,
				userId: "missing-integration-user",
			};
		}

		await expect(
			repository.withTransaction(async ({ repository: txRepository }) =>
				txRepository.createInitialWorkflow(input),
			),
		).rejects.toBeDefined();
		const count = await pool.query<{ count: number }>(
			`select count(*)::int as count from approval_workflow
				where organization_id = $1 and id = $2`,
			[organizationOne, input.snapshot.id],
		);
		expect(count.rows).toEqual([{ count: 0 }]);
	});

	it("serializes concurrent identical starts into one created and one existing result", async () => {
		const input = initialWorkflowInput();
		const results = await Promise.all(
			[0, 1].map(() =>
				repository.withTransaction(async ({ repository: txRepository }) =>
					txRepository.createInitialWorkflow(input),
				),
			),
		);

		expect(results.map(({ kind }) => kind).sort()).toEqual([
			"created",
			"existing",
		]);
		const count = await pool.query<{ count: number }>(
			`select count(*)::int as count from approval_workflow
			where organization_id = $1 and workflow_type = 'absence'
				and source_type = 'absence_entry' and source_id = $2`,
			[organizationOne, initialSource],
		);
		expect(count.rows).toEqual([{ count: 1 }]);
	});

	it("allows exactly one of two concurrent different pending cycles for the same typed source", async () => {
		const first = initialWorkflowInput(
			organizationOne,
			"integration-concurrent-cycle-one",
		);
		const second = initialWorkflowInput(
			organizationOne,
			"integration-concurrent-cycle-two",
		);
		const results = await Promise.all(
			[first, second].map((input) =>
				repository.withTransaction(async ({ repository: txRepository }) =>
					txRepository.createInitialWorkflow(input),
				),
			),
		);

		expect(results.map(({ kind }) => kind).sort()).toEqual([
			"created",
			"source_conflict",
		]);
		const pending = await pool.query<{ count: number }>(
			`select count(*)::int as count from approval_workflow
			where organization_id = $1 and workflow_type = 'absence'
				and source_type = 'absence_entry' and source_id = $2
				and status = 'pending'`,
			[organizationOne, initialSource],
		);
		expect(pending.rows).toEqual([{ count: 1 }]);
	});

	it("serializes concurrent different workflow types for one database source scope", async () => {
		const absence = initialWorkflowInput(
			organizationOne,
			"integration-cross-type-absence",
			"absence",
		);
		const expense = initialWorkflowInput(
			organizationOne,
			"integration-cross-type-expense",
			"travel_expense",
		);
		const results = await Promise.all(
			[absence, expense].map((input) =>
				repository.withTransaction(async ({ repository: txRepository }) =>
					txRepository.createInitialWorkflow(input),
				),
			),
		);

		expect(results.map(({ kind }) => kind).sort()).toEqual([
			"created",
			"created",
		]);
	});

	it("permits repeated cycles only after every prior cycle is terminal", async () => {
		const first = initialWorkflowInput(
			organizationOne,
			"integration-cycle-one",
		);
		const pendingCompetitor = initialWorkflowInput(
			organizationOne,
			"integration-cycle-two",
		);
		await repository.withTransaction(async ({ repository: txRepository }) => {
			await expect(
				txRepository.createInitialWorkflow(first),
			).resolves.toMatchObject({
				kind: "created",
			});
		});
		await expect(
			repository.withTransaction(async ({ repository: txRepository }) =>
				txRepository.createInitialWorkflow(pendingCompetitor),
			),
		).resolves.toEqual({ kind: "source_conflict" });

		const completeCycle = async (workflowId: string) => {
			const timestamp = new Date(now.epochMilliseconds);
			await pool.query(
				`update approval_workflow
				set status = 'approved', current_stage_order = null,
					completed_at = $3, updated_at = $3
				where organization_id = $1 and id = $2`,
				[organizationOne, workflowId, timestamp],
			);
			await pool.query(
				`update approval_workflow_stage
				set status = 'approved', decided_at = $3, updated_at = $3
				where organization_id = $1 and workflow_id = $2`,
				[organizationOne, workflowId, timestamp],
			);
			await pool.query(
				`update approval_stage_assignment
				set status = 'approved', resolved_at = $3,
					resolved_by_actor_kind = 'system', updated_at = $3
				where organization_id = $1 and workflow_id = $2`,
				[organizationOne, workflowId, timestamp],
			);
		};

		await completeCycle(first.snapshot.id);
		await expect(
			repository.withTransaction(async ({ repository: txRepository }) =>
				txRepository.createInitialWorkflow(pendingCompetitor),
			),
		).resolves.toMatchObject({ kind: "created" });
		await completeCycle(pendingCompetitor.snapshot.id);

		const third = initialWorkflowInput(
			organizationOne,
			"integration-cycle-three",
		);
		await expect(
			repository.withTransaction(async ({ repository: txRepository }) =>
				txRepository.createInitialWorkflow(third),
			),
		).resolves.toMatchObject({ kind: "created" });

		const roots = await pool.query<{ status: string }>(
			`select status from approval_workflow
			where organization_id = $1 and workflow_type = 'absence'
				and source_type = 'absence_entry' and source_id = $2
			order by submitted_at, id`,
			[organizationOne, initialSource],
		);
		expect(roots.rows.map(({ status }) => status).sort()).toEqual([
			"approved",
			"approved",
			"pending",
		]);
	});

	it("returns source conflict without modifying the winning initial evidence", async () => {
		const winner = initialWorkflowInput();
		await repository.withTransaction(async ({ repository: txRepository }) => {
			await txRepository.createInitialWorkflow(winner);
		});
		const changed = initialWorkflowInput();
		changed.snapshot.policySnapshot = { kind: "changed" };

		await expect(
			repository.withTransaction(async ({ repository: txRepository }) =>
				txRepository.createInitialWorkflow(changed),
			),
		).resolves.toEqual({ kind: "source_conflict" });
		const evidence = await pool.query<{
			policy_snapshot: unknown;
			resulting_state: unknown;
		}>(
			`select workflow.policy_snapshot, event.resulting_state
			from approval_workflow workflow
			join approval_workflow_event event
				on event.organization_id = workflow.organization_id
				and event.workflow_id = workflow.id
			where workflow.organization_id = $1 and workflow.id = $2
				and event.event_index = 0`,
			[organizationOne, winner.snapshot.id],
		);
		expect(evidence.rows).toEqual([
			{
				policy_snapshot: winner.snapshot.policySnapshot,
				resulting_state: winner.events[0]?.resultingState,
			},
		]);
	});

	it("does not replay an otherwise identical initial workflow from another organization", async () => {
		const first = initialWorkflowInput(organizationOne);
		const foreign = initialWorkflowInput(organizationTwo);
		const results = [];
		for (const input of [first, foreign]) {
			results.push(
				await repository.withTransaction(async ({ repository: txRepository }) =>
					txRepository.createInitialWorkflow(input),
				),
			);
		}

		expect(results.map(({ kind }) => kind)).toEqual(["created", "created"]);
		expect(first.snapshot.id).not.toBe(foreign.snapshot.id);
	});

	it("isolates identical command keys across organizations", async () => {
		for (const [organizationId, workflowId] of [
			[organizationOne, workflowOne],
			[organizationTwo, workflowTwo],
		] as const) {
			await repository.withTransaction(async ({ repository: txRepository }) => {
				const identity = {
					organizationId,
					workflowId,
					idempotencyKey: "shared-key",
					actorFingerprint: "actor-v1",
					commandFingerprint: "command-v1",
				};
				await txRepository.claimCommand(identity);
				await txRepository.completeCommand({
					...identity,
					result: commandResult(organizationId, workflowId),
				});
			});
		}
		const count = await pool.query(
			"select count(*)::int as count from approval_workflow_command where idempotency_key = 'shared-key'",
		);
		expect(count.rows[0]?.count).toBe(2);
	});

	it("does not wait for a claim timeout when the winner rejects before claiming", async () => {
		const claimBarrier = createClaimBarrier();
		const cause = new Error("winner failed before claim");
		const winner = Promise.reject(cause);
		void winner.catch(claimBarrier.rejectClaimed);
		try {
			await expect(claimBarrier.claimed).rejects.toBe(cause);
		} finally {
			claimBarrier.markClaimed();
			await Promise.allSettled([winner]);
		}
	}, 1_000);

	it("waits for a concurrent winner and returns its completed result without a unique error", async () => {
		const identity = {
			organizationId: organizationOne,
			workflowId: workflowOne,
			idempotencyKey: "concurrent-key",
			actorFingerprint: "actor-v1",
			commandFingerprint: "command-v1",
		};
		let releaseWinner = () => {
			throw new Error("Winner release was not initialized");
		};
		const claimBarrier = createClaimBarrier();
		const release = new Promise<void>((resolve) => {
			releaseWinner = resolve;
		});
		let winnerClaim: unknown;
		const observer = new Pool({ connectionString: databaseUrl, max: 1 });
		const loserApplicationName = `approval-workflow-loser-${randomUUID()}`;
		let loser: Promise<unknown> | undefined;
		const winner = repository.withTransaction(
			async ({ repository: txRepository }) => {
				winnerClaim = await txRepository.claimCommand(identity);
				claimBarrier.markClaimed();
				await release;
				await txRepository.completeCommand({
					...identity,
					result: commandResult(organizationOne, workflowOne),
				});
			},
		);
		void winner.catch(claimBarrier.rejectClaimed);
		try {
			await claimBarrier.claimed;
			const uncommittedWinner = await pool.query<{ count: number }>(
				`select count(*)::int as count from approval_workflow_command
					where organization_id = $1 and workflow_id = $2 and idempotency_key = $3`,
				[organizationOne, workflowOne, identity.idempotencyKey],
			);
			expect(uncommittedWinner.rows).toEqual([{ count: 0 }]);
			expect(winnerClaim).toEqual({ kind: "reserved" });
			loser = repository.withTransaction(
				async ({ dbService, repository: txRepository }) => {
					await dbService.db.execute(
						sql`select set_config('application_name', ${loserApplicationName}, true)`,
					);
					return txRepository.claimCommand(identity);
				},
			);
			await expect(
				waitForTransactionLock(observer, loserApplicationName),
			).resolves.toEqual({
				wait_event: "transactionid",
				wait_event_type: "Lock",
			});
			releaseWinner();
			await winner;
			await expect(loser).resolves.toEqual({
				kind: "completed",
				result: commandResult(organizationOne, workflowOne),
			});

			await expect(
				repository.withTransaction(async ({ repository: txRepository }) =>
					txRepository.claimCommand({ ...identity, actorFingerprint: "other" }),
				),
			).resolves.toEqual({ kind: "fingerprint_mismatch" });
		} finally {
			releaseWinner();
			if (loser) {
				await Promise.allSettled([release, winner, loser]);
			} else {
				await Promise.allSettled([release, winner]);
			}
			await Promise.allSettled([observer.end()]);
		}
	}, 20_000);

	it("rolls back a reserved-only callback", async () => {
		await expect(
			repository.withTransaction(async ({ repository: txRepository }) => {
				await txRepository.claimCommand({
					organizationId: organizationOne,
					workflowId: workflowOne,
					idempotencyKey: "rollback-key",
					actorFingerprint: "actor-v1",
					commandFingerprint: "command-v1",
				});
			}),
		).rejects.toMatchObject({ code: "command_invariant" });
		const count = await pool.query(
			"select count(*)::int as count from approval_workflow_command where idempotency_key = 'rollback-key'",
		);
		expect(count.rows[0]?.count).toBe(0);
	});

	it("does not write after a competitor materializes the winning CAS transition", async () => {
		await seedStageAndAssignment();
		const plan = materializedPlanWithChildUpdates();
		expect(plan.changes.stages).toHaveLength(1);
		expect(plan.changes.assignments).toHaveLength(1);
		expect(plan.events).toHaveLength(1);
		await repository.withTransaction(async ({ repository: txRepository }) => {
			await expect(
				txRepository.tryAdvanceVersion({
					organizationId: organizationOne,
					workflowId: workflowOne,
					expectedVersion: plan.expectedVersion,
				}),
			).resolves.toEqual({ kind: "advanced", version: 2 });
			await txRepository.applyMaterializedTransition(plan);
		});
		const before = await persistedWorkflowState();
		expect(before.root).toEqual([
			expect.objectContaining({
				id: workflowOne,
				organization_id: organizationOne,
				status: "approved",
				version: 2,
			}),
		]);
		expect(before.stage).toEqual([
			expect.objectContaining({ id: stageOne, status: "approved" }),
		]);
		expect(before.assignment).toEqual([
			expect.objectContaining({ id: assignmentOne, status: "approved" }),
		]);
		expect(before.event).toEqual([
			expect.objectContaining({ id: eventOne, version: 2, event_index: 0 }),
		]);
		await repository.withTransaction(async ({ repository: txRepository }) => {
			await expect(
				txRepository.tryAdvanceVersion({
					organizationId: organizationOne,
					workflowId: workflowOne,
					expectedVersion: plan.expectedVersion,
				}),
			).resolves.toEqual({ kind: "conflict", version: 2 });
			await expect(
				txRepository.applyMaterializedTransition(plan),
			).rejects.toMatchObject({ code: "cas_invariant" });
		});
		expect(await persistedWorkflowState()).toEqual(before);
	});

	it("translates an event uniqueness conflict through the repository and rolls back", async () => {
		await seedStageAndAssignment();
		const plan = materializedPlanWithChildUpdates();
		expect(plan.changes.stages).toHaveLength(1);
		expect(plan.changes.assignments).toHaveLength(1);
		expect(plan.events).toHaveLength(1);
		const timestamp = new Date(now.epochMilliseconds);
		await pool.query(
			`insert into approval_workflow_event (
				id, organization_id, workflow_id, version, event_index, event_type,
				actor_kind, resulting_state, occurred_at, created_at
			) values ($1, $2, $3, 2, 0, 'workflow.approved', 'system', '{}', $4, $4)`,
			[
				"60000000-0000-4000-8000-000000000099",
				organizationOne,
				workflowOne,
				timestamp,
			],
		);
		await expect(
			pool.query(
				`insert into approval_workflow_event (
					id, organization_id, workflow_id, version, event_index, event_type,
					actor_kind, resulting_state, occurred_at, created_at
				) values ($1, $2, $3, 2, 0, 'workflow.approved', 'system', '{}', $4, $4)`,
				[
					"60000000-0000-4000-8000-000000000098",
					organizationOne,
					workflowOne,
					timestamp,
				],
			),
		).rejects.toMatchObject({ code: "23505" });
		const before = await persistedWorkflowState();
		expect(before.event).toEqual([
			expect.objectContaining({
				id: "60000000-0000-4000-8000-000000000099",
				organization_id: organizationOne,
				workflow_id: workflowOne,
				version: 2,
				event_index: 0,
			}),
		]);

		await expect(
			repository.withTransaction(async ({ repository: txRepository }) => {
				await expect(
					txRepository.tryAdvanceVersion({
						organizationId: organizationOne,
						workflowId: workflowOne,
						expectedVersion: 1,
					}),
				).resolves.toEqual({ kind: "advanced", version: 2 });
				await txRepository.applyMaterializedTransition(plan);
			}),
		).rejects.toMatchObject({ code: "persistence_count" });
		expect(await persistedWorkflowState()).toEqual(before);
	});
});
