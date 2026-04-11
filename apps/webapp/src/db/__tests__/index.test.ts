import { describe, expect, it } from "vitest";

import {
	timeRecord,
	timeRecordAbsence,
	timeRecordAllocation,
	timeRecordApprovalDecision,
	timeRecordWork,
} from "../index";

describe("db barrel exports", () => {
	it("re-exports canonical time record tables", () => {
		expect(timeRecord).toBeDefined();
		expect(timeRecordWork).toBeDefined();
		expect(timeRecordAbsence).toBeDefined();
		expect(timeRecordAllocation).toBeDefined();
		expect(timeRecordApprovalDecision).toBeDefined();
	});
});
