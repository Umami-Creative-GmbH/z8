import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { appendLegacyEscalationLineage } from "./legacy-escalation-lineage";
import { createLegacyApprovalObservationPlanner } from "./legacy-observation-planner";
import type {
	ApprovalEventActorIdentity,
	JsonObject,
	ObservedLegacyTransition,
	VerifiedLegacyApprovalState,
} from "./ports";

const organizationId = "org-1";
const sourceId = "20000000-0000-4000-8000-000000000001";
const requesterId = "30000000-0000-4000-8000-000000000001";
const approverA = "30000000-0000-4000-8000-00000000000a";
const approverB = "30000000-0000-4000-8000-00000000000b";
const approverC = "30000000-0000-4000-8000-00000000000c";
const managerId = "30000000-0000-4000-8000-00000000000d";
const requestId = "40000000-0000-4000-8000-000000000001";
const pendingSince = parseInstant("2026-07-18T09:00:00Z");
const firstTransfer = parseInstant("2026-07-20T09:00:00Z");
const secondTransfer = parseInstant("2026-07-22T09:00:00Z");
const decidedAt = parseInstant("2026-07-23T10:00:00Z");
const capturedAt = parseInstant("2026-07-23T10:00:01Z");
const source = {
	organizationId,
	workflowType: "absence" as const,
	sourceType: "absence_entry",
	sourceId,
};
const system: ApprovalEventActorIdentity = { kind: "system", employeeId: null, userId: null };
const planner = createLegacyApprovalObservationPlanner({
	clock: { nowInstant: () => parseInstant("2030-01-01T00:00:00Z") },
});

type Hop = {
	from: string;
	to: string;
	at: typeof firstTransfer;
	initiator: "scheduled" | "human";
	actorEmployeeId: string | null;
};
const scheduledHop: Hop = {
	from: approverA,
	to: approverB,
	at: firstTransfer,
	initiator: "scheduled",
	actorEmployeeId: null,
};
const humanHop: Hop = {
	from: approverB,
	to: approverC,
	at: secondTransfer,
	initiator: "human",
	actorEmployeeId: managerId,
};

function lineage(hops: Hop[]): JsonObject {
	let metadata: JsonObject = { origin: "legacy" };
	for (const hop of hops) {
		metadata = appendLegacyEscalationLineage(metadata, {
			pendingSince,
			transfer: {
				fromApproverEmployeeId: hop.from,
				toApproverEmployeeId: hop.to,
				transferredAt: hop.at,
				initiator: hop.initiator,
				actorEmployeeId: hop.actorEmployeeId,
			},
		});
	}
	return metadata;
}

function state(input: {
	status: "pending" | "approved" | "rejected";
	hops: Hop[];
	updatedAt: typeof firstTransfer;
}): VerifiedLegacyApprovalState {
	const approverId = input.hops.at(-1)?.to ?? approverA;
	return {
		organizationId,
		source: { ...source },
		approvalRequest: {
			id: requestId,
			organizationId,
			entityType: source.sourceType,
			entityId: sourceId,
			requestedBy: requesterId,
			approverId,
			status: input.status,
			reason: "Annual leave",
			rejectionReason: input.status === "rejected" ? "Coverage unavailable" : null,
			approvedAt: input.status === "approved" ? input.updatedAt : null,
			metadata: input.hops.length === 0 ? { origin: "legacy" } : lineage(input.hops),
			updatedAt: input.updatedAt,
		},
		chain: null,
		chainRows: [],
		sourceSnapshot: { id: sourceId, status: input.status },
		capturedAt,
	};
}

function transition(
	before: VerifiedLegacyApprovalState,
	after: VerifiedLegacyApprovalState,
	expectedVersion: number | null,
	actor: ApprovalEventActorIdentity = system,
): ObservedLegacyTransition {
	return {
		organizationId,
		source: { ...source },
		before,
		after,
		actor,
		idempotencyKey: "escalation:auto:legacy:v1:observation",
		expectedVersion,
	};
}

/** The assignment the submission observation created for the original approver. */
async function originalAssignmentId() {
	const submitted = await planner.plan(
		transition(
			{
				...state({ status: "pending", hops: [], updatedAt: pendingSince }),
				approvalRequest: null,
			},
			state({ status: "pending", hops: [], updatedAt: pendingSince }),
			null,
		),
	);
	return submitted.snapshot.stages[0]?.assignments[0]?.id;
}

