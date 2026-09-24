import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { ApprovalAssignmentSnapshot, ApprovalStageSnapshot } from "../workflow/ports";
import {
	automaticEscalationOperationKey,
	classifyCanonicalAssignmentEvidence,
	decideAutomaticEscalation,
	type EscalationCandidateFact,
	escalationRequestFingerprint,
	humanEscalationOperationKey,
	orderEscalationCandidates,
} from "./transfer-evaluation";

const ids = {
	workflow: "60000000-0000-4000-8000-000000000001",
	stage: "70000000-0000-4000-8000-000000000001",
	root: "80000000-0000-4000-8000-000000000001",
	second: "80000000-0000-4000-8000-000000000002",
	third: "80000000-0000-4000-8000-000000000003",
	requester: "30000000-0000-4000-8000-000000000001",
	approverA: "30000000-0000-4000-8000-00000000000a",
	approverB: "30000000-0000-4000-8000-00000000000b",
	approverC: "30000000-0000-4000-8000-00000000000c",
	sibling: "30000000-0000-4000-8000-00000000000d",
} as const;

const assignedAt = parseInstant("2026-09-01T08:00:00Z");
const rollout = parseInstant("2026-09-10T12:00:00Z");

function assignment(
	overrides: Partial<ApprovalAssignmentSnapshot> & { id: string },
): ApprovalAssignmentSnapshot {
	return {
		organizationId: "org-1",
		workflowId: ids.workflow,
		stageId: ids.stage,
		sequence: 1,
		approverEmployeeId: ids.approverA,
		status: "pending",
		assignedAt,
		resolvedAt: null,
		resolvedBy: null,
		reassignedByEmployeeId: null,
		reassignedFromAssignmentId: null,
		reassignmentMetadata: null,
		...overrides,
	};
}

function stage(
	assignments: ApprovalAssignmentSnapshot[],
	resolverSnapshot: ApprovalStageSnapshot["resolverSnapshot"] = {
		approverType: "manager",
	},
): ApprovalStageSnapshot {
	return {
		id: ids.stage,
		organizationId: "org-1",
		workflowId: ids.workflow,
		sequence: 1,
		label: "Approval",
		resolverSnapshot,
		activationMode: "human",
		status: "pending",
		activatedAt: assignedAt,
		decidedAt: null,
		decisionReason: null,
		legacyApprovalRequestId: null,
		assignments,
	};
}

/** Root replaced by `second` (escalation or reassignment), still pending. */
function replacedLineage(kind: "escalation" | "reassignment") {
	const root = assignment({
		id: ids.root,
		status: "cancelled",
		resolvedAt: parseInstant("2026-09-02T08:00:00Z"),
	});
	const second = assignment({
		id: ids.second,
		sequence: 2,
		approverEmployeeId: ids.approverB,
		assignedAt: parseInstant("2026-09-02T08:00:00Z"),
		reassignedFromAssignmentId: ids.root,
		reassignmentMetadata: { kind },
	});
	return { stage: stage([root, second]), source: second };
}

