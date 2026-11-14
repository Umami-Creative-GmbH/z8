import { describe, expect, it } from "vitest";
import {
	inboxDecisionRight,
	inboxErrorOfTimeRefusal,
	inboxFailureOfTimeRefusal,
} from "./time-approval-inbox-decision";

describe("inboxErrorOfTimeRefusal", () => {
	it("gives the route a reassigned conflict for an escalation replacement", () => {
		expect(inboxErrorOfTimeRefusal({ reason: "reassigned" })).toMatchObject({
			_tag: "ConflictError",
			conflictType: "approval_reassigned",
		});
	});

	it.each(["material_change", "evidence_incomplete"] as const)(
		"gives the route the evidence conflict with its code %s",
		(code) => {
			expect(
				inboxErrorOfTimeRefusal({
					reason: code === "material_change" ? "changed" : "evidence_required",
					detail: { kind: "evidence", code },
				}),
			).toMatchObject({
				_tag: "ConflictError",
				conflictType: "approval_evidence",
				details: { code },
			});
		},
	);

	it("gives the route the overlaps of an occupied interval", () => {
		const overlaps = [
			{
				kind: "work_period" as const,
				id: "wp-1",
				startAt: "2026-07-22T10:15:00Z",
				endAt: "2026-07-22T10:45:00Z",
			},
		];
		expect(
			inboxErrorOfTimeRefusal({ reason: "changed", detail: { kind: "work_overlap", overlaps } }),
		).toMatchObject({
			_tag: "ConflictError",
			conflictType: "work_interval_occupied",
			details: { overlaps },
		});
	});

	it.each([
		["not_found", "NotFoundError"],
		["already_decided", "ConflictError"],
		["right_not_held", "AuthorizationError"],
		["own_request", "AuthorizationError"],
		["changed", "ConflictError"],
		["evidence_required", "ConflictError"],
		["unclassified", "ValidationError"],
		["guard_failed", "ConflictError"],
	] as const)("gives the route the %s refusal as a %s", (reason, tag) => {
		expect(inboxErrorOfTimeRefusal({ reason })).toMatchObject({ _tag: tag });
	});

	it("words a deputy's four-eyes refusal as such", () => {
		expect(
			inboxErrorOfTimeRefusal({ reason: "right_not_held", detail: { kind: "deputy_four_eyes" } }),
		).toMatchObject({
			_tag: "AuthorizationError",
			message:
				"You already decided an earlier stage of this request, so you cannot decide it as a deputy",
		});
	});

	it("names the closed month", () => {
		expect(
			inboxErrorOfTimeRefusal({
				reason: "month_closed",
				detail: { kind: "month_closed", month: "2026-07" },
			}),
		).toMatchObject({ _tag: "MonthClosedError", month: "2026-07" });
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
		await expect(inboxFailureOfTimeRefusal("approval-1", { reason })).resolves.toMatchObject({
			id: "approval-1",
			code,
		});
	});

	it("keeps the fast-lane wording for a changed fast-lane assessment", async () => {
		await expect(
			inboxFailureOfTimeRefusal("approval-1", { reason: "guard_failed" }),
		).resolves.toEqual({
			id: "approval-1",
			code: "stale",
			message: "This fast-lane assessment changed. Refresh or open the request for manual review.",
		});
	});

	it("words a bulk deputy's four-eyes refusal as such, not as a missing right", async () => {
		await expect(
			inboxFailureOfTimeRefusal("approval-1", {
				reason: "right_not_held",
				detail: { kind: "deputy_four_eyes" },
			}),
		).resolves.toEqual({
			id: "approval-1",
			code: "forbidden",
			message:
				"You already decided an earlier stage of this request, so you cannot decide it as a deputy",
		});
	});

	it("names the closed month", async () => {
		const failure = await inboxFailureOfTimeRefusal("approval-1", {
			reason: "month_closed",
			detail: { kind: "month_closed", month: "2026-07" },
		});
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
