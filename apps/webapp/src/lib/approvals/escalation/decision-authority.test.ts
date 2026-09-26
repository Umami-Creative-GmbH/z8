import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { ApprovalAssignmentSnapshot, ApprovalWorkflowSnapshot } from "../workflow/ports";
import {
	ApprovalAssignmentReassignedError,
	assertNotReplacedByEscalation,
	eligibleManagerFallbackAllowed,
	lineageContainsEscalation,
	selectCanonicalDecisionTarget,
	wasReplacedByEscalation,
} from "./decision-authority";

const ids = {
	workflow: "60000000-0000-4000-8000-000000000001",
	stage: "70000000-0000-4000-8000-000000000001",
	legacyRequest: "90000000-0000-4000-8000-000000000001",
	former: "80000000-0000-4000-8000-000000000001",
	replacement: "80000000-0000-4000-8000-000000000002",
	formerApprover: "30000000-0000-4000-8000-00000000000a",
	replacementApprover: "30000000-0000-4000-8000-00000000000b",
	manager: "30000000-0000-4000-8000-00000000000c",
} as const;

const at = parseInstant("2026-09-01T08:00:00Z");
const transferredAt = parseInstant("2026-09-02T08:00:00Z");

function assignment(
	overrides: Partial<ApprovalAssignmentSnapshot> & { id: string },
): ApprovalAssignmentSnapshot {
	return {
		organizationId: "org-1",
		workflowId: ids.workflow,
		stageId: ids.stage,
		sequence: 1,
		approverEmployeeId: ids.formerApprover,
		status: "pending",
		assignedAt: at,
		resolvedAt: null,
		resolvedBy: null,
		reassignedByEmployeeId: null,
		reassignedFromAssignmentId: null,
		reassignmentMetadata: null,
		...overrides,
	};
}

function workflow(assignments: ApprovalAssignmentSnapshot[]): ApprovalWorkflowSnapshot {
	return {
		id: ids.workflow,
		organizationId: "org-1",
		workflowType: "absence",
		sourceType: "absence_entry",
		sourceId: "50000000-0000-4000-8000-000000000001",
		requesterEmployeeId: "30000000-0000-4000-8000-000000000001",
		status: "pending",
		currentStageOrder: 1,
		version: 3,
		policySnapshot: {},
		contextSnapshot: {},
		displaySnapshot: {},
		submittedAt: at,
		completedAt: null,
		cancelledAt: null,
		decisionReason: null,
		stages: [
			{
				id: ids.stage,
				organizationId: "org-1",
				workflowId: ids.workflow,
				sequence: 1,
				label: "Approval",
				resolverSnapshot: {},
				activationMode: "human",
				status: "pending",
				activatedAt: at,
				decidedAt: null,
				decisionReason: null,
				legacyApprovalRequestId: ids.legacyRequest,
				assignments,
			},
		],
	};
}

function escalated(kind: "escalation" | "reassignment" = "escalation") {
	return workflow([
		assignment({
			id: ids.former,
			status: "cancelled",
			resolvedAt: transferredAt,
			resolvedBy: { kind: "system", employeeId: null, userId: null },
		}),
		assignment({
			id: ids.replacement,
			sequence: 2,
			approverEmployeeId: ids.replacementApprover,
			assignedAt: transferredAt,
			reassignedFromAssignmentId: ids.former,
			reassignmentMetadata: { kind },
		}),
	]);
}

