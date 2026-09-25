import { describe, expect, it } from "vitest";
import { ApprovalEvidenceError } from "./errors";
import {
	deriveLegacyTravelExpenseDecisionOutcome,
	fingerprintLegacyTravelExpenseDecisionCommand,
	type LegacyTravelExpenseDecisionRows,
	travelExpenseDecisionIdempotencyKey,
} from "./travel-expense-decision";

const actor = "e1000000-0000-4000-8000-000000000001";
const other = "e1000000-0000-4000-8000-000000000002";
const approvedAt = new Date("2026-07-02T08:15:00.000Z");
const rejectedAt = new Date("2026-07-02T09:30:00.000Z");
const stageDecidedAt = new Date("2026-07-02T10:45:00.000Z");

function rows(
	overrides: Partial<{
		request: Partial<LegacyTravelExpenseDecisionRows["request"]>;
		chainStage: LegacyTravelExpenseDecisionRows["chainStage"];
		claim: Partial<LegacyTravelExpenseDecisionRows["claim"]>;
	}> = {},
): LegacyTravelExpenseDecisionRows {
	return {
		request: {
			id: "request-1",
			status: "approved",
			approverId: actor,
			approvedAt,
			updatedAt: approvedAt,
			...overrides.request,
		},
		chainStage: overrides.chainStage ?? null,
		claim: { status: "approved", decidedAt: approvedAt, ...overrides.claim },
	};
}

function incompleteField(run: () => unknown): string | undefined {
	try {
		run();
	} catch (error) {
		if (error instanceof ApprovalEvidenceError && error.code === "evidence_incomplete") {
			return error.details.field;
		}
		throw error;
	}
	return undefined;
}

describe("deriveLegacyTravelExpenseDecisionOutcome", () => {
	it("reads a single-stage approval from the persisted request approval time", () => {
		const outcome = deriveLegacyTravelExpenseDecisionOutcome(
			{ action: "approve", actorEmployeeId: actor },
			rows(),
		);
		expect(outcome.decidedAt.epochMilliseconds).toBe(approvedAt.getTime());
		expect({ ...outcome, decidedAt: undefined }).toEqual({
			assignmentOutcome: "approved",
			requestOutcome: "approved",
			decidedAt: undefined,
			decidedAtSource: "approval_request.approved_at",
			chainStageId: null,
			actorAuthority: "assigned_approver",
			claimStatus: "approved",
			legacyRequestStatus: "approved",
		});
	});

	it("reads a rejection from the update written with the rejected status", () => {
		const outcome = deriveLegacyTravelExpenseDecisionOutcome(
			{ action: "reject", actorEmployeeId: actor },
			rows({
				request: { status: "rejected", approvedAt: null, updatedAt: rejectedAt },
				claim: { status: "rejected", decidedAt: rejectedAt },
			}),
		);
		expect(outcome).toMatchObject({
			assignmentOutcome: "rejected",
			requestOutcome: "rejected",
			decidedAtSource: "approval_request.updated_at",
		});
		expect(outcome.decidedAt.epochMilliseconds).toBe(rejectedAt.getTime());
	});

	it("keeps an intermediate chain approval pending and uses the stage decision", () => {
		const outcome = deriveLegacyTravelExpenseDecisionOutcome(
			{ action: "approve", actorEmployeeId: actor },
			rows({
				chainStage: {
					id: "stage-1",
					status: "approved",
					decidedAt: stageDecidedAt,
					decidedBy: actor,
				},
				claim: { status: "submitted", decidedAt: null },
			}),
		);
		expect(outcome).toMatchObject({
			assignmentOutcome: "approved",
			requestOutcome: "pending",
			decidedAtSource: "approval_chain_stage_instance.decided_at",
			chainStageId: "stage-1",
			claimStatus: "submitted",
		});
		expect(outcome.decidedAt.epochMilliseconds).toBe(stageDecidedAt.getTime());
	});

	it("records an authorized actor who is not the assigned approver without pretending", () => {
		expect(
			deriveLegacyTravelExpenseDecisionOutcome(
				{ action: "approve", actorEmployeeId: actor },
				rows({ request: { approverId: other } }),
			).actorAuthority,
		).toBe("other_authorized_approver");
	});

	it("refuses outcomes the persisted rows do not confirm", () => {
		// The request says something other than the requested action.
		expect(
			incompleteField(() =>
				deriveLegacyTravelExpenseDecisionOutcome(
					{ action: "reject", actorEmployeeId: actor },
					rows(),
				),
			),
		).toBe("assignment_outcome");
		// A chain stage decided by someone else.
		expect(
			incompleteField(() =>
				deriveLegacyTravelExpenseDecisionOutcome(
					{ action: "approve", actorEmployeeId: actor },
					rows({
						chainStage: {
							id: "stage-1",
							status: "approved",
							decidedAt: stageDecidedAt,
							decidedBy: other,
						},
						claim: { status: "submitted", decidedAt: null },
					}),
				),
			),
		).toBe("assignment_outcome");
		// Without a chain, an approval must finish the claim.
		expect(
			incompleteField(() =>
				deriveLegacyTravelExpenseDecisionOutcome(
					{ action: "approve", actorEmployeeId: actor },
					rows({ claim: { status: "submitted", decidedAt: null } }),
				),
			),
		).toBe("request_outcome");
		// A terminal claim without its persisted decision time.
		expect(
			incompleteField(() =>
				deriveLegacyTravelExpenseDecisionOutcome(
					{ action: "approve", actorEmployeeId: actor },
					rows({ claim: { decidedAt: null } }),
				),
			),
		).toBe("request_outcome");
		// No persisted decision time for the request.
		expect(
			incompleteField(() =>
				deriveLegacyTravelExpenseDecisionOutcome(
					{ action: "approve", actorEmployeeId: actor },
					rows({ request: { approvedAt: null } }),
				),
			),
		).toBe("assignment_outcome");
	});
});

describe("expense decision identity", () => {
	it("fingerprints action, exact request and reason without storing the reason", () => {
		const base = fingerprintLegacyTravelExpenseDecisionCommand({
			action: "reject",
			approvalRequestId: "request-1",
			reason: "Missing receipt",
		});
		expect(base).toMatch(/^travel-expense-legacy-decision:v1:[0-9a-f]{64}$/);
		expect(base).not.toContain("Missing receipt");
		expect(
			fingerprintLegacyTravelExpenseDecisionCommand({
				action: "reject",
				approvalRequestId: "request-2",
				reason: "Missing receipt",
			}),
		).not.toBe(base);
		expect(
			fingerprintLegacyTravelExpenseDecisionCommand({
				action: "reject",
				approvalRequestId: "request-1",
				reason: "Other",
			}),
		).not.toBe(base);
	});

	it("keys a semantic decision by claim, exact request, action and reason hash", () => {
		const key = travelExpenseDecisionIdempotencyKey({
			claimId: "claim-1",
			approvalRequestId: "request-1",
			action: "approve",
			reason: undefined,
		});
		expect(key).toMatch(/^travel_expense_claim:claim-1:request-1:approve:[0-9a-f]{64}$/);
		expect(key).not.toBe(
			travelExpenseDecisionIdempotencyKey({
				claimId: "claim-1",
				approvalRequestId: "request-2",
				action: "approve",
				reason: undefined,
			}),
		);
	});
});