describe("legacy observation of an escalation transfer", () => {
	it("observes a scheduled transfer as the cancelled original and an escalated replacement", async () => {
		const plan = await planner.plan(
			transition(
				state({ status: "pending", hops: [], updatedAt: pendingSince }),
				state({ status: "pending", hops: [scheduledHop], updatedAt: firstTransfer }),
				1,
			),
		);

		const stage = plan.snapshot.stages[0];
		expect(plan.snapshot).toMatchObject({
			status: "pending",
			version: 2,
			currentStageOrder: 1,
			submittedAt: pendingSince,
		});
		expect(stage).toMatchObject({ status: "pending", activatedAt: pendingSince });
		const [original, replacement] = stage?.assignments ?? [];
		expect(original).toMatchObject({
			id: await originalAssignmentId(),
			sequence: 1,
			approverEmployeeId: approverA,
			status: "cancelled",
			assignedAt: pendingSince,
			resolvedAt: firstTransfer,
			resolvedBy: { kind: "system", employeeId: null, userId: null },
			reassignedFromAssignmentId: null,
		});
		expect(replacement).toMatchObject({
			sequence: 2,
			approverEmployeeId: approverB,
			status: "pending",
			assignedAt: firstTransfer,
			resolvedAt: null,
			reassignedByEmployeeId: null,
			reassignedFromAssignmentId: original?.id,
			reassignmentMetadata: { kind: "escalation" },
		});
		expect(plan.events).toHaveLength(1);
		expect(plan.events[0]).toMatchObject({
			eventType: "assignment.escalated",
			version: 2,
			actor: system,
			previousState: { status: "pending" },
			resultingState: { status: "pending", targetEmployeeId: approverB },
			reason: "escalation",
			metadata: { kind: "escalation", sourceEmployeeId: approverA, stageId: stage?.id },
			references: {
				sourceAssignmentId: original?.id,
				targetAssignmentId: replacement?.id,
			},
			occurredAt: firstTransfer,
		});
		expect(plan.projection.activeInboxStage).toEqual({ stageId: stage?.id, stageOrder: 1 });
	});

	it("attributes a human transfer to the management actor", async () => {
		const actor: ApprovalEventActorIdentity = {
			kind: "employee",
			employeeId: managerId,
			userId: null,
		};
		const plan = await planner.plan(
			transition(
				state({ status: "pending", hops: [scheduledHop], updatedAt: firstTransfer }),
				state({ status: "pending", hops: [scheduledHop, humanHop], updatedAt: secondTransfer }),
				2,
				actor,
			),
		);

		const [, previous, current] = plan.snapshot.stages[0]?.assignments ?? [];
		expect(previous).toMatchObject({
			approverEmployeeId: approverB,
			status: "cancelled",
			resolvedAt: secondTransfer,
			resolvedBy: { kind: "employee", employeeId: managerId, userId: null },
		});
		expect(current).toMatchObject({
			sequence: 3,
			approverEmployeeId: approverC,
			status: "pending",
			reassignedByEmployeeId: managerId,
			reassignedFromAssignmentId: previous?.id,
		});
		expect(plan.events.map((event) => event.eventType)).toEqual(["assignment.escalated"]);
	});

	it("keeps the transfer history when the replacement later decides", async () => {
		const transferred = await planner.plan(
			transition(
				state({ status: "pending", hops: [], updatedAt: pendingSince }),
				state({ status: "pending", hops: [scheduledHop], updatedAt: firstTransfer }),
				1,
			),
		);
		const decided = await planner.plan(
			transition(
				state({ status: "pending", hops: [scheduledHop], updatedAt: firstTransfer }),
				state({ status: "approved", hops: [scheduledHop], updatedAt: decidedAt }),
				2,
				{ kind: "employee", employeeId: approverB, userId: null },
			),
		);

		const [originalBefore, replacementBefore] = transferred.snapshot.stages[0]?.assignments ?? [];
		const [originalAfter, replacementAfter] = decided.snapshot.stages[0]?.assignments ?? [];
		// The historical rows are rebuilt identically; only the replacement decides.
		expect(originalAfter).toEqual(originalBefore);
		expect(replacementAfter).toMatchObject({
			id: replacementBefore?.id,
			status: "approved",
			resolvedAt: decidedAt,
			resolvedBy: { kind: "employee", employeeId: approverB, userId: null },
		});
		expect(decided.snapshot).toMatchObject({
			status: "approved",
			version: 3,
			submittedAt: pendingSince,
		});
		expect(decided.snapshot.stages[0]?.activatedAt).toEqual(pendingSince);
		expect(decided.events.map((event) => event.eventType)).toEqual([
			"assignment.approved",
			"stage.approved",
			"workflow.approved",
		]);
		expect(decided.events[0]?.references).toEqual({ assignmentId: replacementBefore?.id });
	});

	it("rejects an approver change that the request's lineage does not explain", async () => {
		const unexplained = state({ status: "pending", hops: [], updatedAt: firstTransfer });
		if (!unexplained.approvalRequest) throw new Error("fixture");
		unexplained.approvalRequest.approverId = approverB;

		await expect(
			planner.plan(
				transition(state({ status: "pending", hops: [], updatedAt: pendingSince }), unexplained, 1),
			),
		).rejects.toMatchObject({ code: "invalid_lifecycle" });
	});

	it("rejects a lineage that changes without a transfer", async () => {
		await expect(
			planner.plan(
				transition(
					state({ status: "pending", hops: [scheduledHop], updatedAt: firstTransfer }),
					state({ status: "approved", hops: [], updatedAt: decidedAt }),
					2,
				),
			),
		).rejects.toMatchObject({ code: "invalid_lifecycle" });
	});

	it("rejects a transfer of a request that was never observed", async () => {
		await expect(
			planner.plan(
				transition(
					state({ status: "pending", hops: [], updatedAt: pendingSince }),
					state({ status: "pending", hops: [scheduledHop], updatedAt: firstTransfer }),
					null,
				),
			),
		).rejects.toMatchObject({ code: "invalid_lifecycle" });
	});

	it("rejects an unreadable lineage as invalid evidence", async () => {
		const malformed = state({ status: "pending", hops: [], updatedAt: pendingSince });
		if (!malformed.approvalRequest) throw new Error("fixture");
		malformed.approvalRequest.metadata = { escalation: { version: 7 } };

		await expect(
			planner.plan(
				transition(
					malformed,
					state({ status: "approved", hops: [], updatedAt: decidedAt }),
					1,
				),
			),
		).rejects.toMatchObject({ code: "invalid_evidence" });
	});
});
