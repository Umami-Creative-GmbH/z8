import { describe, expect, it } from "vitest";

import { workPeriod } from "../time-tracking";

describe("workPeriod deletion metadata schema", () => {
	it("exposes audit fields for approved deletion", () => {
		expect(workPeriod.deletedAt.name).toBe("deleted_at");
		expect(workPeriod.deletedBy.name).toBe("deleted_by");
		expect(workPeriod.deletionReason.name).toBe("deletion_reason");
		expect(workPeriod.deletionApprovalRequestId.name).toBe("deletion_approval_request_id");
	});
});
