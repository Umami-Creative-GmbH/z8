import { describe, expect, it } from "vitest";
import { ConflictError, MonthClosedError } from "@/lib/effect/errors";
import { ApprovalAssignmentReassignedError } from "../escalation/decision-authority";
import { ApprovalEvidenceError } from "../evidence/errors";
import {
	inboxDecisionRight,
	inboxErrorOfTimeRefusal,
	inboxFailureOfTimeRefusal,
} from "./time-approval-decision";

describe("inboxErrorOfTimeRefusal", () => {
	it("gives the route a reassigned conflict for an escalation replacement", async () => {
		await expect(
			inboxErrorOfTimeRefusal(new ApprovalAssignmentReassignedError()),
		).resolves.toMatchObject({ _tag: "ConflictError", conflictType: "approval_reassigned" });
	});

	it("gives the route the evidence conflict with its code", async () => {
		await expect(
			inboxErrorOfTimeRefusal(new ApprovalEvidenceError("material_change")),
		).resolves.toMatchObject({
			_tag: "ConflictError",
			conflictType: "approval_evidence",
			details: { code: "material_change" },
		});
	});

	it("passes an already typed refusal through", async () => {
		const occupied = new ConflictError({
			message: "occupied",
			conflictType: "work_interval_occupied",
		});
		await expect(inboxErrorOfTimeRefusal(occupied)).resolves.toBe(occupied);
	});
});

describe("inboxFailureOfTimeRefusal", () => {
	it.each([
		["not_found", "not_found"],
		["already_decided", "stale"],
		["right_not_held", "forbidden"],
		["reassigned", "stale"],
		["own_request", "forbidden"],
		["changed", "stale"],
		["evidence_required", "stale"],
		["month_closed", "validation_failed"],
		["unclassified", "validation_failed"],
		["guard_failed", "stale"],
		["binding_mismatch", "stale"],
		["not_admitted", "stale"],
		["invocation_conflict", "stale"],
	] as const)("maps the refusal %s to the inbox failure %s", async (reason, code) => {
		await expect(inboxFailureOfTimeRefusal("approval-1", reason, undefined)).resolves.toMatchObject(
			{ id: "approval-1", code },
		);
	});

	it("keeps the fast-lane wording for a changed fast-lane assessment", async () => {
		await expect(
			inboxFailureOfTimeRefusal("approval-1", "guard_failed", undefined),
		).resolves.toEqual({
			id: "approval-1",
			code: "stale",
			message: "This fast-lane assessment changed. Refresh or open the request for manual review.",
		});
	});

	it("names the closed month", async () => {
		const failure = await inboxFailureOfTimeRefusal(
			"approval-1",
			"month_closed",
			new MonthClosedError({ message: "closed", month: "2026-07" }),
		);
		expect(failure.message).toContain("July 2026");
	});
});

const request = {
	approverId: "approver-1",
	requesterEmployeeId: "requester-1",
};

/** The visibility inputs that give the actor each right on `request`. */
function visibility(rights: {
	approver: boolean;
	manager: boolean;
	eligible: boolean;
	deputy: boolean;
}) {
	return {
		request,
		actorEmployeeId: rights.approver ? "approver-1" : "actor-1",
		includeAllApprovers: rights.manager || undefined,
		eligibleApprovalScopes: rights.eligible
			? [
					{
						requesterEmployeeId: "requester-1",
						eligibleApproverIds: ["approver-1", "actor-1"],
					},
				]
			: [],
		coveredApproverIds: rights.deputy ? ["approver-1"] : [],
	};
}

describe("inboxDecisionRight", () => {
	// approver, manager of approvals, eligible manager, covering deputy → the claimed right.
	it.each([
		[false, false, false, false, null],
		[false, false, false, true, { as: "covering_deputy", forEmployeeId: "approver-1" }],
		[false, false, true, false, { as: "eligible_manager" }],
		[false, false, true, true, { as: "eligible_manager" }],
		[false, true, false, false, { as: "approval_manager" }],
		[false, true, false, true, { as: "approval_manager" }],
		[false, true, true, false, { as: "approval_manager" }],
		[false, true, true, true, { as: "approval_manager" }],
		[true, false, false, false, { as: "approver" }],
		[true, false, false, true, { as: "approver" }],
		[true, false, true, false, { as: "approver" }],
		[true, false, true, true, { as: "approver" }],
		[true, true, false, false, { as: "approver" }],
		[true, true, false, true, { as: "approver" }],
		[true, true, true, false, { as: "approver" }],
		[true, true, true, true, { as: "approver" }],
	] as const)(
		"approver %s, manager of approvals %s, eligible manager %s, covering deputy %s claims %o",
		(approver, manager, eligible, deputy, expected) => {
			expect(inboxDecisionRight(visibility({ approver, manager, eligible, deputy }))).toEqual(
				expected,
			);
		},
	);

	it("does not claim eligibility from a scope of another requester or approver", () => {
		expect(
			inboxDecisionRight({
				request,
				actorEmployeeId: "actor-1",
				eligibleApprovalScopes: [
					{ requesterEmployeeId: "requester-2", eligibleApproverIds: ["approver-1", "actor-1"] },
					{ requesterEmployeeId: "requester-1", eligibleApproverIds: ["approver-2", "actor-1"] },
				],
			}),
		).toBeNull();
	});
});
