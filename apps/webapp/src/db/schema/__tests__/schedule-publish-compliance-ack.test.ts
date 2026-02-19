import { describe, expect, it } from "vitest";

import { schedulePublishComplianceAck } from "@/db/schema/compliance";

describe("schedulePublishComplianceAck schema", () => {
	it("exports table with required org-scoped columns", () => {
		expect(schedulePublishComplianceAck).toBeDefined();
		expect(schedulePublishComplianceAck.organizationId).toBeDefined();
		expect(schedulePublishComplianceAck.actorEmployeeId).toBeDefined();
		expect(schedulePublishComplianceAck.evaluationFingerprint).toBeDefined();
	});
});
