import { PgDialect, type SQL } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { createTimeCorrectionApprovalAdapter } from "../domain-adapters/time-correction.adapter";
import type {
	ApprovalDbService,
	ApprovalStageSnapshot,
	ApprovalWorkflowSnapshot,
	JsonObject,
	StageActivationInput,
} from "../workflow/ports";
import { createDatabaseStageActivationResolver } from "./stage-activation-resolver";

const requesterId = "00000000-0000-4000-8000-000000000001";
const managerAId = "00000000-0000-4000-8000-000000000011";
const managerBId = "00000000-0000-4000-8000-000000000012";
const workflowId = "10000000-0000-4000-8000-000000000001";
const stageId = "20000000-0000-4000-8000-000000000001";
const submittedAt = parseInstant("2026-07-17T09:00:00Z");

function routingContext(overrides: JsonObject = {}): JsonObject {
	return {
		organizationId: "org-1",
		workflowType: "absence",
		source: { type: "absence_entry", id: "absence-1" },
		requesterEmployeeId: requesterId,
		teamIds: [],
		locationId: null,
		absenceCategoryId: null,
		travelExpenseAmount: null,
		overtimeRisk: null,
		employeeGroupIds: [],
		...overrides,
	};
}

function stage(
	overrides: Partial<ApprovalStageSnapshot> = {},
): ApprovalStageSnapshot {
	return {
		id: stageId,
		organizationId: "org-1",
		workflowId,
		sequence: 1,
		label: "Manager review",
		resolverSnapshot: {
			approverType: "direct_manager",
			fallbackBehavior: "fail",
		},
		activationMode: "human",
		status: "waiting",
		activatedAt: null,
		decidedAt: null,
		decisionReason: null,
		legacyApprovalRequestId: null,
		assignments: [],
		...overrides,
	};
}

function workflow(
	overrides: Partial<ApprovalWorkflowSnapshot> = {},
): ApprovalWorkflowSnapshot {
	return {
		id: workflowId,
		organizationId: "org-1",
		workflowType: "absence",
		sourceType: "absence_entry",
		sourceId: "absence-1",
		requesterEmployeeId: requesterId,
		status: "pending",
		currentStageOrder: 1,
		version: 1,
		policySnapshot: {},
		contextSnapshot: {},
		displaySnapshot: {},
		submittedAt,
		completedAt: null,
		cancelledAt: null,
		decisionReason: null,
		stages: [],
		...overrides,
	};
}

const directoryRows = [
	[
		{
			id: requesterId,
			organizationId: "org-1",
			isActive: true,
			role: "employee",
		},
		{
			id: managerAId,
			organizationId: "org-1",
			isActive: true,
			role: "manager",
		},
		{
			id: managerBId,
			organizationId: "org-1",
			isActive: true,
			role: "admin",
		},
	],
	[
		{ employeeId: requesterId, managerId: managerBId, isPrimary: false },
		{ employeeId: requesterId, managerId: managerAId, isPrimary: true },
	],
	[],
	[],
] satisfies unknown[][];

function directoryEnvelope(rows: unknown[][] = directoryRows) {
	return {
		employees: rows[0],
		managerLinks: rows[1],
		teamMemberships: rows[2],
		teams: rows[3],
	};
}

function database(responses: unknown[] = [directoryEnvelope()]) {
	const calls: SQL[] = [];
	const dbService = {
		db: {
			execute: async (query: SQL) => {
				calls.push(query);
				return { rows: responses };
			},
		},
	} as ApprovalDbService;
	return { calls, dbService };
}

function activationInput({
	dbService = database().dbService,
	organizationId = "org-1",
	routing = routingContext(),
	workflowSnapshot = workflow(),
	stageSnapshot = stage(),
}: {
	dbService?: ApprovalDbService;
	organizationId?: string;
	routing?: JsonObject;
	workflowSnapshot?: ApprovalWorkflowSnapshot;
	stageSnapshot?: ApprovalStageSnapshot;
} = {}): StageActivationInput {
	return {
		dbService,
		organizationId,
		workflow: workflowSnapshot,
		stage: stageSnapshot,
		actor: { kind: "system", employeeId: null, userId: null },
		routingContext: routing,
	};
}

function expectInvalidStageResolver(promise: Promise<unknown>) {
	return expect(promise).rejects.toMatchObject({
		name: "ApprovalStageActivationError",
		code: "invalid_stage_resolver",
	});
}

