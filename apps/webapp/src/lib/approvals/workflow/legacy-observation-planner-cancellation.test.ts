import { describe, expect, it } from "vitest";
import { instantToCanonicalString, parseInstant } from "@/lib/datetime/temporal-core";
import { buildRequesterCancellationMarker } from "../domain-adapters/time-correction-cancellation-marker";
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
const requestId = "40000000-0000-4000-8000-000000000001";
const chainId = "50000000-0000-4000-8000-000000000001";
const pendingSince = parseInstant("2026-07-18T09:00:00Z");
const transferredAt = parseInstant("2026-07-20T09:00:00Z");
const cancelledAt = parseInstant("2026-07-21T10:00:00Z");
const tombstoneUpdatedAt = parseInstant("2026-07-21T10:00:00.004Z");
const capturedAt = parseInstant("2026-07-21T10:00:00Z");
const source = {
	organizationId,
	workflowType: "time_correction" as const,
	sourceType: "time_entry",
	sourceId,
};
const requester: ApprovalEventActorIdentity = {
	kind: "employee",
	employeeId: requesterId,
	userId: "requester-user",
};
const planner = createLegacyApprovalObservationPlanner({
	clock: { nowInstant: () => parseInstant("2030-01-01T00:00:00Z") },
});

const payload: JsonObject = {
	timeCorrection: { action: "edit", clockInCorrectionId: "entry-1" },
	submission: { key: "submission-key", resultKind: "default_created", originalStatus: "pending" },
};

function marker(
	overrides: Partial<Parameters<typeof buildRequesterCancellationMarker>[0]> = {},
): JsonObject {
	return {
		...buildRequesterCancellationMarker({
			organizationId,
			requesterEmployeeId: requesterId,
			requesterUserId: "requester-user",
			workPeriodId: sourceId,
			chainInstanceId: null,
			cancelledAt: instantToCanonicalString(cancelledAt),
			...overrides,
		}),
	};
}

function transferredMetadata(metadata: JsonObject): JsonObject {
	return appendLegacyEscalationLineage(metadata, {
		pendingSince,
		transfer: {
			fromApproverEmployeeId: approverA,
			toApproverEmployeeId: approverB,
			transferredAt,
			initiator: "scheduled",
			actorEmployeeId: null,
		},
	});
}

function pending(options: { transferred?: boolean } = {}): VerifiedLegacyApprovalState {
	return {
		organizationId,
		source: { ...source },
		approvalRequest: {
			id: requestId,
			organizationId,
			entityType: source.sourceType,
			entityId: sourceId,
			requestedBy: requesterId,
			approverId: options.transferred ? approverB : approverA,
			status: "pending",
			reason: "Forgot to clock",
			rejectionReason: null,
			approvedAt: null,
			metadata: options.transferred ? transferredMetadata(payload) : payload,
			updatedAt: options.transferred ? transferredAt : pendingSince,
		},
		chain: null,
		chainRows: [],
		sourceSnapshot: { id: sourceId, status: "pending" },
		capturedAt,
	};
}

/** The retained tombstone the requester's cancellation writes (#301). */
function tombstone(
	options: {
		transferred?: boolean;
		cancellation?: JsonObject;
		approvedAt?: typeof cancelledAt;
	} = {},
): VerifiedLegacyApprovalState {
	const base = pending(options);
	if (!base.approvalRequest) throw new Error("fixture");
	const metadata = { ...payload, cancellation: options.cancellation ?? marker() };
	return {
		...base,
		approvalRequest: {
			...base.approvalRequest,
			status: "rejected",
			rejectionReason: null,
			approvedAt: options.approvedAt ?? cancelledAt,
			metadata: options.transferred ? transferredMetadata(metadata) : metadata,
			updatedAt: tombstoneUpdatedAt,
		},
		sourceSnapshot: { id: sourceId, status: "cancelled" },
	};
}

