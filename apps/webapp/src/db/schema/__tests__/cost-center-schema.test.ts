import { describe, expect, test } from "vitest";

import { costCenter, employeeCostCenterAssignment } from "../cost-center";

describe("cost-center schema", () => {
	test("exports costCenter table", () => {
		expect(costCenter).toBeDefined();
	});

	test("exports employeeCostCenterAssignment table", () => {
		expect(employeeCostCenterAssignment).toBeDefined();
	});
});