describe("classifyCanonicalAssignmentEvidence", () => {
	it("uses the native assigned instant of an original canonical assignment", () => {
		const source = assignment({ id: ids.root });
		expect(
			classifyCanonicalAssignmentEvidence({
				stage: stage([source]),
				source,
				transfers: [],
				rolloutFallbackAt: null,
			}),
		).toEqual({
			kind: "established",
			lineageRootAssignmentId: ids.root,
			lineageAssignmentIds: [ids.root],
			actionableAt: assignedAt,
			actionableEvidence: "assignment_assigned_at",
			automaticTransferConsumed: false,
		});
	});

	it("never trusts a reconstructed legacy timestamp; it uses the recorded rollout fallback", () => {
		const source = assignment({ id: ids.root });
		const observed = stage([source], {
			kind: "legacy_direct",
			approvalRequestId: ids.root,
		});
		expect(
			classifyCanonicalAssignmentEvidence({
				stage: observed,
				source,
				transfers: [],
				rolloutFallbackAt: rollout,
			}),
		).toMatchObject({
			kind: "established",
			actionableAt: rollout,
			actionableEvidence: "rollout_fallback",
		});
		expect(
			classifyCanonicalAssignmentEvidence({
				stage: observed,
				source,
				transfers: [],
				rolloutFallbackAt: null,
			}),
		).toMatchObject({
			kind: "ambiguous",
			cause: "actionable_instant_unproven",
			lineageRootAssignmentId: ids.root,
		});
	});

	it("keeps a later reconstructed timestamp so the fallback never shortens a window", () => {
		const later = parseInstant("2026-09-15T00:00:00Z");
		const source = assignment({ id: ids.root, assignedAt: later });
		expect(
			classifyCanonicalAssignmentEvidence({
				stage: stage([source], { kind: "legacy_chain" }),
				source,
				transfers: [],
				rolloutFallbackAt: rollout,
			}),
		).toMatchObject({ actionableAt: later, actionableEvidence: "rollout_fallback" });
	});

	it("uses the engine-created assignment instant for a replacement in an observed stage", () => {
		const { stage: replaced, source } = replacedLineage("reassignment");
		expect(
			classifyCanonicalAssignmentEvidence({
				stage: { ...replaced, resolverSnapshot: { kind: "legacy_direct" } },
				source,
				transfers: [],
				rolloutFallbackAt: null,
			}),
		).toMatchObject({
			kind: "established",
			actionableAt: source.assignedAt,
			actionableEvidence: "assignment_assigned_at",
			lineageRootAssignmentId: ids.root,
			lineageAssignmentIds: [ids.root, ids.second],
		});
	});

	it("counts only a journaled scheduled transfer against the lineage allowance", () => {
		const { stage: replaced, source } = replacedLineage("escalation");
		const classify = (initiator: "scheduled" | "human") =>
			classifyCanonicalAssignmentEvidence({
				stage: replaced,
				source,
				transfers: [
					{
						sourceAssignmentId: ids.root,
						replacementAssignmentId: ids.second,
						initiator,
					},
				],
				rolloutFallbackAt: null,
			});
		expect(classify("scheduled")).toMatchObject({
			automaticTransferConsumed: true,
		});
		expect(classify("human")).toMatchObject({
			automaticTransferConsumed: false,
		});
	});

	it("keeps a consumed allowance after a later human reassignment", () => {
		const { stage: replaced } = replacedLineage("escalation");
		const second = replaced.assignments[1];
		if (!second) throw new Error("fixture");
		const third = assignment({
			id: ids.third,
			sequence: 3,
			approverEmployeeId: ids.approverC,
			assignedAt: parseInstant("2026-09-03T08:00:00Z"),
			reassignedFromAssignmentId: ids.second,
			reassignmentMetadata: { kind: "reassignment" },
		});
		const history = stage([
			replaced.assignments[0] as ApprovalAssignmentSnapshot,
			{
				...second,
				status: "cancelled",
				resolvedAt: parseInstant("2026-09-03T08:00:00Z"),
			},
			third,
		]);
		expect(
			classifyCanonicalAssignmentEvidence({
				stage: history,
				source: third,
				transfers: [
					{
						sourceAssignmentId: ids.root,
						replacementAssignmentId: ids.second,
						initiator: "scheduled",
					},
				],
				rolloutFallbackAt: null,
			}),
		).toMatchObject({
			kind: "established",
			lineageRootAssignmentId: ids.root,
			automaticTransferConsumed: true,
			actionableAt: third.assignedAt,
		});
	});

	it("holds an escalation without journal evidence instead of assuming an unused allowance", () => {
		const { stage: replaced, source } = replacedLineage("escalation");
		expect(
			classifyCanonicalAssignmentEvidence({
				stage: replaced,
				source,
				transfers: [],
				rolloutFallbackAt: null,
			}),
		).toMatchObject({
			kind: "ambiguous",
			cause: "unjournaled_escalation",
			lineageRootAssignmentId: ids.root,
		});
	});

	it("holds a lineage whose source assignment is missing", () => {
		const source = assignment({
			id: ids.second,
			reassignedFromAssignmentId: ids.root,
			reassignmentMetadata: { kind: "reassignment" },
		});
		expect(
			classifyCanonicalAssignmentEvidence({
				stage: stage([source]),
				source,
				transfers: [],
				rolloutFallbackAt: null,
			}),
		).toMatchObject({
			kind: "ambiguous",
			cause: "lineage_source_missing",
			lineageRootAssignmentId: null,
		});
	});

	it("holds a journal entry that contradicts the lineage", () => {
		const { stage: replaced, source } = replacedLineage("reassignment");
		expect(
			classifyCanonicalAssignmentEvidence({
				stage: replaced,
				source,
				transfers: [
					{
						sourceAssignmentId: ids.root,
						replacementAssignmentId: ids.third,
						initiator: "scheduled",
					},
				],
				rolloutFallbackAt: null,
			}),
		).toMatchObject({ kind: "ambiguous", cause: "journal_lineage_mismatch" });
	});
});

