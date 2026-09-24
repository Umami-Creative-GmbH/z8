import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	type ApprovalHandoverTaskPayload,
	evaluateOffboardingReassignment,
	type OffboardingReassignmentFacts,
	parseApprovalHandoverTaskPayload,
} from "./offboarding-authority";
import type {
	ApprovalCommandResult,
	ApprovalWorkflowSnapshot,
	OffboardingHandoverPrincipal,
} from "./ports";

const ids = {
	organization: "org-1",
	departure: "d0000000-0000-4000-8000-000000000001",
	period: "d0000000-0000-4000-8000-000000000002",
	task: "d0000000-0000-4000-8000-000000000003",
	claim: "d0000000-0000-4000-8000-000000000004",
	workflow: "d0000000-0000-4000-8000-000000000005",
	stage: "d0000000-0000-4000-8000-000000000006",
	assignment: "d0000000-0000-4000-8000-000000000007",
	sibling: "d0000000-0000-4000-8000-000000000008",
	departed: "e0000000-0000-4000-8000-000000000001",
	replacement: "e0000000-0000-4000-8000-000000000002",
	requester: "e0000000-0000-4000-8000-000000000003",
	other: "e0000000-0000-4000-8000-000000000004",
	replacementAssignment: "d0000000-0000-4000-8000-000000000009",
	foreign: "f0000000-0000-4000-8000-000000000001",
} as const;
const cutoff = parseInstant("2026-09-15T00:00:00Z");
const now = parseInstant("2026-09-15T00:01:00Z");

