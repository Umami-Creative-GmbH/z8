import { describe, expect, it } from "vitest";
import { ValidationError } from "@/lib/effect/errors";
import type { LegacyRouteFailure } from "../policies/legacy-route-decision";
import type { ApprovalPolicyDraft, ApprovalPolicyStageDraft } from "../policies/types";
import { ApprovalRoutingPolicyValidationError } from "../routing/policy-matcher";
import { absenceCategoryNeedsApproval, absenceRouteFallback } from "./rules";

const policy = { id: "policy-1", name: "Policy", stages: [] } as unknown as ApprovalPolicyDraft;
const stage = { id: "stage-1" } as unknown as ApprovalPolicyStageDraft;
const error = new ValidationError({ message: "unresolvable", field: "approvalPolicyStage" });

const routeFailures: [string, LegacyRouteFailure][] = [
	["no_default_approver", { kind: "failure", reason: "no_default_approver", error }],
	["stage_unresolvable", { kind: "failure", reason: "stage_unresolvable", policy, stage, error }],
	["policy_has_no_stages", { kind: "failure", reason: "policy_has_no_stages", policy, error }],
];

describe("absence route rules", () => {
	it("starts a route only for a category that requires approval", () => {
		expect(absenceCategoryNeedsApproval({ requiresApproval: true })).toBe(true);
		expect(absenceCategoryNeedsApproval({ requiresApproval: false })).toBe(false);
	});

	it.each(routeFailures)("falls back to the default approver on %s", (_, failure) => {
		expect(
			absenceRouteFallback({
				failure,
				requesterEmployeeId: "emp-requester",
				defaultApproverId: "emp-manager",
			}),
		).toEqual({
			kind: "default_approver",
			approverEmployeeId: "emp-manager",
			disposition: { kind: "human", approverEmployeeId: "emp-manager" },
		});
	});

	it.each(routeFailures)("fails with no default approver on %s", (_, failure) => {
		expect(
			absenceRouteFallback({
				failure,
				requesterEmployeeId: "emp-requester",
				defaultApproverId: null,
			}),
		).toEqual({ kind: "no_default_approver" });
	});

	it("completes the fallback on submission when the requester is their own default approver", () => {
		const [, failure] = routeFailures[1] as [string, LegacyRouteFailure];
		expect(
			absenceRouteFallback({
				failure,
				requesterEmployeeId: "emp-requester",
				defaultApproverId: "emp-requester",
			}),
		).toEqual({
			kind: "default_approver",
			approverEmployeeId: "emp-requester",
			disposition: { kind: "auto_approve", reason: "requester_is_approver" },
		});
	});

	it("does not fall back on malformed policies: submitting throws on them", () => {
		expect(
			absenceRouteFallback({
				failure: {
					kind: "failure",
					reason: "invalid_policies",
					error: new ApprovalRoutingPolicyValidationError("conditions", "broken"),
				},
				requesterEmployeeId: "emp-requester",
				defaultApproverId: "emp-manager",
			}),
		).toBeNull();
	});
});