function candidate(
	employeeId: string,
	overrides: Partial<EscalationCandidateFact> = {},
): EscalationCandidateFact {
	return {
		employeeId,
		isPrimary: false,
		relationshipSince: null,
		hasDecisionPath: true,
		...overrides,
	};
}

describe("orderEscalationCandidates", () => {
	const order = (candidates: EscalationCandidateFact[]) =>
		orderEscalationCandidates({
			candidates,
			requesterEmployeeId: ids.requester,
			currentApproverEmployeeId: ids.approverA,
			pendingSiblingApproverIds: [ids.sibling],
		}).map((fact) => fact.employeeId);

	it("orders primary, then longest relationship, then stable identifier", () => {
		expect(
			order([
				candidate(ids.approverC, {
					relationshipSince: parseInstant("2025-01-01T00:00:00Z"),
				}),
				candidate("30000000-0000-4000-8000-0000000000f1"),
				candidate("30000000-0000-4000-8000-0000000000f0"),
				candidate(ids.approverB, {
					relationshipSince: parseInstant("2024-01-01T00:00:00Z"),
				}),
				candidate("30000000-0000-4000-8000-0000000000e0", { isPrimary: true }),
			]),
		).toEqual([
			"30000000-0000-4000-8000-0000000000e0",
			ids.approverB,
			ids.approverC,
			"30000000-0000-4000-8000-0000000000f0",
			"30000000-0000-4000-8000-0000000000f1",
		]);
	});

	it("excludes the requester, current and sibling assignees, and anyone without a decision path", () => {
		expect(
			order([
				candidate(ids.requester, { isPrimary: true }),
				candidate(ids.approverA),
				candidate(ids.sibling),
				candidate(ids.approverB, { hasDecisionPath: false }),
				candidate(ids.approverC),
			]),
		).toEqual([ids.approverC]);
	});
});

