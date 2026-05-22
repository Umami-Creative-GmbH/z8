import { describe, expect, it } from "vitest";
import { getReportAccessibleEmployeeIds } from "./permissions";

describe("getReportAccessibleEmployeeIds", () => {
	it("returns only self for employees", () => {
		expect(
			getReportAccessibleEmployeeIds({
				currentEmployeeId: "employee-1",
				role: "employee",
				managedEmployeeIds: ["employee-2"],
			}),
		).toEqual(["employee-1"]);
	});

	it("returns self and direct reports for managers", () => {
		expect(
			getReportAccessibleEmployeeIds({
				currentEmployeeId: "manager-1",
				role: "manager",
				managedEmployeeIds: ["employee-2", "employee-3"],
			}),
		).toEqual(["manager-1", "employee-2", "employee-3"]);
	});

	it("returns null for admins because the organization filter is sufficient", () => {
		expect(
			getReportAccessibleEmployeeIds({
				currentEmployeeId: "admin-1",
				role: "admin",
				managedEmployeeIds: ["employee-2"],
			}),
		).toBeNull();
	});
});
