import { describe, expect, it } from "vitest";
import { resolveScopedPayrollEmployeeIdsForAction } from "./actions";

describe("resolveScopedPayrollEmployeeIdsForAction", () => {
	it("returns requested employee IDs for admins", () => {
		expect(
			resolveScopedPayrollEmployeeIdsForAction({
				role: "admin",
				requestedEmployeeIds: ["employee-3", "employee-1"],
				allowedEmployeeIds: ["employee-1"],
			}),
		).toEqual(["employee-3", "employee-1"]);
	});

	it("leaves admin scope unrestricted when no employees are requested", () => {
		expect(
			resolveScopedPayrollEmployeeIdsForAction({
				role: "admin",
				allowedEmployeeIds: ["employee-1"],
			}),
		).toBeUndefined();
	});

	it("intersects requested employee IDs with allowed scope for non-admin payroll users", () => {
		expect(
			resolveScopedPayrollEmployeeIdsForAction({
				role: "manager",
				requestedEmployeeIds: ["employee-3", "employee-1", "employee-2"],
				allowedEmployeeIds: ["employee-1", "employee-2"],
			}),
		).toEqual(["employee-1", "employee-2"]);
	});

	it("uses all allowed employee IDs for non-admin payroll users when none are requested", () => {
		expect(
			resolveScopedPayrollEmployeeIdsForAction({
				role: "employee",
				allowedEmployeeIds: ["employee-2", "employee-1"],
			}),
		).toEqual(["employee-1", "employee-2"]);
	});
});