describe("decideAutomaticEscalation", () => {
	const established = () =>
		classifyCanonicalAssignmentEvidence({
			stage: stage([assignment({ id: ids.root })]),
			source: assignment({ id: ids.root }),
			transfers: [],
			rolloutFallbackAt: null,
		});
	const policy = { enabled: true, responseWindowHours: 24, revision: 3 };
	const deadline = parseInstant("2026-09-02T08:00:00Z");

	it("is not due one instant before the exact deadline, and due at it", () => {
		expect(
			decideAutomaticEscalation({
				evidence: established(),
				policy,
				now: deadline.subtract({ nanoseconds: 1 }),
				unsupportedRoute: null,
				orderedCandidates: [candidate(ids.approverB)],
			}),
		).toMatchObject({ kind: "not_due", deadline: { kind: "not_due" } });
		expect(
			decideAutomaticEscalation({
				evidence: established(),
				policy,
				now: deadline,
				unsupportedRoute: null,
				orderedCandidates: [candidate(ids.approverB), candidate(ids.approverC)],
			}),
		).toEqual({
			kind: "transfer",
			recipientEmployeeId: ids.approverB,
			deadlineAt: deadline,
			policyRevision: 3,
		});
	});

	it("does nothing while the organization policy is disabled", () => {
		expect(
			decideAutomaticEscalation({
				evidence: established(),
				policy: { ...policy, enabled: false },
				now: deadline,
				unsupportedRoute: null,
				orderedCandidates: [candidate(ids.approverB)],
			}),
		).toMatchObject({ kind: "not_due", deadline: { kind: "disabled" } });
	});

	it("raises replacement_overdue instead of a second automatic transfer", () => {
		const evidence = established();
		if (evidence.kind !== "established") throw new Error("fixture");
		expect(
			decideAutomaticEscalation({
				evidence: { ...evidence, automaticTransferConsumed: true },
				policy,
				now: deadline,
				unsupportedRoute: null,
				orderedCandidates: [candidate(ids.approverB)],
			}),
		).toMatchObject({ kind: "hold", reason: "replacement_overdue" });
	});

	it("holds an unsupported route and a missing backup without broadening authority", () => {
		expect(
			decideAutomaticEscalation({
				evidence: established(),
				policy,
				now: deadline,
				unsupportedRoute: "parallel_assignments_without_replacement_inbox",
				orderedCandidates: [candidate(ids.approverB)],
			}),
		).toMatchObject({
			kind: "hold",
			reason: "unsupported_route",
			evidence: { route: "parallel_assignments_without_replacement_inbox" },
		});
		expect(
			decideAutomaticEscalation({
				evidence: established(),
				policy,
				now: deadline,
				unsupportedRoute: null,
				orderedCandidates: [],
			}),
		).toMatchObject({
			kind: "hold",
			reason: "no_eligible_backup",
			evidence: {
				policyRevision: 3,
				actionableEvidence: "assignment_assigned_at",
			},
		});
	});

	it("holds ambiguous history with its cause", () => {
		expect(
			decideAutomaticEscalation({
				evidence: {
					kind: "ambiguous",
					lineageRootAssignmentId: ids.root,
					cause: "unjournaled_escalation",
					evidence: { assignmentId: ids.second },
				},
				policy,
				now: deadline,
				unsupportedRoute: null,
				orderedCandidates: [candidate(ids.approverB)],
			}),
		).toEqual({
			kind: "hold",
			reason: "ambiguous_history",
			evidence: { cause: "unjournaled_escalation", assignmentId: ids.second },
		});
	});
});

describe("escalation operation identity", () => {
	it("is stable across runs and independent of the chosen replacement", () => {
		const key = automaticEscalationOperationKey({
			workflowId: ids.workflow,
			stageId: ids.stage,
			lineageRootAssignmentId: ids.root,
			sourceAssignmentId: ids.second,
		});
		expect(key).toBe(`escalation:auto:v1:${ids.workflow}:${ids.stage}:${ids.root}:${ids.second}`);
		expect(humanEscalationOperationKey({ actorUserId: "user-1", idempotencyKey: "k" })).toBe(
			"escalation:human:v1:user-1:k",
		);
	});

	it("fingerprints the requested human operation", () => {
		const base = {
			initiator: "human" as const,
			actorUserId: "user-1",
			sourceAssignmentId: ids.root,
			requestedRecipientEmployeeId: ids.approverB,
			reason: null,
		};
		expect(escalationRequestFingerprint(base)).toBe(escalationRequestFingerprint({ ...base }));
		expect(escalationRequestFingerprint(base)).not.toBe(
			escalationRequestFingerprint({
				...base,
				requestedRecipientEmployeeId: ids.approverC,
			}),
		);
	});
});
