import { describe, expect, it } from "vitest";
import {
	ApprovalTransitionError,
	applyApprovalDecision,
	type TimeRecordApprovalDecision,
} from "@/lib/time-record/approval";

describe("time-record approval transitions", () => {
	it("transitions draft to pending on submit", () => {
		expect(applyApprovalDecision("draft", "submit")).toBe("pending");
	});

	it("transitions pending to approved on approve", () => {
		expect(applyApprovalDecision("pending", "approve")).toBe("approved");
	});

	it("transitions pending to rejected on reject", () => {
		expect(applyApprovalDecision("pending", "reject")).toBe("rejected");
	});

	it("rejects all other transitions", () => {
		const invalidTransitions: Array<[
			Parameters<typeof applyApprovalDecision>[0],
			TimeRecordApprovalDecision,
		]> = [
			["draft", "approve"],
			["draft", "reject"],
			["pending", "submit"],
			["approved", "submit"],
			["approved", "approve"],
			["approved", "reject"],
			["rejected", "submit"],
			["rejected", "approve"],
			["rejected", "reject"],
		];

		for (const [status, decision] of invalidTransitions) {
			expect(() => applyApprovalDecision(status, decision)).toThrowError(ApprovalTransitionError);
		}
	});
});