function workflow(): ApprovalWorkflowSnapshot {
	return {
		id: ids.workflow,
		organizationId: ids.organization,
		workflowType: "absence",
		sourceType: "absence_entry",
		sourceId: "source-1",
		requesterEmployeeId: ids.requester,
		status: "pending",
		currentStageOrder: 1,
		version: 3,
		policySnapshot: {},
		contextSnapshot: {},
		displaySnapshot: {},
		submittedAt: parseInstant("2026-09-01T00:00:00Z"),
		completedAt: null,
		cancelledAt: null,
		decisionReason: null,
		stages: [
			{
				id: ids.stage,
				organizationId: ids.organization,
				workflowId: ids.workflow,
				sequence: 1,
				label: "Manager",
				resolverSnapshot: {},
				activationMode: "human",
				status: "pending",
				activatedAt: parseInstant("2026-09-01T00:00:00Z"),
				decidedAt: null,
				decisionReason: null,
				legacyApprovalRequestId: null,
				assignments: [
					{
						id: ids.assignment,
						organizationId: ids.organization,
						workflowId: ids.workflow,
						stageId: ids.stage,
						sequence: 1,
						approverEmployeeId: ids.departed,
						status: "pending",
						assignedAt: parseInstant("2026-09-01T00:00:00Z"),
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
}

function principal(
	overrides: Partial<OffboardingHandoverPrincipal> = {},
): OffboardingHandoverPrincipal {
	return {
		kind: "system",
		systemId: "employee-offboarding",
		departureId: ids.departure,
		employmentPeriodId: ids.period,
		assignmentId: ids.assignment,
		handoverTaskId: ids.task,
		claimToken: ids.claim,
		...overrides,
	};
}

function payload(overrides: Partial<ApprovalHandoverTaskPayload> = {}): ApprovalHandoverTaskPayload {
	return {
		workflowId: ids.workflow,
		stageId: ids.stage,
		assignmentId: ids.assignment,
		fromEmployeeId: ids.departed,
		replacementEmployeeId: ids.replacement,
		...overrides,
	};
}

function facts(overrides: Partial<OffboardingReassignmentFacts> = {}): OffboardingReassignmentFacts {
	return {
		now,
		organizationId: ids.organization,
		principal: principal(),
		command: {
			type: "reassign",
			stageId: ids.stage,
			fromEmployeeId: ids.departed,
			toEmployeeId: ids.replacement,
		},
		workflow: workflow(),
		departure: {
			id: ids.departure,
			organizationId: ids.organization,
			employeeId: ids.departed,
			employmentPeriodId: ids.period,
			status: "effective",
			cutoffAt: cutoff,
		},
		task: {
			id: ids.task,
			organizationId: ids.organization,
			departureId: ids.departure,
			employmentPeriodId: ids.period,
			employeeId: ids.departed,
			kind: "approval_handover",
			status: "processing",
			claimToken: ids.claim,
			leaseUntil: parseInstant("2026-09-15T00:05:00Z"),
			payload: payload(),
		},
		rehired: false,
		target: {
			employeeId: ids.replacement,
			organizationId: ids.organization,
			hasOrganizationAccess: true,
			hasDecisionPath: true,
		},
		replay: null,
		...overrides,
	};
}

function replayResult(
	overrides: { source?: string; target?: string; approver?: string } = {},
): ApprovalCommandResult {
	const snapshot = workflow();
	const stage = snapshot.stages[0];
	if (!stage) throw new Error("stage missing");
	stage.assignments.push({
		...stage.assignments[0],
		id: overrides.target ?? ids.replacementAssignment,
		sequence: 2,
		approverEmployeeId: overrides.approver ?? ids.replacement,
		reassignedFromAssignmentId: ids.assignment,
	} as ApprovalWorkflowSnapshot["stages"][number]["assignments"][number]);
	return {
		snapshot,
		events: [
			{
				id: "event-1",
				organizationId: ids.organization,
				workflowId: ids.workflow,
				version: 4,
				eventIndex: 0,
				eventType: "assignment.reassigned",
				actor: { kind: "system", employeeId: null, userId: null },
				previousState: null,
				resultingState: {},
				reason: "reassignment",
				metadata: null,
				references: {
					sourceAssignmentId: overrides.source ?? ids.assignment,
					targetAssignmentId: overrides.target ?? ids.replacementAssignment,
				},
				idempotencyKey: "offboarding:key",
				occurredAt: now,
			},
		],
		projection: {} as ApprovalCommandResult["projection"],
		outbox: [],
	};
}

function denial(input: OffboardingReassignmentFacts) {
	const result = evaluateOffboardingReassignment(input);
	return result.kind === "denied" ? result.reason : "authorized";
}

describe("evaluateOffboardingReassignment", () => {
	it("authorizes the exact captured pending duty for an eligible replacement", () => {
		expect(evaluateOffboardingReassignment(facts())).toEqual({ kind: "authorized" });
	});

	it("never authorizes a decision, cancellation or expiry", () => {
		for (const command of [
			{ type: "approve", stageId: ids.stage, assignmentId: ids.assignment },
			{ type: "reject", stageId: ids.stage, assignmentId: ids.assignment, reason: "x" },
			{ type: "cancel", reason: "x" },
			{ type: "expire", reason: "x" },
			{
				type: "escalate",
				stageId: ids.stage,
				fromEmployeeId: ids.departed,
				toEmployeeId: ids.replacement,
			},
		] as const) {
			expect(denial(facts({ command }))).toBe("command_not_reassign");
		}
	});

	it.each([
		["organization", { departure: { ...facts().departure!, organizationId: ids.foreign } }, "departure_mismatch"],
		["missing departure", { departure: null }, "departure_mismatch"],
		["pending departure", { departure: { ...facts().departure!, status: "pending" as const } }, "departure_not_effective"],
		["departed employee", { departure: { ...facts().departure!, employeeId: ids.other } }, "departure_mismatch"],
		["employment period", { principal: principal({ employmentPeriodId: ids.other }) }, "departure_mismatch"],
		["departure id", { principal: principal({ departureId: ids.other }) }, "departure_mismatch"],
		["task id", { principal: principal({ handoverTaskId: ids.other }) }, "task_mismatch"],
		["missing task", { task: null }, "task_mismatch"],
		["task organization", { task: { ...facts().task!, organizationId: ids.foreign } }, "task_mismatch"],
		["task departure", { task: { ...facts().task!, departureId: ids.other } }, "task_mismatch"],
		["task period", { task: { ...facts().task!, employmentPeriodId: ids.other } }, "task_mismatch"],
		["task kind", { task: { ...facts().task!, kind: "billing_sync" as const } }, "task_mismatch"],
		["forged claim", { principal: principal({ claimToken: ids.other }) }, "lease_not_owned"],
		["released task", { task: { ...facts().task!, status: "pending" as const, claimToken: null } }, "lease_not_owned"],
		["stale lease", { now: parseInstant("2026-09-15T00:06:00Z") }, "lease_not_owned"],
		["assignment in principal", { principal: principal({ assignmentId: ids.sibling }) }, "task_mismatch"],
		["task workflow", { task: { ...facts().task!, payload: payload({ workflowId: ids.other }) } }, "task_mismatch"],
		["task stage", { task: { ...facts().task!, payload: payload({ stageId: ids.other }) } }, "task_mismatch"],
		["task target", { task: { ...facts().task!, payload: payload({ replacementEmployeeId: ids.other }) } }, "target_mismatch"],
		["unset target", { task: { ...facts().task!, payload: payload({ replacementEmployeeId: null }) } }, "target_mismatch"],
		["rehired employee", { rehired: true }, "employee_rehired"],
	] as const)("rejects a swapped %s", (_label, override, reason) => {
		expect(denial(facts(override as Partial<OffboardingReassignmentFacts>))).toBe(reason);
	});

	it("rejects a command whose source employee is not the departed employee", () => {
		expect(
			denial(
				facts({
					command: {
						type: "reassign",
						stageId: ids.stage,
						fromEmployeeId: ids.other,
						toEmployeeId: ids.replacement,
					},
				}),
			),
		).toBe("departure_mismatch");
	});

	it("rejects a different target under the same principal", () => {
		expect(
			denial(
				facts({
					command: {
						type: "reassign",
						stageId: ids.stage,
						fromEmployeeId: ids.departed,
						toEmployeeId: ids.other,
					},
				}),
			),
		).toBe("target_mismatch");
	});

	it("rejects a workflow in another organization", () => {
		expect(denial(facts({ workflow: { ...workflow(), organizationId: ids.foreign } }))).toBe(
			"workflow_mismatch",
		);
	});

	it("rejects a terminal workflow and a non-current or waiting stage", () => {
		expect(denial(facts({ workflow: { ...workflow(), status: "approved" } }))).toBe(
			"source_not_pending",
		);
		const waiting = workflow();
		waiting.stages[0] = { ...waiting.stages[0]!, status: "waiting" };
		expect(denial(facts({ workflow: waiting }))).toBe("source_not_pending");
		const nonCurrent = workflow();
		nonCurrent.currentStageOrder = 2;
		expect(denial(facts({ workflow: nonCurrent }))).toBe("source_not_pending");
	});

	it("treats a decided or already transferred source as resolved, never overwritten", () => {
		const decided = workflow();
		decided.stages[0]!.assignments[0] = {
			...decided.stages[0]!.assignments[0]!,
			status: "approved",
		};
		expect(denial(facts({ workflow: decided }))).toBe("source_not_pending");
	});

	it("rejects a source assignment that no longer belongs to the departed employee", () => {
		const moved = workflow();
		moved.stages[0]!.assignments[0] = {
			...moved.stages[0]!.assignments[0]!,
			approverEmployeeId: ids.other,
		};
		expect(denial(facts({ workflow: moved }))).toBe("source_not_pending");
	});

	it("rejects a duty assigned after the departure cutoff", () => {
		const late = workflow();
		late.stages[0]!.assignments[0] = {
			...late.stages[0]!.assignments[0]!,
			assignedAt: parseInstant("2026-09-15T00:00:01Z"),
		};
		expect(denial(facts({ workflow: late }))).toBe("source_after_cutoff");
	});

	it("rejects self approval, an already pending target and an ineligible target", () => {
		expect(
			denial(
				facts({
					command: {
						type: "reassign",
						stageId: ids.stage,
						fromEmployeeId: ids.departed,
						toEmployeeId: ids.requester,
					},
					task: { ...facts().task!, payload: payload({ replacementEmployeeId: ids.requester }) },
					target: { ...facts().target!, employeeId: ids.requester },
				}),
			),
		).toBe("target_is_requester");
		const busy = workflow();
		busy.stages[0]!.assignments.push({
			...busy.stages[0]!.assignments[0]!,
			id: ids.sibling,
			sequence: 2,
			approverEmployeeId: ids.replacement,
		});
		expect(denial(facts({ workflow: busy }))).toBe("target_already_pending");
		expect(denial(facts({ target: null }))).toBe("target_ineligible");
		expect(denial(facts({ target: { ...facts().target!, hasOrganizationAccess: false } }))).toBe(
			"target_ineligible",
		);
		expect(denial(facts({ target: { ...facts().target!, hasDecisionPath: false } }))).toBe(
			"target_ineligible",
		);
		expect(denial(facts({ target: { ...facts().target!, organizationId: ids.foreign } }))).toBe(
			"target_ineligible",
		);
	});

	describe("receipt replay", () => {
		it("verifies recorded lineage instead of requiring a pending source", () => {
			const decided = workflow();
			decided.stages[0]!.assignments[0] = {
				...decided.stages[0]!.assignments[0]!,
				status: "cancelled",
			};
			expect(
				evaluateOffboardingReassignment(
					facts({ workflow: decided, target: null, replay: replayResult() }),
				),
			).toEqual({ kind: "authorized" });
		});

		it("still requires current lease ownership and matching intent", () => {
			expect(
				denial(facts({ principal: principal({ claimToken: ids.other }), replay: replayResult() })),
			).toBe("lease_not_owned");
			expect(
				denial(
					facts({
						task: { ...facts().task!, payload: payload({ replacementEmployeeId: ids.other }) },
						replay: replayResult(),
					}),
				),
			).toBe("target_mismatch");
		});

		it("rejects a receipt that did not transfer this exact source to this target", () => {
			expect(denial(facts({ replay: replayResult({ source: ids.sibling }) }))).toBe(
				"replay_lineage_mismatch",
			);
			expect(denial(facts({ replay: replayResult({ approver: ids.other }) }))).toBe(
				"replay_lineage_mismatch",
			);
		});
	});
});

describe("parseApprovalHandoverTaskPayload", () => {
	it("accepts exactly the handover intent fields", () => {
		expect(parseApprovalHandoverTaskPayload({ ...payload(), progress: "ignored" })).toEqual(
			payload(),
		);
		expect(parseApprovalHandoverTaskPayload(payload({ replacementEmployeeId: null }))).toEqual(
			payload({ replacementEmployeeId: null }),
		);
	});

	it.each([
		["missing workflow", { ...payload(), workflowId: undefined }],
		["non-uuid assignment", { ...payload(), assignmentId: "not-a-uuid" }],
		["numeric target", { ...payload(), replacementEmployeeId: 7 }],
		["array", []],
		["null", null],
	])("rejects %s", (_label, value) => {
		expect(parseApprovalHandoverTaskPayload(value)).toBeNull();
	});
});
