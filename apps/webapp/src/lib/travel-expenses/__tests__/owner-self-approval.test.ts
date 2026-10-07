import { describe, expect, it } from "vitest";
import { isOwnerSelfApprovalDecision, ownerSelfApprovalBlockers } from "../owner-self-approval";

describe("ownerSelfApprovalBlockers", () => {
	it("allows a report without exceptions to approve itself", () => {
		expect(ownerSelfApprovalBlockers([{ itemId: "a" }, { itemId: "b" }])).toEqual([]);
	});

	it("names every exception that needs another reviewer's explicit acceptance (#604, #610)", () => {
		expect(
			ownerSelfApprovalBlockers([
				{ itemId: "a" },
				{ itemId: "b", receiptException: { reason: "Lost on the train" } },
				{ itemId: "c", allowanceOverride: { overrideId: "o" } },
			]),
		).toEqual(["receipt_exception", "allowance_override"]);
	});
});

describe("isOwnerSelfApprovalDecision", () => {
	it("recognises only the owner's automatic approval during submission", () => {
		const activation = {
			operationKind: "submission_activation" as const,
			requestOutcome: "approved",
			result: { reason: "owner_no_other_reviewer" },
		};
		expect(isOwnerSelfApprovalDecision(activation)).toBe(true);
		expect(
			isOwnerSelfApprovalDecision({ ...activation, result: { reason: "requester_is_approver" } }),
		).toBe(false);
		expect(isOwnerSelfApprovalDecision({ ...activation, operationKind: "command" })).toBe(false);
	});
});