function transition(
	before: VerifiedLegacyApprovalState,
	after: VerifiedLegacyApprovalState,
	expectedVersion: number | null,
): ObservedLegacyTransition {
	return {
		organizationId,
		source: { ...source },
		before,
		after,
		actor: requester,
		idempotencyKey: "time-correction:cancel",
		expectedVersion,
	};
}

describe("legacy observation of a requester's retained correction cancellation (#463)", () => {
	it("plans the tombstone of a pending direct request as a cancellation at its instant", async () => {
		const plan = await planner.plan(transition(pending(), tombstone(), 1));

		expect(plan.snapshot).toMatchObject({
			status: "cancelled",
			currentStageOrder: null,
			version: 2,
			submittedAt: pendingSince,
			completedAt: cancelledAt,
			cancelledAt,
			decisionReason: "Legacy pending request cancelled by requester",
		});
		expect(plan.snapshot.stages[0]).toMatchObject({
			status: "cancelled",
			decidedAt: cancelledAt,
			decisionReason: "Legacy pending request cancelled by requester",
			assignments: [
				{
					approverEmployeeId: approverA,
					status: "cancelled",
					resolvedAt: cancelledAt,
					resolvedBy: { kind: "employee", employeeId: requesterId, userId: null },
				},
			],
		});
		expect(plan.events.map((event) => event.eventType)).toEqual([
			"assignment.cancelled",
			"stage.cancelled",
			"workflow.cancelled",
		]);
		expect(plan.projection).toMatchObject({ status: "cancelled", activeInboxStage: null });
	});

	it("keeps the escalation holders of a transferred request it cancels", async () => {
		const transferred = await planner.plan(
			transition(pending(), pending({ transferred: true }), 1),
		);
		const plan = await planner.plan(
			transition(pending({ transferred: true }), tombstone({ transferred: true }), 2),
		);

		const [originalBefore, replacementBefore] = transferred.snapshot.stages[0]?.assignments ?? [];
		const [originalAfter, replacementAfter] = plan.snapshot.stages[0]?.assignments ?? [];
		expect(originalAfter).toEqual(originalBefore);
		expect(replacementAfter).toMatchObject({
			id: replacementBefore?.id,
			approverEmployeeId: approverB,
			status: "cancelled",
			resolvedAt: cancelledAt,
			reassignedFromAssignmentId: originalBefore?.id,
		});
		expect(plan.snapshot).toMatchObject({ status: "cancelled", version: 3 });
		expect(plan.events[0]?.references).toEqual({ assignmentId: replacementBefore?.id });
	});

	it("refuses a tombstone whose lineage dropped a transfer", async () => {
		await expect(
			planner.plan(transition(pending({ transferred: true }), tombstone(), 2)),
		).rejects.toMatchObject({ code: "invalid_lifecycle" });
	});

	it.each([
		["another work period", { cancellation: marker({ workPeriodId: "other-period" }) }],
		["another requester", { cancellation: marker({ requesterEmployeeId: approverB }) }],
		["a chain", { cancellation: marker({ chainInstanceId: chainId }) }],
		["a different instant", { approvedAt: parseInstant("2026-07-21T10:00:01Z") }],
		["an unreadable marker", { cancellation: { kind: "requester" } }],
	] as const)("refuses a tombstone whose marker names %s", async (_label, options) => {
		await expect(planner.plan(transition(pending(), tombstone(options), 1))).rejects.toMatchObject({
			code: "invalid_evidence",
		});
	});

	it("never replans an already cancelled tombstone", async () => {
		await expect(planner.plan(transition(tombstone(), tombstone(), 2))).rejects.toMatchObject({
			code: "invalid_lifecycle",
		});
	});

	it("keeps refusing a reasonless rejection outside time corrections", async () => {
		const observed = transition(pending(), tombstone(), 1);
		const absence = { ...source, workflowType: "absence" as const, sourceType: "absence_entry" };
		for (const state of [observed.before, observed.after]) {
			state.source = { ...absence };
			if (state.approvalRequest) state.approvalRequest.entityType = absence.sourceType;
		}

		await expect(planner.plan({ ...observed, source: absence })).rejects.toMatchObject({
			code: "invalid_evidence",
		});
	});
});