describe("createDatabaseStageActivationResolver", () => {
	it("resolves a sequential time-correction stage from the real adapter routing contract", async () => {
		const correctionWorkflow = workflow({
			workflowType: "time_correction",
			sourceType: "time_entry",
			sourceId: "30000000-0000-4000-8000-000000000001",
			contextSnapshot: {
				timeCorrection: {
					action: "edit",
					clockInCorrectionId: "40000000-0000-4000-8000-000000000001",
				},
			},
		});
		const source = {
			id: correctionWorkflow.sourceId,
			organizationId: "org-1",
			employeeId: requesterId,
			requesterUserId: "requester-user",
			approvalWorkflowId: workflowId,
			canonicalRecordId: "50000000-0000-4000-8000-000000000001",
			correction: correctionWorkflow.contextSnapshot.timeCorrection,
			clockIn: null,
			clockOut: null,
			requesterName: "Avery Requester",
			teamIds: [],
			locationId: null,
			overtimeRisk: null,
			employeeGroupIds: [],
		};
		const adapter = createTimeCorrectionApprovalAdapter({
			clock: { nowInstant: () => submittedAt },
			finalizeTimeCorrectionTerminal: async () => {
				throw new Error("not used");
			},
			deleteCancelledCorrections: async () => {
				throw new Error("not used");
			},
		});
		const routing = await adapter.produceRoutingContext({
			organizationId: "org-1",
			workflow: correctionWorkflow,
			sourceIdentity: {
				organizationId: "org-1",
				workflowType: "time_correction",
				sourceType: "time_entry",
				sourceId: correctionWorkflow.sourceId,
			},
			source,
			actor: { kind: "system", employeeId: null, userId: null },
		} as never);
		expect(routing).toMatchObject({
			source: { type: "time_entry", id: correctionWorkflow.sourceId },
			absenceCategoryId: null,
			travelExpenseAmount: null,
			locationId: null,
			overtimeRisk: null,
		});
		expect(routing).not.toHaveProperty("sourceType");
		expect(routing).not.toHaveProperty("sourceId");

		await expect(
			createDatabaseStageActivationResolver().resolve(
				activationInput({
					routing,
					workflowSnapshot: correctionWorkflow,
					stageSnapshot: stage({
						resolverSnapshot: {
							approverType: "direct_manager",
							fallbackBehavior: "fail",
						},
					}),
				}),
			),
		).resolves.toMatchObject({
			activationMode: "human",
			assignments: [
				{ approverEmployeeId: managerAId, metadata: {} },
				{ approverEmployeeId: managerBId, metadata: {} },
			],
		});
	});

	it("loads the scoped directory and maps human reviewers to parallel assignments", async () => {
		const fake = database();

		await expect(
			createDatabaseStageActivationResolver().resolve(
				activationInput({ dbService: fake.dbService }),
			),
		).resolves.toEqual({
			organizationId: "org-1",
			workflowId,
			stageId,
			activationMode: "human",
			assignments: [
				{ approverEmployeeId: managerAId, metadata: {} },
				{ approverEmployeeId: managerBId, metadata: {} },
			],
		});

		expect(fake.calls).toHaveLength(1);
		const rendered = new PgDialect().sqlToQuery(fake.calls[0]);
		expect(rendered.params).toEqual(["org-1", "org-1", "org-1", "org-1"]);
		expect(rendered.sql).toMatch(
			/from employee[\s\S]*employee\.organization_id\s*=\s*\$1/,
		);
		expect(rendered.sql).toMatch(
			/join employee subject on subject\.id = managers\.employee_id/,
		);
		expect(rendered.sql).toMatch(/subject\.organization_id\s*=\s*\$2/);
		expect(rendered.sql).toMatch(
			/from team_membership[\s\S]*team_membership\.organization_id\s*=\s*\$3/,
		);
		expect(rendered.sql).toMatch(
			/from team[\s\S]*team\.organization_id\s*=\s*\$4/,
		);
	});

	it("maps requester auto approval to no assignments", async () => {
		const rows = directoryRows.map((group) => [...group]);
		rows[0] = [
			{
				id: requesterId,
				organizationId: "org-1",
				isActive: true,
				role: "admin",
			},
		];
		const fake = database([directoryEnvelope(rows)]);

		await expect(
			createDatabaseStageActivationResolver().resolve(
				activationInput({
					dbService: fake.dbService,
					stageSnapshot: stage({
						resolverSnapshot: {
							approverType: "org_admin",
							fallbackBehavior: "fail",
						},
					}),
				}),
			),
		).resolves.toEqual({
			organizationId: "org-1",
			workflowId,
			stageId,
			activationMode: "requester_auto_approve",
			assignments: [],
		});
	});

	it.each([
		["inactive", false, "org-1"],
		["foreign", true, "org-2"],
	] as const)("rejects an %s requested specific employee", async (_case, isActive, organizationId) => {
		const specificEmployeeId = "00000000-0000-4000-8000-000000000099";
		const rows = directoryRows.map((group) => [...group]);
		rows[0] = [
			directoryRows[0][0],
			{
				id: specificEmployeeId,
				organizationId,
				isActive,
				role: "manager",
			},
		];
		const fake = database([directoryEnvelope(rows)]);

		await expect(
			createDatabaseStageActivationResolver().resolve(
				activationInput({
					dbService: fake.dbService,
					stageSnapshot: stage({
						resolverSnapshot: {
							approverType: "specific_employee",
							approverEmployeeId: specificEmployeeId,
							fallbackBehavior: "fail",
						},
					}),
				}),
			),
		).rejects.toMatchObject({ code: "no_eligible_reviewer" });
	});

	it.each([
		["organization", { organizationId: "org-2" }],
		["workflow type", { workflowType: "travel_expense" }],
		["source type", { source: { type: "other", id: "absence-1" } }],
		["source id", { source: { type: "absence_entry", id: "absence-2" } }],
	] as const)("rejects a routing context with mismatched trusted %s identity", async (_case, mismatch) => {
		await expectInvalidStageResolver(
			createDatabaseStageActivationResolver().resolve(
				activationInput({ routing: routingContext(mismatch) }),
			),
		);
	});

	it.each([
		{
			case: "workflow requester is null",
			routing: routingContext(),
			workflowSnapshot: workflow({ requesterEmployeeId: null }),
		},
		{
			case: "routing requester differs from the workflow requester",
			routing: routingContext({
				requesterEmployeeId: "00000000-0000-4000-8000-000000000099",
			}),
			workflowSnapshot: workflow(),
		},
	])("rejects requester identity mismatch when $case before directory reads", async ({
		routing,
		workflowSnapshot,
	}) => {
		const fake = database();

		await expectInvalidStageResolver(
			createDatabaseStageActivationResolver().resolve(
				activationInput({
					dbService: fake.dbService,
					routing,
					workflowSnapshot,
				}),
			),
		);
		expect(fake.calls).toEqual([]);
	});

	it.each([
		["input organization", { organizationId: "org-2" }],
		[
			"stage organization",
			{ stageSnapshot: stage({ organizationId: "org-2" }) },
		],
		[
			"stage workflow",
			{ stageSnapshot: stage({ workflowId: "other-workflow" }) },
		],
	] as const)("rejects mismatched trusted %s identity", async (_case, overrides) => {
		await expectInvalidStageResolver(
			createDatabaseStageActivationResolver().resolve(
				activationInput(overrides),
			),
		);
	});

	it.each([
		["missing requester", { requesterEmployeeId: undefined }],
		["empty organization", { organizationId: "" }],
		["malformed source", { source: { type: "absence_entry", id: 1 } }],
		["malformed teams", { teamIds: ["team-1", 2] }],
		["malformed location", { locationId: false }],
		["malformed absence category", { absenceCategoryId: 1 }],
		["non-finite amount", { travelExpenseAmount: Number.POSITIVE_INFINITY }],
		["malformed overtime risk", { overtimeRisk: "high" }],
		["malformed employee groups", { employeeGroupIds: null }],
	] as const)("rejects malformed routing context: %s", async (_case, malformed) => {
		await expectInvalidStageResolver(
			createDatabaseStageActivationResolver().resolve(
				activationInput({ routing: routingContext(malformed as JsonObject) }),
			),
		);
	});

	it.each([
		["missing approver type", { fallbackBehavior: "fail" }],
		["empty approver type", { approverType: "", fallbackBehavior: "fail" }],
		["missing fallback", { approverType: "direct_manager" }],
		[
			"empty fallback",
			{ approverType: "direct_manager", fallbackBehavior: "" },
		],
		[
			"non-string employee",
			{
				approverType: "specific_employee",
				fallbackBehavior: "fail",
				approverEmployeeId: 1,
			},
		],
	] as const)("rejects malformed stage resolver JSON: %s", async (_case, resolverSnapshot) => {
		await expectInvalidStageResolver(
			createDatabaseStageActivationResolver().resolve(
				activationInput({
					stageSnapshot: stage({ resolverSnapshot }),
				}),
			),
		);
	});

	it.each([
		[
			0,
			{
				id: managerAId,
				organizationId: "org-1",
				isActive: "yes",
				role: "manager",
			},
		],
		[
			0,
			{
				id: managerAId,
				organizationId: "org-1",
				isActive: true,
				role: "owner",
			},
		],
		[1, { employeeId: requesterId, managerId: managerAId, isPrimary: null }],
		[2, { employeeId: requesterId, teamId: 3 }],
		[3, { id: "team-1", organizationId: "org-1", primaryManagerId: 3 }],
	] as const)("fails closed for a malformed directory row from query %i", async (queryIndex, malformedRow) => {
		const rows = directoryRows.map((group) => [...group]);
		rows[queryIndex] = [malformedRow];
		const fake = database([directoryEnvelope(rows)]);

		await expectInvalidStageResolver(
			createDatabaseStageActivationResolver().resolve(
				activationInput({ dbService: fake.dbService }),
			),
		);
	});

	it.each([
		["no result row", []],
		["multiple result rows", [directoryEnvelope(), directoryEnvelope()]],
		["non-array property", [{ ...directoryEnvelope(), managerLinks: null }]],
	] as const)("rejects a malformed directory envelope: %s", async (_case, rows) => {
		const fake = database([...rows]);

		await expectInvalidStageResolver(
			createDatabaseStageActivationResolver().resolve(
				activationInput({ dbService: fake.dbService }),
			),
		);
	});
});
