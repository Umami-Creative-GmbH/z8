import { expect, it } from "vitest";
import { fastLaneDecisionItemOf } from "./fast-lane-review";
import type { ApprovalInboxDetailResult } from "./types";

it("uses the most restrictive item and detail action capabilities for shortcuts", () => {
	const item = {
		id: "request",
		capabilities: {
			canApprove: true,
			canReject: true,
			canBulkApprove: true,
			requiresRejectReason: true,
		},
	};
	const result = fastLaneDecisionItemOf({
		item,
		sections: [],
		actions: {
			...item.capabilities,
			canApprove: false,
			canReject: false,
			canBulkApprove: false,
			requiresDetailReview: true,
		},
	} as ApprovalInboxDetailResult);
	expect(result.capabilities).toMatchObject({
		canApprove: false,
		canReject: false,
		canBulkApprove: false,
		requiresDetailReview: true,
	});
});
