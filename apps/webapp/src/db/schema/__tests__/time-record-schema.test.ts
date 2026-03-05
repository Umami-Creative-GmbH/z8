import { describe, expect, it } from "vitest";

import {
	timeRecord,
	timeRecordAbsence,
	timeRecordAllocation,
	timeRecordApprovalDecision,
	timeRecordBreak,
	timeRecordWork,
} from "../time-record";

describe("time-record schema", () => {
	it("exports canonical base and extension tables", () => {
		expect(timeRecord).toBeDefined();
		expect(timeRecordWork).toBeDefined();
		expect(timeRecordAbsence).toBeDefined();
		expect(timeRecordBreak).toBeDefined();
		expect(timeRecordAllocation).toBeDefined();
		expect(timeRecordApprovalDecision).toBeDefined();
	});

	it("keeps organization scoping on all canonical tables", () => {
		expect(timeRecord.organizationId).toBeDefined();
		expect(timeRecordWork.organizationId).toBeDefined();
		expect(timeRecordAbsence.organizationId).toBeDefined();
		expect(timeRecordBreak.organizationId).toBeDefined();
		expect(timeRecordAllocation.organizationId).toBeDefined();
		expect(timeRecordApprovalDecision.organizationId).toBeDefined();
	});
});