describe("selectCanonicalDecisionTarget", () => {
	it("resolves a single-assignment stage exactly as before", () => {
		const snapshot = workflow([assignment({ id: ids.former })]);
		expect(
			selectCanonicalDecisionTarget({
				workflow: snapshot,
				approvalRequestId: ids.legacyRequest,
				actorEmployeeId: ids.manager,
			}).assignment.id,
		).toBe(ids.former);
	});

	it("targets the replacement's pending assignment, never cancelled history", () => {
		expect(
			selectCanonicalDecisionTarget({
				workflow: escalated(),
				approvalRequestId: ids.legacyRequest,
				actorEmployeeId: ids.replacementApprover,
			}).assignment.id,
		).toBe(ids.replacement);
	});

	it("tells the former assignee the approval moved instead of acting for them", () => {
		expect(() =>
			selectCanonicalDecisionTarget({
				workflow: escalated(),
				approvalRequestId: ids.legacyRequest,
				actorEmployeeId: ids.formerApprover,
			}),
		).toThrow(ApprovalAssignmentReassignedError);
	});

	it("lets another actor address the current assignment for authorization to judge", () => {
		expect(
			selectCanonicalDecisionTarget({
				workflow: escalated(),
				approvalRequestId: ids.legacyRequest,
				actorEmployeeId: ids.manager,
			}).assignment.id,
		).toBe(ids.replacement);
	});

	it("addresses the deciding assignment for an exact retry after the stage closed", () => {
		const decided = escalated();
		const stage = decided.stages[0];
		if (!stage) throw new Error("fixture");
		stage.assignments = stage.assignments.map((candidate) =>
			candidate.id === ids.replacement
				? {
						...candidate,
						status: "approved",
						resolvedAt: parseInstant("2026-09-03T08:00:00Z"),
						resolvedBy: {
							kind: "employee",
							employeeId: ids.replacementApprover,
							userId: null,
						},
					}
				: candidate,
		);
		expect(
			selectCanonicalDecisionTarget({
				workflow: decided,
				approvalRequestId: ids.legacyRequest,
				actorEmployeeId: ids.replacementApprover,
			}).assignment.id,
		).toBe(ids.replacement);
	});

	it("addresses an exact assignment identifier directly", () => {
		expect(
			selectCanonicalDecisionTarget({
				workflow: escalated(),
				approvalRequestId: ids.former,
				actorEmployeeId: ids.formerApprover,
			}).assignment.id,
		).toBe(ids.former);
	});

	it("does not treat a human reassignment as a revoking escalation", () => {
		expect(
			selectCanonicalDecisionTarget({
				workflow: escalated("reassignment"),
				approvalRequestId: ids.legacyRequest,
				actorEmployeeId: ids.formerApprover,
			}).assignment.id,
		).toBe(ids.replacement);
	});
});

describe("escalated lineage", () => {
	it("marks the replacement lineage and the replaced holder", () => {
		const stage = escalated().stages[0];
		if (!stage) throw new Error("fixture");
		expect(lineageContainsEscalation(stage, ids.replacement)).toBe(true);
		expect(lineageContainsEscalation(stage, ids.former)).toBe(false);
		expect(wasReplacedByEscalation(stage, ids.formerApprover)).toBe(true);
		expect(wasReplacedByEscalation(stage, ids.replacementApprover)).toBe(false);
	});

	it("ignores human reassignments", () => {
		const stage = escalated("reassignment").stages[0];
		if (!stage) throw new Error("fixture");
		expect(lineageContainsEscalation(stage, ids.replacement)).toBe(false);
		expect(wasReplacedByEscalation(stage, ids.formerApprover)).toBe(false);
	});
});

describe("decision revocation shared by every canonical kind (#326)", () => {
	function escalatedStage(kind: "escalation" | "reassignment" = "escalation") {
		const stage = escalated(kind).stages[0];
		if (!stage) throw new Error("fixture");
		const replacement = stage.assignments.find((candidate) => candidate.id === ids.replacement);
		if (!replacement) throw new Error("fixture");
		return { stage, replacement };
	}

	it("refuses the replaced holder's fresh decision of the replacement as reassigned", () => {
		const { stage, replacement } = escalatedStage();
		expect(() =>
			assertNotReplacedByEscalation({
				stage,
				target: replacement,
				actorEmployeeId: ids.formerApprover,
			}),
		).toThrow(ApprovalAssignmentReassignedError);
	});

	it("admits the replacement and actors who never held the lineage", () => {
		const { stage, replacement } = escalatedStage();
		for (const actorEmployeeId of [ids.replacementApprover, ids.manager]) {
			expect(() =>
				assertNotReplacedByEscalation({ stage, target: replacement, actorEmployeeId }),
			).not.toThrow();
		}
	});

	it("leaves decided targets (exact retries) and human reassignments alone", () => {
		const { stage, replacement } = escalatedStage();
		expect(() =>
			assertNotReplacedByEscalation({
				stage,
				target: { ...replacement, status: "approved" },
				actorEmployeeId: ids.formerApprover,
			}),
		).not.toThrow();
		const reassigned = escalatedStage("reassignment");
		expect(() =>
			assertNotReplacedByEscalation({
				stage: reassigned.stage,
				target: reassigned.replacement,
				actorEmployeeId: ids.formerApprover,
			}),
		).not.toThrow();
	});

	it("closes eligible-manager fallback on an escalated lineage only", () => {
		expect(eligibleManagerFallbackAllowed(escalatedStage().stage, ids.replacement)).toBe(false);
		expect(
			eligibleManagerFallbackAllowed(escalatedStage("reassignment").stage, ids.replacement),
		).toBe(true);
		const single = workflow([assignment({ id: ids.former })]).stages[0];
		if (!single) throw new Error("fixture");
		expect(eligibleManagerFallbackAllowed(single, ids.former)).toBe(true);
	});
});
